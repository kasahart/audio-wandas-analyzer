import type { SpectrogramDisplaySettings } from '../../shared/analysis/analysisTypes';
import type { HeightKind } from './heightResize';
import type { LoopRegion, TestAction, TrackId } from './types';

type ActionPayload = Record<string, unknown>;

function formField<T extends HTMLInputElement | HTMLSelectElement = HTMLInputElement>(doc: Document, id: string): T {
    const el = doc.getElementById(id) as T | null;
    if (!el) {
        throw new Error('Form field not found: ' + id);
    }
    return el;
}

/* eslint-disable @typescript-eslint/no-base-to-string -- test-action payloads carry JSON scalars */
export function fillSpectrogramSettingsForm(doc: Document, payload: ActionPayload): void {
    formField(doc, 'spec-auto').checked = !!payload.auto;
    if (payload.nFft != null) {
        formField(doc, 'spec-nfft').value = String(payload.nFft);
    }
    if (payload.overlapPercent != null) {
        formField<HTMLSelectElement>(doc, 'spec-overlap').value = String(payload.overlapPercent);
    }
    if (payload.window != null) {
        formField<HTMLSelectElement>(doc, 'spec-window').value = String(payload.window);
    }
}

export function fillSpectrogramDisplayForm(doc: Document, payload: ActionPayload): SpectrogramDisplaySettings {
    const setValue = function (id: string, v: unknown) {
        formField(doc, id).value = v == null ? '' : String(v);
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
/* eslint-enable @typescript-eslint/no-base-to-string */

export function loopRegionFromPayload(payload: ActionPayload): LoopRegion | null {
    const start = Math.max(0, Math.min(1, Number(payload.start)));
    const end = Math.max(0, Math.min(1, Number(payload.end)));
    return end > start ? { start, end } : null;
}

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

function testTarget<T extends Element = Element>(doc: Document, payload: ActionPayload): T {
    const el = doc.querySelector<T>(String(payload.selector));
    if (!el) {
        throw new Error('Test target not found: ' + String(payload.selector));
    }
    return el;
}

// Mouse events land on the element's centre so handlers that read clientX/clientY place popovers as for a real pointer.
export function dispatchTestMouseEvent(doc: Document, payload: ActionPayload): void {
    const el = testTarget(doc, payload);
    const rect = el.getBoundingClientRect();
    const view = doc.defaultView;
    if (!view) {
        return;
    }
    el.dispatchEvent(new view.MouseEvent(String(payload.type), {
        bubbles: true,
        cancelable: true,
        view,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
    }));
}

export function setTestInputValue(doc: Document, payload: ActionPayload): void {
    testTarget<HTMLInputElement>(doc, payload).value = String(payload.value);
}
