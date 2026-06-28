import type { Chart as BaseChart } from "gcm-database/ongeki";

export interface OptionalData {
    /**
     * The genre this song is filed under, e.g. `"チュウマイ"`.
     */
    category: string;
    /**
     * Reading of the title, used by the game for sorting.
     */
    reading?: string;
    /**
     * The version of the game this chart belongs to, e.g. `"ONGEKI"`.
     */
    gameVersion: string;
    /**
     * File name of the jacket on Otoge-DB, used by {@link Database.getJacket}.
     */
    imageName: string;
    /**
     * Total number of notes in this chart. Otoge-DB does not break this down
     * into individual note types.
     */
    totalNotes?: number;
    /**
     * Path of the chart preview on the official chart viewer, when available.
     */
    chartLink?: string;
    /**
     * Link to the WikiWiki page of this song.
     */
    wikiUrl?: string;
    /**
     * The story chapter this song belongs to.
     */
    chapter?: string;
    /**
     * The character associated with this song.
     */
    character?: string;
    /**
     * The boss enemy fought during this chart.
     */
    enemy: {
        level: number;
        /**
         * The enemy's attribute, e.g. `"FIRE"`, `"AQUA"` or `"LEAF"`.
         */
        type: string;
    };
    /**
     * Whether this is a bonus track.
     */
    bonus: boolean;
    /**
     * yyyy-mm-dd date of when this chart was added.
     */
    dateAdded?: string;
}

export interface Chart extends BaseChart {
    optionalData: OptionalData;
}
