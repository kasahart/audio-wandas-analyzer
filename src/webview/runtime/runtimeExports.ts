import { csvFile } from '../../shared/utils/csv';
import { binFrequencyHz } from '../draw/canvasDrawers';
import type { FigureTitle, PlainTitle } from './figureModel';
import type { SpectrumSlice } from './types';
import { everyBin } from './wholeAnswers';

export interface CsvSpectrumTrack {
    name: string;
    slice: SpectrumSlice;
    /** Its level column's name as its level axis names it: the quantity and its unit with the channel's reference (C5). */
    levelTitle: FigureTitle;
}

export interface WavLoopTrack {
    filePath: string;
    offsetSeconds: number;
    durationSeconds: number;
}

export interface WavLoopRegion {
    filePath: string;
    startNorm: number;
    endNorm: number;
}

/**
 * The spectra at the cursor as CSV: per track a frequency and a level column, each named as its axis is ("Quantity
 * [unit]", the level with its reference: never a bare dB), `frequencyTitle` the frequency axis's name. The file is
 * written by `csvFile` (UTF-8 with a BOM, CRLF), as every CSV the Analyzer writes.
 */
export function buildSpectrumCsv(tracks: CsvSpectrumTrack[], frequencyTitle: PlainTitle): string {
    const headers: string[] = [];
    tracks.forEach(function (t) {
        headers.push(t.name + ' ' + frequencyTitle);
        headers.push(t.name + ' ' + t.levelTitle);
    });
    const rows: string[][] = [];
    const maxBins = tracks.reduce(function (max, t) {
        return Math.max(max, t.slice.frequencyBins || 0);
    }, 0);
    for (let bin = 0; bin < maxBins; bin++) {
        const cols: string[] = [];
        tracks.forEach(function (t) {
            const fBins = t.slice.frequencyBins || 0;
            cols.push(bin < fBins ? binFrequencyHz(t.slice, bin).toFixed(4) : '');
            // Only a slice that holds every bin is written (R7): one cut for display has no value to export.
            const v = everyBin(t.slice)?.[bin];
            cols.push(v !== undefined && v !== null ? v.toFixed(6) : '');
        });
        rows.push(cols);
    }
    return csvFile(headers, rows);
}

export function wavLoopRegions(tracks: WavLoopTrack[], startSec: number, endSec: number): WavLoopRegion[] {
    const regions: WavLoopRegion[] = [];
    tracks.forEach(function (track) {
        const startNorm = Math.max(0, (startSec - track.offsetSeconds) / track.durationSeconds);
        const endNorm = Math.min(1, (endSec - track.offsetSeconds) / track.durationSeconds);
        if (endNorm > startNorm) regions.push({ filePath: track.filePath, startNorm, endNorm });
    });
    return regions;
}
