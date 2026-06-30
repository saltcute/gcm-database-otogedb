import {
    formatDate,
    parseDisplayLevel,
    type RawSong,
    SONG_LIST_TTL,
    toDecimal,
    toInteger,
} from "@lib/otogedb";
import { CdnSource, type Regions, type Source } from "@lib/source";
import { Cache } from "@saltcute/cache";
import {
    type Database as BaseDatabase,
    Difficulty,
    LunaticType,
} from "gcm-database/ongeki";
import type { Chart } from "./chart";

/**
 * Maps a gcm-database difficulty to the field prefix Otoge-DB uses. Note that
 * ongeki's expert difficulty is abbreviated `exc` rather than `exp`.
 */
const DIFFICULTY_PREFIX: Record<Difficulty, string> = {
    [Difficulty.BASIC]: "bas",
    [Difficulty.ADVANCED]: "adv",
    [Difficulty.EXPERT]: "exc",
    [Difficulty.MASTER]: "mas",
    [Difficulty.LUNATIC]: "lnt",
};

export class Database implements BaseDatabase<Chart> {
    private cache = new Cache<RawSong[]>("gcm-database-otogedb/ongeki");
    /** Shared in-flight fetch, so concurrent calls don't each issue a PUT. */
    private inflight: Promise<RawSong[]> | null = null;

    /**
     * @param source Where charts and jackets are read from. Defaults to the
     * jsDelivr CDN; pass a {@link LocalSource} to read from a cloned repo.
     */
    constructor(
        private source: Source = new CdnSource(),
        private region: Regions = "JPN",
    ) {}

    private async getAllSongs() {
        const key = `${this.source.getMusicListName("ongeki", this.region)}:${this.source.cacheKey}`;
        const cached = await this.cache.get(key);
        if (cached) return cached as RawSong[];
        // Coalesce concurrent misses onto a single fetch/PUT.
        if (this.inflight) return this.inflight;
        this.inflight = (async () => {
            const songs = await this.source.getSongList("ongeki", this.region);
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
     * `null` when the song does not have a chart for that difficulty.
     */
    private buildChart(song: RawSong, difficulty: Difficulty): Chart | null {
        const prefix = DIFFICULTY_PREFIX[difficulty];

        const level = song[`lev_${prefix}`] ?? "";
        // An empty level means this difficulty does not exist for the song.
        if (!level) return null;

        return {
            identifier: song.id ?? "",
            title: song.title ?? "",
            artist: song.artist ?? "",
            difficulty,
            level,
            internalLevel: toDecimal(song[`lev_${prefix}_i`]),
            // Otoge-DB only exposes the bell count and the total note count,
            // so the individual note types are left at zero.
            notes: {
                tap: 0,
                hold: 0,
                side: 0,
                flick: 0,
                bell: toInteger(song[`lev_${prefix}_bells`]),
            },
            lunatic:
                difficulty === Difficulty.LUNATIC
                    ? LunaticType.LUNATIC
                    : LunaticType.NONE,
            boss: {
                character: {
                    rarity: "",
                    name: song.character ?? "",
                    card: "",
                },
                level: toInteger(song.enemy_lv),
            },
            bpm: [toInteger(song.bpm)],
            designer: song[`lev_${prefix}_designer`] ?? "",
            optionalData: {
                category: song.category ?? "",
                reading: song.title_sort,
                gameVersion: song.version ?? "",
                imageName: song.image_url ?? "",
                totalNotes: toInteger(song[`lev_${prefix}_notes`]) || undefined,
                chartLink: song[`lev_${prefix}_chart_link`] || undefined,
                wikiUrl: song.wikiwiki_url || undefined,
                chapter: song.chapter || undefined,
                character: song.character || undefined,
                enemy: {
                    level: toInteger(song.enemy_lv),
                    type: song.enemy_type ?? "",
                },
                bonus: song.bonus === "1",
                dateAdded: formatDate(song.date_added),
            },
        };
    }

    public async getChart(identifier: string, difficulty: Difficulty) {
        const songs = await this.getAllSongs();
        const song = songs.find((song) => song.id === identifier);
        if (!song) {
            return {
                err: `Cannot find a chart with identifier ${identifier}.`,
            };
        }
        const chart = this.buildChart(song, difficulty);
        if (!chart) {
            return {
                err: `${identifier} does not have a ${difficulty} chart.`,
            };
        }
        return { data: chart };
    }

    public async getJacket(identifier: string) {
        const songs = await this.getAllSongs();
        const song = songs.find((song) => song.id === identifier);
        if (!song?.image_url) {
            return { err: `Cannot find the jacket of ${identifier}.` };
        }
        const data = await this.source.getJacket("ongeki", song.image_url);
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
        },
        options?: Partial<{
            maxResultCount: number;
        }>,
    ) {
        const songs = await this.getAllSongs();
        const sortedCandidates = songs
            .filter((song) => song.title === payload.title)
            .map((song) => this.buildChart(song, payload.difficulty))
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

    /**
     * Otoge-DB does not provide boss card images, so this always returns an
     * error.
     */
    public async getBossCard(_chart: Chart) {
        return { err: "Otoge-DB does not provide boss card images." };
    }
}
