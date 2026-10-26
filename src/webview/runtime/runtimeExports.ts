import { binFrequencyHz } from '../draw/canvasDrawers';
import type { SpectrumSlice } from './types';

export interface CsvSpectrumTrack {
    name: string;
    slice: SpectrumSlice;
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

function csvCell(s: string): string {
    return /[,"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function levelAxisLabel(slice: SpectrumSlice): string {
    return slice.axisLabel ? slice.axisLabel : 'Spectrum level [dB]';
}

export function buildSpectrumCsv(tracks: CsvSpectrumTrack[]): string {
    const headers: string[] = [];
    tracks.forEach(function (t) {
        headers.push(csvCell(t.name + ' frequency (Hz)'));
        headers.push(csvCell(t.name + ' ' + levelAxisLabel(t.slice)));
    });
    const rows = [headers.join(',')];
    const maxBins = tracks.reduce(function (max, t) {
        return Math.max(max, t.slice.frequencyBins || 0, t.slice.values ? t.slice.values.length : 0);
    }, 0);
    for (let bin = 0; bin < maxBins; bin++) {
        const cols: string[] = [];
        tracks.forEach(function (t) {
            const fBins = t.slice.frequencyBins || 0;
            cols.push(bin < fBins ? binFrequencyHz(t.slice, bin).toFixed(4) : '');
            const v = t.slice.values[bin];
            cols.push(v !== undefined && v !== null ? v.toFixed(6) : '');
        });
        rows.push(cols.join(','));
    }
    return rows.join('\n');
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
