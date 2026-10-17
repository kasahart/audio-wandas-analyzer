export const FADE_SECONDS = 0.1;
const RAMP_STEPS = 16;

export function cosineRampValues(from: number, to: number, steps = RAMP_STEPS): number[] {
    const values: number[] = [];
    for (let k = 1; k <= steps; k++) {
        values.push(from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * k / steps)));
    }
    return values;
}

export function fadeSecondsForSpan(spanSeconds: number): number {
    return Math.max(0, Math.min(FADE_SECONDS, spanSeconds / 2));
}

type FadeParam = Pick<AudioParam, 'value' | 'cancelScheduledValues' | 'setValueAtTime' | 'linearRampToValueAtTime'> & Partial<Pick<AudioParam, 'cancelAndHoldAtTime'>>;
type FadeGain = { gain: FadeParam; connect(destination: unknown): unknown };
export interface FadeContext {
    readonly currentTime: number;
    readonly state: string;
    readonly destination: unknown;
    resume(): Promise<void>;
    createGain(): FadeGain;
    createMediaElementSource(el: HTMLMediaElement): { connect(destination: unknown): unknown };
}
type FadeMedia = Pick<HTMLMediaElement, 'muted' | 'paused' | 'pause'>;

export interface AudioFader {
    /** Routes the element through gain stages; call from a user gesture so the context is allowed to start. */
    prepare(el: FadeMedia): boolean;
    fadeTo(el: FadeMedia, value: number, seconds: number): void;
    pauseSmoothly(el: FadeMedia, after?: () => void): void;
    isPausing(el: FadeMedia): boolean;
    setMuted(el: FadeMedia, muted: boolean): void;
}

function defaultContext(): FadeContext | null {
    const Ctor = typeof AudioContext === 'function' ? AudioContext : null;
    return Ctor ? new Ctor() as unknown as FadeContext : null;
}

export function createAudioFader(createContext: () => FadeContext | null = defaultContext, schedule: (fn: () => void, ms: number) => unknown = setTimeout, cancel: (handle: unknown) => void = handle => clearTimeout(handle as ReturnType<typeof setTimeout>)): AudioFader {
    let ctx: FadeContext | null = null;
    const routes = new WeakMap<FadeMedia, { fade: FadeGain; mute: FadeGain }>();
    const pendingMutes = new WeakMap<FadeMedia, unknown>();
    const pendingPauses = new WeakMap<FadeMedia, { handle: unknown; afters: Array<() => void> }>();

    function ramp(param: FadeParam, to: number, seconds: number): void {
        if (!ctx) {
            return;
        }
        const now = ctx.currentTime;
        const from = param.value;
        // cancelScheduledValues alone would snap an in-flight ramp back to its starting value.
        if (param.cancelAndHoldAtTime) {
            param.cancelAndHoldAtTime(now);
        }
        else {
            param.cancelScheduledValues(now);
        }
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
                routes.set(el, { fade, mute });
                return true;
            }
            catch (_err) {
                return false;
            }
        },
        fadeTo(el, value, seconds) {
            const route = routes.get(el);
            if (!route) {
                return;
            }
            if (value > 0) {
                cancelPendingPause(el);
            }
            ramp(route.fade.gain, value, seconds);
        },
        pauseSmoothly(el, after) {
            const route = routes.get(el);
            if (!route || el.paused) {
                cancelPendingPause(el);
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
            ramp(route.fade.gain, 0, FADE_SECONDS);
            const afters = after ? [after] : [];
            pendingPauses.set(el, {
                afters,
                handle: schedule(() => {
                    pendingPauses.delete(el);
                    el.pause();
                    afters.forEach(fn => fn());
                }, FADE_SECONDS * 1000),
            });
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
