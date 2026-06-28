import type { Chart as BaseChart } from "gcm-database/chunithm";

export interface OptionalData {
    /**
     * The genre this song is filed under, e.g. `"POPS & ANIME"`.
     */
    category: string;
    /**
     * Reading of the title, used by the game for sorting.
     */
    reading?: string;
    /**
     * The version of the game this chart belongs to, e.g. `"LUMINOUS"`.
     */
    gameVersion: string;
    /**
     * File name of the jacket on Otoge-DB, used by {@link Database.getJacket}.
     */
    imageName: string;
    /**
     * Total number of notes in this chart.
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
     * Present only for WORLD'S END charts.
     */
    worldsEnd?: {
        /**
         * The single kanji that describes the gimmick, e.g. `"割"`.
         */
        kanji: string;
        /**
         * The displayed star rating.
         */
        stars: number;
    };
    /**
     * yyyy-mm-dd date of when this chart was added to the Japanese version.
     */
    dateAdded?: string;
    /**
     * International (overseas) availability of this song.
     */
    international: {
        available: boolean;
        /**
         * yyyy-mm-dd date of when this chart was added internationally.
         */
        dateAdded?: string;
    };
}

export interface Chart extends BaseChart {
    optionalData: OptionalData;
}
