import fs from "node:fs";
import path from "node:path";
import type { Game, RawSong } from "./otogedb";

/**
 * A place charts and jackets are read from.
 *
 * Otoge-DB lays out the CDN and the git repository identically
 * (`<game>/data/music-ex.json` and `<game>/jacket/<image>`), so the available
 * sources only differ in how the bytes are retrieved. Implement this interface
 * to read from somewhere else entirely.
 */
export interface Source {
    /**
     * A stable string identifying this source, used to namespace its cached
     * song lists. Two sources with the same key are assumed to be
     * interchangeable; different keys never share cache entries.
     */
    readonly cacheKey: string;
    /**
     * Read the `music-ex.json` song list of a game. This is the most complete
     * dataset Otoge-DB provides, bundling note counts, internal levels and
     * chart links. Returns an empty array when it cannot be read.
     */
    getSongList(game: Game): Promise<RawSong[]>;
    /**
     * Read a jacket image. Returns `null` when it cannot be read.
     */
    getJacket(game: Game, imageName: string): Promise<Buffer | null>;
}

/**
 * Base URL of the Otoge-DB repository served through the jsDelivr CDN.
 */
export const CDN_BASE = "https://cdn.jsdelivr.net/gh/zvuc/otoge-db@master";

/**
 * Reads data from Otoge-DB over the network through the jsDelivr CDN. This is
 * the default source and requires no setup.
 *
 * @example
 * ```ts
 * const database = new Database(); // uses a CdnSource.
 * ```
 */
export class CdnSource implements Source {
    constructor(private base: string = CDN_BASE) {}

    public get cacheKey(): string {
        return this.base;
    }

    public async getSongList(game: Game): Promise<RawSong[]> {
        try {
            const response = await fetch(
                `${this.base}/${game}/data/music-ex.json`,
            );
            if (!response.ok) return [];
            return (await response.json()) as RawSong[];
        } catch {
            return [];
        }
    }

    public async getJacket(
        game: Game,
        imageName: string,
    ): Promise<Buffer | null> {
        try {
            const response = await fetch(
                `${this.base}/${game}/jacket/${imageName}`,
            );
            if (!response.ok) return null;
            return Buffer.from(await response.arrayBuffer());
        } catch {
            return null;
        }
    }
}

/**
 * Reads data from a local clone of the Otoge-DB git repository
 * ({@link https://github.com/zvuc/otoge-db}). Keeping the clone up to date
 * (e.g. with `git pull`) is left to the caller.
 *
 * @example
 * ```ts
 * const database = new Database(new LocalSource("/path/to/otoge-db"));
 * ```
 */
export class LocalSource implements Source {
    constructor(private root: string) {}

    public get cacheKey(): string {
        return this.root;
    }

    /**
     * Whether the local clone exists at the configured path.
     */
    public exists(): boolean {
        return fs.existsSync(this.root);
    }

    public async getSongList(game: Game): Promise<RawSong[]> {
        const file = path.join(this.root, game, "data", "music-ex.json");
        try {
            return JSON.parse(
                await fs.promises.readFile(file, "utf-8"),
            ) as RawSong[];
        } catch {
            return [];
        }
    }

    public async getJacket(
        game: Game,
        imageName: string,
    ): Promise<Buffer | null> {
        const file = path.join(this.root, game, "jacket", imageName);
        try {
            return await fs.promises.readFile(file);
        } catch {
            return null;
        }
    }
}
