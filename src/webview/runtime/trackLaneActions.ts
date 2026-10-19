import { eventTarget } from './domAdapter';
import type { TrackId } from './types';

export type TrackLaneAction =
    | 'toggle-playback'
    | 'toggle-mute'
    | 'stop-playback'
    | 'remove-track'
    | 'configure-calibration'
    | 'offset-up'
    | 'offset-down'
    | 'pick-color'
    | 'set-pair-reference';

export interface TrackLaneContext {
    trackId: TrackId;
    trackIndex: number | null;
    target: HTMLElement;
    event: Event;
}

export type TrackLaneHandlers = Record<TrackLaneAction, (ctx: TrackLaneContext) => void>;

export interface TrackLaneResolver {
    trackIdFromElement(element: HTMLElement): TrackId | null;
    trackIndexForId(trackId: TrackId): number | null;
}

function laneContext(event: Event, resolver: TrackLaneResolver): (TrackLaneContext & { action: string }) | null {
    const target = eventTarget(event);
    const action = target.getAttribute ? target.getAttribute('data-action') : null;
    const trackId = resolver.trackIdFromElement(target);
    if (!action || !trackId) {
        return null;
    }
    return { action, trackId, trackIndex: resolver.trackIndexForId(trackId), target, event };
}

export function attachTrackLaneActions(wrapper: HTMLElement, resolver: TrackLaneResolver, handlers: TrackLaneHandlers): void {
    wrapper.addEventListener('click', function (e) {
        const ctx = laneContext(e, resolver);
        if (ctx && Object.hasOwn(handlers, ctx.action)) {
            handlers[ctx.action as TrackLaneAction](ctx);
        }
    });
    wrapper.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') {
            return;
        }
        const ctx = laneContext(e, resolver);
        if (ctx && ctx.action === 'pick-color') {
            e.preventDefault();
            handlers['pick-color'](ctx);
        }
    });
}
