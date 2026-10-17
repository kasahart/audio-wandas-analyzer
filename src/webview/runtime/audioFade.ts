export const FADE_SECONDS = 0.1;
const RAMP_STEPS = 16;

export function cosineRampValues(from: number, to: number, steps = RAMP_STEPS): number[] {
    const values: number[] = [];
    for (let k = 1; k <= steps; k++) {
        values.push(from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * k / steps)));
    }
    return values;
}

export interface GainRamp {
    from: number;
    to: number;
    start: number;
    seconds: number;
    /** The ramp still in effect before `start`, when this one was queued behind it. */
    before?: GainRamp;
}

/** Gain the scheduled piecewise-linear cosine ramp produces at `time`. */
export function rampValueAt(ramp: GainRamp, time: number): number {
    if (time < ramp.start && ramp.before) {
        return rampValueAt(ramp.before, time);
    }
    if (ramp.seconds <= 0 || time >= ramp.start + ramp.seconds) {
        return ramp.to;
    }
    if (time <= ramp.start) {
        return ramp.from;
    }
    const points = [ramp.from, ...cosineRampValues(ramp.from, ramp.to)];
    const position = (time - ramp.start) / ramp.seconds * (points.length - 1);
    const k = Math.floor(position);
    return points[k] + (points[k + 1] - points[k]) * (position - k);
}

export function fadeSecondsForSpan(spanSeconds: number): number {
    return Math.max(0, Math.min(FADE_SECONDS, spanSeconds / 2));
}

type FadeParam = Pick<AudioParam, 'value' | 'cancelScheduledValues' | 'setValueAtTime' | 'linearRampToValueAtTime'>;
type FadeNode = { connect(destination: unknown): unknown; disconnect(): void };
type FadeGain = FadeNode & { gain: FadeParam };
export interface FadeContext {
    readonly currentTime: number;
    readonly state: string;
    readonly destination: unknown;
    resume(): Promise<void>;
    createGain(): FadeGain;
    createMediaElementSource(el: HTMLMediaElement): FadeNode;
}
type FadeMedia = Pick<HTMLMediaElement, 'muted' | 'paused' | 'pause'>;

export interface AudioFader {
    /** Routes the element through gain stages; call from a user gesture so the context is allowed to start. */
    prepare(el: FadeMedia): boolean;
    /** Ramps the gain to `value`; with a delay, the ramp is queued after whatever runs until then. */
    fadeTo(el: FadeMedia, value: number, seconds: number, delay?: number): void;
    pauseSmoothly(el: FadeMedia, after?: () => void, seconds?: number): void;
    isPausing(el: FadeMedia): boolean;
    setMuted(el: FadeMedia, muted: boolean): void;
    /** Disconnects a discarded element's gain stages, which would otherwise keep it alive. */
    release(el: FadeMedia): void;
}

function defaultContext(): FadeContext | null {
    const Ctor = typeof AudioContext === 'function' ? AudioContext : null;
    return Ctor ? new Ctor() as unknown as FadeContext : null;
}

export function createAudioFader(createContext: () => FadeContext | null = defaultContext, schedule: (fn: () => void, ms: number) => unknown = setTimeout, cancel: (handle: unknown) => void = handle => clearTimeout(handle as ReturnType<typeof setTimeout>)): AudioFader {
    let ctx: FadeContext | null = null;
    const routes = new WeakMap<FadeMedia, { source: FadeNode; fade: FadeGain; mute: FadeGain }>();
    const pendingMutes = new WeakMap<FadeMedia, unknown>();
    const ramps = new WeakMap<FadeParam, GainRamp>();
    const pendingPauses = new WeakMap<FadeMedia, { handle: unknown; afters: Array<() => void> }>();

    function ramp(param: FadeParam, to: number, seconds: number, delay = 0): void {
        if (!ctx) {
            return;
        }
        const now = ctx.currentTime + Math.max(0, delay);
        // AudioParam.value may report the intrinsic value rather than the automated one, so track ramps ourselves.
        const previous = ramps.get(param);
        const from = previous ? rampValueAt(previous, now) : param.value;
        const before = delay > 0 && previous ? { ...previous, before: undefined } : undefined;
        ramps.set(param, { from, to, start: now, seconds, before });
        param.cancelScheduledValues(now);
        param.setValueAtTime(from, now);
        if (seconds <= 0) {
            param.setValueAtTime(to, now);
            return;
        }
        cosineRampValues(from, to).forEach((value, k, values) => {
            param.linearRampToValueAtTime(value, now + seconds * (k + 1) / values.length);
        });
    }
    function cancelPendingPause(el: FadeMedia): void {
        const pending = pendingPauses.get(el);
        if (pending) {
            cancel(pending.handle);
            pendingPauses.delete(el);
        }
    }
    return {
        prepare(el) {
            if (routes.has(el)) {
                if (ctx && ctx.state === 'suspended') {
                    void ctx.resume();
                }
                return true;
            }
            try {
                ctx = ctx ?? createContext();
                if (!ctx) {
                    return false;
                }
                if (ctx.state === 'suspended') {
                    void ctx.resume();
                }
                const source = ctx.createMediaElementSource(el as HTMLMediaElement);
                const fade = ctx.createGain();
                const mute = ctx.createGain();
                mute.gain.value = el.muted ? 0 : 1;
                source.connect(fade);
                fade.connect(mute);
                mute.connect(ctx.destination);
                routes.set(el, { source, fade, mute });
                return true;
            }
            catch (_err) {
                return false;
            }
        },
        fadeTo(el, value, seconds, delay = 0) {
            const route = routes.get(el);
            if (!route) {
                return;
            }
            cancelPendingPause(el);
            ramp(route.fade.gain, value, seconds, delay);
        },
        pauseSmoothly(el, after, seconds = FADE_SECONDS) {
            const route = routes.get(el);
            if (!route || el.paused || seconds <= 0) {
                cancelPendingPause(el);
                if (route) {
                    ramp(route.fade.gain, 0, 0);
                }
                el.pause();
                after?.();
                return;
            }
            const pending = pendingPauses.get(el);
            if (pending) {
                if (after) {
                    pending.afters.push(after);
                }
                return;
            }
            ramp(route.fade.gain, 0, seconds);
            const afters = after ? [after] : [];
            pendingPauses.set(el, {
                afters,
                handle: schedule(() => {
                    pendingPauses.delete(el);
                    el.pause();
                    afters.forEach(fn => fn());
                }, seconds * 1000),
            });
        },
        release(el) {
            const route = routes.get(el);
            if (!route) {
                return;
            }
            routes.delete(el);
            route.source.disconnect();
            route.fade.disconnect();
            route.mute.disconnect();
        },
        isPausing(el) {
            return pendingPauses.has(el);
        },
        setMuted(el, muted) {
            const route = routes.get(el);
            if (!route) {
                el.muted = muted;
                return;
            }
            if (pendingMutes.has(el)) {
                cancel(pendingMutes.get(el));
                pendingMutes.delete(el);
            }
            ramp(route.mute.gain, muted ? 0 : 1, FADE_SECONDS);
            // The element flag follows the gain so the muted state stays observable; flipping it mid-ramp would click.
            if (muted) {
                pendingMutes.set(el, schedule(() => {
                    pendingMutes.delete(el);
                    el.muted = true;
                }, FADE_SECONDS * 1000));
            }
            else {
                el.muted = false;
            }
        },
    };
}
