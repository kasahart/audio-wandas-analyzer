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
import { answerKey, createAnswerStore } from './answerStore';

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

export function createLaneReads(post: (message: ReadRequest) => void, now: () => number = () => Date.now()): LaneReads {
    let count = 0;
    /** Each read on its way: what to call with its answer, and the analysis settings it was asked under. */
    const waiting = new Map<string, { done: (answer: ReadAnswer) => void; settingsSignature?: string }>();
    // Each read's source, kept with what it fetched: of the track's file, analysis and settings (LaneTrack).
    const sources = createAnswerStore<FullSource>({ capacity: 128, now });
    const once = (ask: unknown[], make: () => FullSource): FullSource => sources.keep(answerKey({ ask, version: { by: 'analysis' } }), make);
    const ask = (message: (requestId: string) => ReadRequest, done: (answer: ReadAnswer) => void): void => {
        const requestId = `${PREFIX}-${++count}`;
        const request = message(requestId);
        waiting.set(requestId, { done, ...('settingsSignature' in request ? { settingsSignature: request.settingsSignature } : {}) });
        post(request);
    };
    /** The full slices asked for: in (values per channel), failed (asked again after the store's pause), or on their way. */
    const slices = createAnswerStore<FullSlice>({ capacity: 32, now });
    return {
        waveform(track, channel) {
            return once(['wave', track, channel], () => fetchedSource((read: StageRead, done) => ask(requestId => ({
                type: 'request-waveform-range', requestId, trackIndex: track.trackIndex, filePath: track.filePath,
                startNorm: Math.max(0, Math.min(...read.x)), endNorm: Math.min(1, Math.max(...read.x)), points: 1, read: { ...read, channel },
            }), answer => done(answer?.points ?? null))));
        },
        spectrogram(track, channel, window) {
            return once(['spec', track, channel, window], () => fetchedSource((read: StageRead, done) => ask(requestId => ({
                type: 'request-track-detail', requestId, analysisId: track.analysisId, settingsSignature: track.settingsSignature,
                trackIndex: track.trackIndex, filePath: track.filePath, ...(window ? window : {}), read: { ...read, channel },
            }), answer => done(answer?.points ?? null))));
        },
        slice(track, cursorNorm, channel) {
            const key = answerKey({ ask: ['slice', track, cursorNorm], version: { by: 'analysis' } });
            // The slice at every bin, fetched once for every read of it: its points, and its level for the order (R6).
            const full = (ready: () => void): FullSource | null | undefined => {
                if (slices.ask(key)) {
                    ask(requestId => ({
                        type: 'request-spectrum-slice', requestId, analysisId: track.analysisId, settingsSignature: track.settingsSignature,
                        trackIndex: track.trackIndex, filePath: track.filePath, cursorNorm, fullResolution: true, read: true,
                    }), answer => {
                        if (answer?.slice) slices.ready(key, answer.slice);
                        else slices.fail(key);
                    });
                }
                const state = slices.state(key);
                if (state === 'pending') { slices.whenSettled(key, ready); return undefined; }
                const slice = slices.value(key);
                const values = slice?.values.get(channel);
                // A slice that failed is not read (null: no number, no other line in its place, R7); one with no bins
                // for the channel has nothing to read.
                if (!slice) return null;
                if (!values?.length) return localLine([], []);
                const step = slice.maxHz / Math.max(1, values.length - 1);
                return localLine(values.map((_, bin) => bin * step), values);
            };
            return once(['slice', track, cursorNorm, channel], () => ({
                held: 'fetched',
                line(query, ready) {
                    const source = full(ready);
                    return source ? source.line?.(query, ready) : source;
                },
                level(query, ready) {
                    const source = full(ready);
                    return source ? source.level?.(query, ready) : source;
                },
            }));
        },
        handle(message) {
            const { requestId } = message;
            if (typeof requestId !== 'string' || !requestId.startsWith(`${PREFIX}-`)) return false;
            const asked = waiting.get(requestId);
            waiting.delete(requestId);
            if (!asked) return true;
            const { done } = asked;
            const answer = message as { type: string; settingsSignature?: string; points?: StagePoints; maxFrequencyHz?: number; channels?: Array<{ channelIndex?: number; values?: number[] }> };
            // An answer made under other analysis settings (another STFT) than the read was asked under reads nothing.
            if (answer.settingsSignature !== undefined && asked.settingsSignature !== undefined && answer.settingsSignature !== asked.settingsSignature) {
                done(null);
                return true;
            }
            if (answer.type === 'spectrum-slice-result') {
                done({ slice: { maxHz: answer.maxFrequencyHz ?? 0, values: new Map((answer.channels ?? []).map((channel, index) => [channel.channelIndex ?? index, channel.values ?? []])) } });
            } else if (answer.type.endsWith('-error')) done(null);
            else done(answer.points ? { points: answer.points } : null);
            return true;
        },
        clear() { sources.clear(); slices.clear(); },
    };
}
