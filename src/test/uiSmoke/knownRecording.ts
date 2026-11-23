/**
 * The ui-smoke pages' known data: what each channel of a page's recordings holds, as the test knows it. The backend's
 * analysis sends no picture of a channel (a row's picture is the figure service's, from the answers the backend
 * keeps), so a page that has no backend carries its recording here, as two fields of the fixture only: `waveform`
 * (an envelope of extremes with their times) and `spectrogram` (levels by time and frequency). The stand-ins answer
 * from them as the backend would from the file (fullReadStandIn.ts).
 */

export interface KnownWaveform { min: number[]; max: number[]; minT: number[]; maxT: number[]; absolutePeak: number }

export interface KnownSpectrogram {
    values: number[][];
    timeBins: number;
    frequencyBins: number;
    windowSize: number;
    hopSize: number;
    maxFrequencyHz: number;
    minDb: number;
    maxDb: number;
}

function knownWaveform(pointCount: number, phase: number): KnownWaveform {
    const min: number[] = [];
    const max: number[] = [];
    const minT: number[] = [];
    const maxT: number[] = [];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const center = (pointIndex + 0.5) / pointCount;
        const slow = Math.sin(2 * Math.PI * (center * 1.5 + phase));
        const fast = Math.sin(2 * Math.PI * (center * 7 + phase));
        const envelope = 0.35 + 0.3 * ((1 + Math.sin(2 * Math.PI * (center + phase))) / 2);
        const peak = Math.min(0.96, envelope * (0.45 + 0.35 * Math.abs(fast)) + 0.08 * Math.abs(slow));
        const bias = 0.08 * slow;
        min.push(Number((bias - peak).toFixed(4)));
        max.push(Number((bias + peak).toFixed(4)));
        minT.push(Number(Math.max(0, center - 0.4 / pointCount).toFixed(4)));
        maxT.push(Number(Math.min(1, center + 0.4 / pointCount).toFixed(4)));
    }
    return { min, max, minT, maxT, absolutePeak: 0.96 };
}

function knownLevels(timeBins: number, frequencyBins: number, phase: number): number[][] {
    return Array.from({ length: timeBins }, (_, timeIndex) => Array.from({ length: frequencyBins }, (_, frequencyIndex) => {
        const timeNorm = timeIndex / Math.max(1, timeBins - 1);
        const freqNorm = frequencyIndex / Math.max(1, frequencyBins - 1);
        const ridge = Math.sin(2 * Math.PI * (timeNorm * 1.8 + phase)) * 0.18 + 0.45;
        const distance = Math.abs(freqNorm - ridge);
        const bandEnergy = Math.max(0, 1 - distance * 3.5);
        const shimmer = 0.5 + 0.5 * Math.sin(2 * Math.PI * (timeNorm * 6 + freqNorm * 2 + phase));
        return Math.round(-92 + bandEnergy * 70 + shimmer * 12);
    }));
}

/** Gives every channel of `results` its known recording: a waveform, and a spectrogram unless `spectrogram` is false. */
export function withKnownRecordings(results: Array<{ channels: Array<Record<string, unknown>>; [key: string]: unknown }>, spectrogram = true): void {
    for (const result of results) {
        const rate = typeof result['sampleRateHz'] === 'number' ? result['sampleRateHz'] : 16_000;
        result.channels.forEach((channel, channelIndex) => {
            const phase = 0.08 + channelIndex * 0.17;
            channel['waveform'] = knownWaveform(96, phase);
            if (spectrogram) {
                const known: KnownSpectrogram = { values: knownLevels(64, 32, phase), timeBins: 64, frequencyBins: 32, windowSize: 512, hopSize: 128, maxFrequencyHz: rate / 2, minDb: -90, maxDb: 0 };
                channel['spectrogram'] = known;
            }
        });
    }
}
