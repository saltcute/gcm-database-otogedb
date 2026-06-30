import {
    formatDate,
    parseDisplayLevel,
    type RawSong,
    SONG_LIST_TTL,
    toDecimal,
    toInteger,
} from "@lib/otogedb";
import { CdnSource, Regions, type Source } from "@lib/source";
import { Cache } from "@saltcute/cache";
import {
    type Database as BaseDatabase,
    Difficulty,
    Type,
} from "gcm-database/maimai";
import type { Chart } from "./chart";

/**
 * Maps a gcm-database difficulty to the field prefix Otoge-DB uses. `easy` is
 * intentionally absent because maimai has no such difficulty.
 */
const DIFFICULTY_PREFIX: Partial<Record<Difficulty, string>> = {
    [Difficulty.BASIC]: "bas",
    [Difficulty.ADVANCED]: "adv",
    [Difficulty.EXPERT]: "exp",
    [Difficulty.MASTER]: "mas",
    [Difficulty.RE_MASTER]: "remas",
    [Difficulty.UTAGE]: "utage",
};

/**
 * Otoge-DB stores the standard and deluxe charts of a song in the same entry.
 * Deluxe charts are addressed by prefixing the song's `sort` value with `dx`.
 */
function resolveIdentifier(identifier: string): { sort: string; type: Type } {
    if (identifier.startsWith("dx")) {
        return { sort: identifier.slice(2), type: Type.DELUXE };
    }
    return { sort: identifier, type: Type.STANDARD };
}

function makeIdentifier(sort: string, type: Type): string {
    return type === Type.DELUXE ? `dx${sort}` : sort;
}

export class Database implements BaseDatabase<Chart> {
    private cache = new Cache<RawSong[]>("gcm-database-otogedb/maimai");
    /** Shared in-flight fetch, so concurrent calls don't each issue a PUT. */
    private inflight: Promise<RawSong[]> | null = null;

    /**
     * @param source Where charts and jackets are read from. Defaults to the
     * jsDelivr CDN; pass a {@link LocalSource} to read from a cloned repo.
     */
    constructor(private source: Source = new CdnSource(), private region: Regions = "JPN") {}

    private async getAllSongs() {
        const key = `${this.source.getMusicListName("maimai", this.region)}:${this.source.cacheKey}`;
        const cached = await this.cache.get(key);
        if (cached) return cached as RawSong[];
        // Coalesce concurrent misses onto a single fetch/PUT.
        if (this.inflight) return this.inflight;
        this.inflight = (async () => {
            const songs = await this.source.getSongList("maimai", this.region);
            if (songs.length > 0) {
                await this.cache.put(key, songs, SONG_LIST_TTL);
            }
            return songs;
        })();
        try {
            return await this.inflight;
        } finally {
            this.inflight = null;
        }
    }

    /**
     * Build a single-difficulty chart out of an Otoge-DB song entry. Returns
     * `null` when the song does not have a chart for that type and difficulty.
     */
    private buildChart(
        song: RawSong,
        type: Type,
        difficulty: Difficulty,
    ): Chart | null {
        const prefix = DIFFICULTY_PREFIX[difficulty];
        if (!prefix) return null;

        // UTAGE charts only exist as a single variant, so the deluxe prefix
        // never applies to them.
        const isUtage = difficulty === Difficulty.UTAGE;
        const base =
            isUtage || type === Type.STANDARD
                ? `lev_${prefix}`
                : `dx_lev_${prefix}`;

        const level = song[base];
        // An empty level means this difficulty does not exist for the song.
        if (!level) return null;

        return {
            identifier: makeIdentifier(song.sort ?? "", type),
            title: song.title ?? "",
            artist: song.artist ?? "",
            type: isUtage ? Type.STANDARD : type,
            difficulty,
            level,
            internalLevel: toDecimal(song[`${base}_i`]),
            notes: {
                tap: toInteger(song[`${base}_notes_tap`]),
                hold: toInteger(song[`${base}_notes_hold`]),
                slide: toInteger(song[`${base}_notes_slide`]),
                touch: toInteger(song[`${base}_notes_touch`]),
                break: toInteger(song[`${base}_notes_break`]),
            },
            bpm: [toInteger(song.bpm)],
            designer: song[`${base}_designer`] ?? "",
            optionalData: {
                category: song.catcode ?? "",
                reading: song.title_kana,
                gameVersion: song.version ?? "",
                imageName: song.image_url ?? "",
                totalNotes: toInteger(song[`${base}_notes`]) || undefined,
                buddy: song.buddy === "○",
                wikiUrl: song.wiki_url || undefined,
                dateAdded: formatDate(song.date_added),
                international: {
                    available: song.intl === "1",
                    dateAdded: formatDate(song.date_intl_added),
                },
            },
        };
    }

    public async getChart(identifier: string, difficulty: Difficulty) {
        const { sort, type } = resolveIdentifier(identifier);
        const songs = await this.getAllSongs();
        const song = songs.find((song) => song.sort === sort);
        if (!song) {
            return {
                err: `Cannot find a chart with identifier ${identifier}.`,
            };
        }
        const chart = this.buildChart(song, type, difficulty);
        if (!chart) {
            return {
                err: `${identifier} does not have a ${difficulty} chart.`,
            };
        }
        return { data: chart };
    }

    public async getJacket(identifier: string) {
        const { sort } = resolveIdentifier(identifier);
        const songs = await this.getAllSongs();
        const song = songs.find((song) => song.sort === sort);
        if (!song?.image_url) {
            return { err: `Cannot find the jacket of ${identifier}.` };
        }
        const data = await this.source.getJacket("maimai", song.image_url);
        if (!data) {
            return { err: `Cannot find the jacket of ${identifier}.` };
        }
        return { data };
    }

    public async searchChart(
        payload: {
            title: string;
            level: number;
            difficulty: Difficulty;
            type: Type;
        },
        options?: Partial<{
            maxResultCount: number;
        }>,
    ) {
        const songs = await this.getAllSongs();
        const sortedCandidates = songs
            .filter((song) => song.title === payload.title)
            .map((song) =>
                this.buildChart(song, payload.type, payload.difficulty),
            )
            .filter((chart): chart is Chart => chart !== null)
            .map((chart) => {
                const internalLevel =
                    chart.internalLevel ?? parseDisplayLevel(chart.level);
                if (internalLevel !== undefined) {
                    return {
                        chart,
                        weight: Math.abs(internalLevel - payload.level),
                    };
                }
                return { chart };
            })
            .filter((v): v is { chart: Chart; weight: number } => "weight" in v)
            .sort((a, b) => a.weight - b.weight);
        return {
            data: sortedCandidates.slice(0, options?.maxResultCount || 20),
        };
    }
}
