/**
 * The game directories Otoge-DB exposes.
 */
export type Game = "maimai" | "chunithm" | "ongeki";

/**
 * A raw song entry from Otoge-DB. Every value is a string (including numbers
 * and empty fields), so it always needs to be parsed before use.
 */
export type RawSong = Record<string, string | undefined>;

/**
 * How long a song list is kept in cache. Otoge-DB updates a few times a day at
 * most, so an hour keeps things fresh without re-reading the (multi-megabyte)
 * file on every lookup.
 */
export const SONG_LIST_TTL = 60 * 60 * 1000; // 1 hour.

/**
 * Parse an integer field. Empty fields and Otoge-DB's `"-"` placeholder become
 * `0`.
 */
export function toInteger(value: string | undefined): number {
    const number = Number.parseInt(value ?? "", 10);
    return Number.isNaN(number) ? 0 : number;
}

/**
 * Parse a decimal field, such as an internal level. Returns `undefined` when
 * the field is empty or unparseable.
 */
export function toDecimal(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const number = Number.parseFloat(value);
    return Number.isNaN(number) ? undefined : number;
}

/**
 * Convert Otoge-DB's `yyyymmdd` dates into the `yyyy-mm-dd` format.
 */
export function formatDate(value: string | undefined): string | undefined {
    if (value?.length !== 8 || value === "00000000") return undefined;
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/**
 * Best-effort numeric value of a displayed level (e.g. `"12+"`), used to rank
 * search results when an internal level is not available. A trailing `+` is
 * treated as half a level.
 */
export function parseDisplayLevel(
    level: string | undefined,
): number | undefined {
    if (!level) return undefined;
    const plus = level.endsWith("+");
    const number = Number.parseInt(level, 10);
    if (Number.isNaN(number)) return undefined;
    return plus ? number + 0.5 : number;
}
