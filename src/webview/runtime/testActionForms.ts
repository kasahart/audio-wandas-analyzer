import type { SpectrogramDisplaySettings } from '../../shared/analysis/analysisTypes';
import type { HeightKind } from './heightResize';
import type { LoopRegion, RuntimeDocument, TestAction, TrackId } from './types';

type ActionPayload = Record<string, unknown>;

export function fillSpectrogramSettingsForm(doc: RuntimeDocument, payload: ActionPayload): void {
    doc.getElementById('spec-auto').checked = !!payload.auto;
    if (payload.nFft != null) {
        doc.getElementById('spec-nfft').value = String(payload.nFft);
    }
    if (payload.hopSize != null) {
        doc.getElementById('spec-hop').value = String(payload.hopSize);
    }
    if (payload.window != null) {
        doc.getElementById('spec-window').value = String(payload.window);
    }
}

export function fillSpectrogramDisplayForm(doc: RuntimeDocument, payload: ActionPayload): SpectrogramDisplaySettings {
    const setValue = function (id: string, v: unknown) {
        doc.getElementById(id).value = v == null ? '' : String(v);
    };
    setValue('spec-dbmin', payload.dbMin);
    setValue('spec-dbmax', payload.dbMax);
    setValue('spec-maxfreq', payload.maxFrequencyHz);
    return {
        dbMin: typeof payload.dbMin === 'number' ? payload.dbMin : null,
        dbMax: typeof payload.dbMax === 'number' ? payload.dbMax : null,
        maxFrequencyHz: typeof payload.maxFrequencyHz === 'number' ? payload.maxFrequencyHz : null,
    };
}

export function setSelectionFileChecked(doc: RuntimeDocument, filePath: unknown, selected: boolean): void {
    const checkbox = Array.from(doc.querySelectorAll('.selection-file-checkbox'))
        .find((input) => input.getAttribute('data-file-path') === filePath);
    if (!checkbox) {
        throw new Error('Selection checkbox not found');
    }
    checkbox.checked = selected;
    const event = doc.createEvent('Event');
    event.initEvent('change', true, false);
    checkbox.dispatchEvent(event);
}

export function loopRegionFromPayload(payload: ActionPayload): LoopRegion | null {
    const start = Math.max(0, Math.min(1, Number(payload.start)));
    const end = Math.max(0, Math.min(1, Number(payload.end)));
    return end > start ? { start, end } : null;
}

// An explicit trackId wins only while that track still exists; otherwise fall back to the positional trackIndex.
export function testActionTrackId(
    entry: TestAction,
    isKnownTrack: (trackId: TrackId) => boolean,
    trackIdAtIndex: (trackIndex: number) => TrackId | null,
): TrackId | null {
    const requested = typeof entry.trackId === 'string' ? entry.trackId as TrackId : null;
    if (requested && isKnownTrack(requested)) {
        return requested;
    }
    return typeof entry.trackIndex === 'number' ? trackIdAtIndex(entry.trackIndex) : null;
}

export interface HeightDragRequest {
    kind: HeightKind;
    startY: number;
    endY: number;
}

export function heightDragFromPayload(payload: ActionPayload): HeightDragRequest {
    const startY = Number(payload.startY || 0);
    return {
        kind: payload.kind === 'spectrum' ? 'spectrum' : 'track',
        startY,
        endY: Number(payload.endY || startY),
    };
}
