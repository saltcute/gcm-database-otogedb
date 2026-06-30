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
 * Separator between a song's `sort` value and its occurrence disambiguator.
 * Otoge-DB `sort` values are bare integers, so this never appears in a real
 * `sort` and cannot be confused with one or with the `dx` prefix.
 */
const KEY_SEPARATOR = "_";

interface IndexedSong {
    /** A key that uniquely addresses this entry within its song list. */
    key: string;
    song: RawSong;
}

interface SongIndex {
    /** The song list in file order, each entry carrying its key. */
    list: IndexedSong[];
    /** Maps each key back to its single entry, for O(1) resolution. */
    byKey: Map<string, RawSong>;
}

/**
 * Assign each entry a key that is unique within the list. The first entry for a
 * given `sort` keeps the bare `sort` (so identifiers for unique sorts — all of
 * the JP list and ~97% of the intl list — stay byte-identical); later entries
 * reusing that `sort` get a `_N` suffix (`161`, `161_1`, `161_2`).
 *
 * The JP `music-ex.json` has unique `sort`s, but `music-ex-intl.json` reuses a
 * handful for genuinely different songs. maimai entries have no stable unique
 * id, so the suffix is derived from array position: if Otoge-DB reorders the
 * colliding entries, a previously issued `161_1` may point at a different song.
 * That is inherent to the upstream data — callers should not treat suffixed
 * identifiers as permanently stable.
 */
function indexSongs(songs: RawSong[]): SongIndex {
    const counts = new Map<string, number>();
    const list: IndexedSong[] = [];
    const byKey = new Map<string, RawSong>();
    for (const song of songs) {
        const sort = song.sort ?? "";
        const seen = counts.get(sort) ?? 0;
        counts.set(sort, seen + 1);
        const key = seen === 0 ? sort : `${sort}${KEY_SEPARATOR}${seen}`;
        list.push({ key, song });
        byKey.set(key, song);
    }
    return { list, byKey };
}

/**
 * Otoge-DB stores the standard and deluxe charts of a song in the same entry.
 * Deluxe charts are addressed by prefixing the entry's key with `dx`. The key
 * is the song's `sort`, possibly with a `_N` occurrence suffix (see
 * {@link indexSongs}).
 */
function resolveIdentifier(identifier: string): { key: string; type: Type } {
    if (identifier.startsWith("dx")) {
        return { key: identifier.slice(2), type: Type.DELUXE };
    }
    return { key: identifier, type: Type.STANDARD };
}

function makeIdentifier(key: string, type: Type): string {
    return type === Type.DELUXE ? `dx${key}` : key;
}

export class Database implements BaseDatabase<Chart> {
    private cache = new Cache<RawSong[]>("gcm-database-otogedb/maimai");
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
     * The cached song list with a unique key assigned to every entry. Built
     * fresh from {@link getAllSongs} on each call — a cheap O(n) pass that
     * keeps the (cache-coalesced) song list as the single fetched source of
     * truth and avoids storing a `Map` in the JSON-serialized cache.
     */
    private async getIndex(): Promise<SongIndex> {
        return indexSongs(await this.getAllSongs());
    }

    /**
     * Build a single-difficulty chart out of an Otoge-DB song entry. Returns
     * `null` when the song does not have a chart for that type and difficulty.
     */
    private buildChart(
        key: string,
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
            identifier: makeIdentifier(key, type),
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
        const { key, type } = resolveIdentifier(identifier);
        const { byKey } = await this.getIndex();
        const song = byKey.get(key);
        if (!song) {
            return {
                err: `Cannot find a chart with identifier ${identifier}.`,
            };
        }
        const chart = this.buildChart(key, song, type, difficulty);
        if (!chart) {
            return {
                err: `${identifier} does not have a ${difficulty} chart.`,
            };
        }
        return { data: chart };
    }

    public async getJacket(identifier: string) {
        const { key } = resolveIdentifier(identifier);
        const { byKey } = await this.getIndex();
        const song = byKey.get(key);
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
        const { list } = await this.getIndex();
        const sortedCandidates = list
            .filter(({ song }) => song.title === payload.title)
            .map(({ key, song }) =>
                this.buildChart(key, song, payload.type, payload.difficulty),
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
