import type { Chart as BaseChart } from "gcm-database/maimai";

export interface OptionalData {
    /**
     * The genre this song is filed under, e.g. `"maimai"` or `"POPS＆アニメ"`.
     */
    category: string;
    /**
     * Reading of the title, used by the game for sorting.
     */
    reading?: string;
    /**
     * The version code of the game this chart belongs to, e.g. `"10000"`.
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
     * Whether this is a buddy (two-player) UTAGE chart.
     */
    buddy: boolean;
    /**
     * Link to the wiki page of this song.
     */
    wikiUrl?: string;
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
