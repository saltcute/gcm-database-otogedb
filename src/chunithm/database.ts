import {
    formatDate,
    parseDisplayLevel,
    type RawSong,
    SONG_LIST_TTL,
    toDecimal,
    toInteger,
} from "@lib/otogedb";
import { CdnSource, type Source } from "@lib/source";
import { Cache } from "@saltcute/cache";
import {
    type Database as BaseDatabase,
    Difficulty,
} from "gcm-database/chunithm";
import type { Chart } from "./chart";

/**
 * Maps a gcm-database difficulty to the field prefix Otoge-DB uses.
 */
const DIFFICULTY_PREFIX: Record<Difficulty, string> = {
    [Difficulty.BASIC]: "bas",
    [Difficulty.ADVANCED]: "adv",
    [Difficulty.EXPERT]: "exp",
    [Difficulty.MASTER]: "mas",
    [Difficulty.ULTIMA]: "ult",
    [Difficulty.WORLDS_END]: "we",
};

export class Database implements BaseDatabase<Chart> {
    private cache = new Cache<RawSong[]>("gcm-database-otogedb/chunithm");

    /**
     * @param source Where charts and jackets are read from. Defaults to the
     * jsDelivr CDN; pass a {@link LocalSource} to read from a cloned repo.
     */
    constructor(private source: Source = new CdnSource()) {}

    private async getAllSongs() {
        const key = `music-ex:${this.source.cacheKey}`;
        const cached = await this.cache.get(key);
        if (cached) return cached as RawSong[];
        const songs = await this.source.getSongList("chunithm");
        if (songs.length > 0) {
            await this.cache.put(key, songs, SONG_LIST_TTL);
        }
        return songs;
    }

    /**
     * Build a single-difficulty chart out of an Otoge-DB song entry. Returns
     * `null` when the song does not have a chart for that difficulty.
     */
    private buildChart(song: RawSong, difficulty: Difficulty): Chart | null {
        const prefix = DIFFICULTY_PREFIX[difficulty];
        const isWorldsEnd = difficulty === Difficulty.WORLDS_END;

        const level = isWorldsEnd
            ? `${song.we_kanji ?? ""}${"★".repeat(toInteger(song.we_star))}`
            : (song[`lev_${prefix}`] ?? "");
        // An empty level means this difficulty does not exist for the song.
        if (!level || (isWorldsEnd && !song.we_kanji)) return null;

        return {
            identifier: song.id ?? "",
            title: song.title ?? "",
            artist: song.artist ?? "",
            difficulty,
            level,
            internalLevel: toDecimal(song[`lev_${prefix}_i`]),
            notes: {
                tap: toInteger(song[`lev_${prefix}_notes_tap`]),
                hold: toInteger(song[`lev_${prefix}_notes_hold`]),
                slide: toInteger(song[`lev_${prefix}_notes_slide`]),
                air: toInteger(song[`lev_${prefix}_notes_air`]),
                flick: toInteger(song[`lev_${prefix}_notes_flick`]),
            },
            bpm: [toInteger(song.bpm)],
            designer: song[`lev_${prefix}_designer`] ?? "",
            optionalData: {
                category: song.catname ?? "",
                reading: song.reading,
                gameVersion: song.version ?? "",
                imageName: song.image ?? "",
                totalNotes: toInteger(song[`lev_${prefix}_notes`]) || undefined,
                chartLink: song[`lev_${prefix}_chart_link`] || undefined,
                wikiUrl: song.wikiwiki_url || undefined,
                worldsEnd: isWorldsEnd
                    ? {
                          kanji: song.we_kanji ?? "",
                          stars: toInteger(song.we_star),
                      }
                    : undefined,
                dateAdded: formatDate(song.date_added),
                international: {
                    available: song.intl === "1",
                    dateAdded: formatDate(song.date_intl_added),
                },
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
        if (!song?.image) {
            return { err: `Cannot find the jacket of ${identifier}.` };
        }
        const data = await this.source.getJacket("chunithm", song.image);
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
}
