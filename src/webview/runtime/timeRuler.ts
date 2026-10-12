import { formatClockTime } from '../../shared/utils/format';

export interface RulerTick {
    x: number;
    label: string;
}

export function niceTimeStep(dur: number): number {
    const steps = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30];
    for (let i = 0; i < steps.length; i++) {
        if (dur / steps[i] <= 8) {
            return steps[i];
        }
    }
    return 60;
}

export function rulerTicks(visStartSec: number, visEndSec: number, plotWidth: number): RulerTick[] {
    const visDur = visEndSec - visStartSec;
    const step = niceTimeStep(visDur);
    const ticks: RulerTick[] = [];
    let t = Math.ceil(visStartSec / step) * step;
    while (t <= visEndSec) {
        ticks.push({ x: (t - visStartSec) / visDur * plotWidth, label: formatClockTime(t) });
        t += step;
    }
    return ticks;
}
