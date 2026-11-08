/**
 * The track view's full data for its readouts (R7, fullRead.ts): a lane's waveform and spectrogram, and the cursor
 * spectrum's slice cut for display, are drawn thinned; their numbers come from the backend's full data instead. A
 * waveform lane reads its samples ('request-waveform-range' with a read), a spectrogram lane its real STFT cells
 * ('request-track-detail' with a read), and a slice cut for display is read from the same slice at every bin
 * ('request-spectrum-slice', fullResolution). Each read has its own slot on the host, so it never cancels the
 * lanes' pictures nor is cancelled by them.
 */
import type { StagePoints, StageRead } from '../../shared/protocol/backendProtocol';
import type { SpectrumSliceRequest, TrackDetailRequest, WaveformRangeRequest } from '../../shared/utils/audioTarget';
import { fetchedSource, localLine, type FullSource } from './fullRead';

type ReadRequest = WaveformRangeRequest | TrackDetailRequest | SpectrumSliceRequest;
/** A slice read at every bin: each channel's values over 0..maxHz. */
type FullSlice = { values: Map<number, number[]>; maxHz: number };
type ReadAnswer = { points?: StagePoints; slice?: FullSlice } | null;

/** A lane's track as a read names it: its index on the protocol, its file and the analysis it is drawn from. */
export interface LaneTrack {
    trackIndex: number;
    filePath: string;
    analysisId: string;
    settingsSignature: string;
}

export interface LaneReads {
    /** A waveform lane's samples, by the file's 0..1 (the lane's own time axis). */
    waveform(track: LaneTrack, channel: number): FullSource;
    /**
     * A spectrogram lane's real cells (time in s from the file's start, frequency in Hz), from the STFT it is drawn
     * from: the whole file's, or a zoom window's (`window`, fractions of the file) when the lane draws one.
     */
    spectrogram(track: LaneTrack, channel: number, window: { startNorm: number; endNorm: number } | null): FullSource;
    /** Every bin of a cursor slice cut for display (its cursor and settings), for its channel. */
    slice(track: LaneTrack, cursorNorm: number, channel: number): FullSource;
    /** Takes the host's answers to these reads; false for anything else. */
    handle(message: { type: string; requestId?: string }): boolean;
    /** Forgets everything read (a new analysis). */
    clear(): void;
}

const PREFIX = 'read-lane';

export function createLaneReads(post: (message: ReadRequest) => void): LaneReads {
    let count = 0;
    const waiting = new Map<string, (answer: ReadAnswer) => void>();
    const sources = new Map<string, FullSource>();
    const once = (key: string, make: () => FullSource): FullSource => {
        let source = sources.get(key);
        if (!source) {
            source = make();
            sources.set(key, source);
            if (sources.size > 128) sources.delete(sources.keys().next().value as string);
        }
        return source;
    };
    const ask = (message: (requestId: string) => ReadRequest, done: (answer: ReadAnswer) => void): void => {
        const requestId = `${PREFIX}-${++count}`;
        waiting.set(requestId, done);
        post(message(requestId));
    };
    /** The full slices asked for, by key: in (values per channel), or on their way (the callers waiting). */
    const slices = new Map<string, { slice?: FullSlice | null; ready: Set<() => void> }>();
    return {
        waveform(track, channel) {
            return once(JSON.stringify(['wave', track, channel]), () => fetchedSource((read: StageRead, done) => ask(requestId => ({
                type: 'request-waveform-range', requestId, trackIndex: track.trackIndex, filePath: track.filePath,
                startNorm: Math.max(0, Math.min(...read.x)), endNorm: Math.min(1, Math.max(...read.x)), points: 1, read: { ...read, channel },
            }), answer => done(answer?.points ?? null))));
        },
        spectrogram(track, channel, window) {
            return once(JSON.stringify(['spec', track, channel, window]), () => fetchedSource((read: StageRead, done) => ask(requestId => ({
                type: 'request-track-detail', requestId, analysisId: track.analysisId, settingsSignature: track.settingsSignature,
                trackIndex: track.trackIndex, filePath: track.filePath, ...(window ? window : {}), read: { ...read, channel },
            }), answer => done(answer?.points ?? null))));
        },
        slice(track, cursorNorm, channel) {
            const key = JSON.stringify(['slice', track, cursorNorm]);
            return once(JSON.stringify([key, channel]), () => ({
                line(query, ready) {
                    let entry = slices.get(key);
                    if (!entry) {
                        const made: { slice?: FullSlice | null; ready: Set<() => void> } = { ready: new Set() };
                        entry = made;
                        slices.set(key, made);
                        if (slices.size > 32) slices.delete(slices.keys().next().value as string);
                        ask(requestId => ({
                            type: 'request-spectrum-slice', requestId, analysisId: track.analysisId, settingsSignature: track.settingsSignature,
                            trackIndex: track.trackIndex, filePath: track.filePath, cursorNorm, fullResolution: true, read: true,
                        }), answer => {
                            made.slice = answer?.slice ?? null;
                            const calls = [...made.ready];
                            made.ready.clear();
                            for (const call of calls) call();
                        });
                    }
                    if (entry.slice === undefined) { entry.ready.add(ready); return undefined; }
                    const values = entry.slice?.values.get(channel);
                    if (!entry.slice || !values?.length) return null;
                    const step = entry.slice.maxHz / Math.max(1, values.length - 1);
                    return localLine(values.map((_, bin) => bin * step), values).line?.(query, ready);
                },
            }));
        },
        handle(message) {
            const { requestId } = message;
            if (typeof requestId !== 'string' || !requestId.startsWith(`${PREFIX}-`)) return false;
            const done = waiting.get(requestId);
            waiting.delete(requestId);
            if (!done) return true;
            const answer = message as { type: string; points?: StagePoints; maxFrequencyHz?: number; channels?: Array<{ channelIndex?: number; values?: number[] }> };
            if (answer.type === 'spectrum-slice-result') {
                done({ slice: { maxHz: answer.maxFrequencyHz ?? 0, values: new Map((answer.channels ?? []).map((channel, index) => [channel.channelIndex ?? index, channel.values ?? []])) } });
            } else if (answer.type.endsWith('-error')) done(null);
            else done(answer.points ? { points: answer.points } : null);
            return true;
        },
        clear() { sources.clear(); slices.clear(); },
    };
}
