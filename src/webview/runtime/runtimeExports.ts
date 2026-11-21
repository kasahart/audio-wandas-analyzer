
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

export function wavLoopRegions(tracks: WavLoopTrack[], startSec: number, endSec: number): WavLoopRegion[] {
    const regions: WavLoopRegion[] = [];
    tracks.forEach(function (track) {
        const startNorm = Math.max(0, (startSec - track.offsetSeconds) / track.durationSeconds);
        const endNorm = Math.min(1, (endSec - track.offsetSeconds) / track.durationSeconds);
        if (endNorm > startNorm) regions.push({ filePath: track.filePath, startNorm, endNorm });
    });
    return regions;
}
