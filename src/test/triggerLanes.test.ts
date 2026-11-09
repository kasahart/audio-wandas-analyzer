import assert from 'node:assert/strict';
import test from 'node:test';
import type { StageView } from '../shared/protocol/backendProtocol';
import { localLine } from '../webview/runtime/fullRead';
import { stageHover, stageStep } from '../webview/runtime/stagePanes';
import type { Drawn, StageTrack } from '../webview/runtime/trackStagePainter';
import { paintTriggerLanes, type TriggerLanesFrame } from '../webview/runtime/triggerLanes';

/** A canvas the plot component draws on through a context that draws nothing. */
function laneCanvas(): HTMLCanvasElement {
    const context = new Proxy({}, { get: (_target, key) => (key === 'measureText' ? (text: string) => ({ width: text.length * 6 }) : () => undefined), set: () => true });
    return { width: 0, height: 0, clientWidth: 600, clientHeight: 160, offsetLeft: 0, parentElement: null, ownerDocument: {}, dataset: {} as DOMStringMap, getContext: () => context } as unknown as HTMLCanvasElement;
}

const RATE = 4800;
/** One second of a recording: a 50 Hz tone at `amplitude` and one sample at `spike`, every sample, and its envelope in 200 blocks. */
function recording(amplitude: number, spike: number): { samples: number[]; times: number[]; view: StageView } {
    const times = Array.from({ length: RATE }, (_, index) => index / RATE);
    const samples = times.map(time => amplitude * Math.sin(2 * Math.PI * 50 * time));
    samples[2401] = spike;
    const blocks = 200, size = RATE / blocks;
    const min: number[] = [], max: number[] = [], minT: number[] = [], maxT: number[] = [];
    for (let block = 0; block < blocks; block++) {
        const part = samples.slice(block * size, (block + 1) * size);
        const low = part.indexOf(Math.min(...part)), high = part.indexOf(Math.max(...part));
        min.push(part[low]); max.push(part[high]); minT.push(times[block * size + low]); maxT.push(times[block * size + high]);
    }
    // The backend's absolutePeak is every sample's largest magnitude.
    const absolutePeak = Math.max(...samples.map(Math.abs));
    const view = {
        frame: 'ChannelFrame', kind: 'line', x: 'time', xScale: 'linear', quantity: 'value', unit: 'FS', xs: [0, 1], values: [0, 0],
        waveform: { min, max, minT, maxT, absolutePeak, unit: 'FS', ref: 1 },
    } as StageView;
    return { samples, times, view };
}

function lanes(threshold: number, recordings: Record<string, ReturnType<typeof recording>>, inputs: Record<string, StageTrack['input']> = {}): { drawn: Map<Element, Drawn>; canvases: Record<string, HTMLCanvasElement> } {
    const canvases = Object.fromEntries(Object.keys(recordings).map(path => [path, laneCanvas()]));
    const drawn = new Map<Element, Drawn>();
    const frame: TriggerLanesFrame = {
        strings: { stageThreshold: 'Level {value} {unit}', stageEventPlay: 'Play {n}', stageEventOutButton: 'Leave out {n}', stageEventInButton: 'Put back {n}', stageEventsUsed: '{used}/{total}' },
        tracks: Object.keys(recordings).map(filePath => ({ filePath, color: '#00f', canvas: canvases[filePath], axis: null, input: inputs[filePath] })),
        signal: path => recordings[path]?.view,
        events: () => [{ id: 0, time: 0.5 }] as NonNullable<StageView['events']>,
        excluded: () => [],
        color: () => '#00f',
        trigger: { threshold, channel: 0, duration: 0.1, pre: 0.01 },
        axes: () => ({ x: 'Time [s]', y: 'Amplitude [FS]' }),
        window: { x: { start: 0, end: 1 }, y: { start: 0, end: 1 } },
        drawnOn: drawn,
        // Every sample, as the backend reads it (R7).
        fullOf: view => {
            const found = Object.values(recordings).find(item => item.view === view);
            return found ? localLine(found.times, found.samples) : undefined;
        },
    };
    paintTriggerLanes(frame);
    return { drawn, canvases };
}

test('the trigger lanes of one level identity share a range holding every sample\'s peak of each recording and the trigger\'s level, not the envelope drawn (R1)', () => {
    const loud = recording(0.2, -0.93), quiet = recording(0.05, 0.1);
    const { drawn, canvases } = lanes(0.4, { '/a.wav': loud, '/b.wav': quiet });
    const range = drawn.get(canvases['/a.wav'])?.range;
    assert.ok(range);
    assert.deepEqual(drawn.get(canvases['/b.wav'])?.range, range, 'one range for the lanes of one identity');
    // The loud one's one-sample spike (−0.93 FS) is its peak: the range holds it whole, both ways round 0.
    assert.ok(range.min <= -0.93 && range.max >= 0.93, `${range.min}..${range.max}`);
    assert.ok(range.max < 1.2, 'no wider than the peak and a margin');
    // A trigger level above every sample stays in sight.
    const high = lanes(1.5, { '/a.wav': loud }).drawn.values().next().value?.range;
    assert.ok(high && high.max >= 1.5, `${high?.max}`);
    // Both ends round (R9), with the level held as with the peaks.
    for (const [threshold, value] of [[0.4, range], [1.5, high], [0.37, lanes(0.37, { '/b.wav': quiet }).drawn.values().next().value?.range]] as const) {
        assert.ok(value);
        for (const end of [value.min, value.max]) assert.equal(Number(end.toPrecision(2)), end, `level ${threshold}: ${value.min}..${value.max} at round ends`);
        assert.ok(value.max >= threshold);
    }
});

test('trigger lanes of another level identity never share a range: a lane in Pa is not on a full-scale lane\'s scale (A43, R1, R4)', () => {
    const fs = { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS', calibrationStatus: 'uncalibrated', fullScale: true } as const;
    const pa = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa', calibrationStatus: 'calibrated', fullScale: false } as const;
    const loud = recording(0.2, -0.93), quiet = recording(0.05, 0.1), other = recording(0.05, 0.1);
    const { drawn, canvases } = lanes(0.04, { '/a.wav': loud, '/b.wav': quiet, '/c.wav': other }, { '/a.wav': fs, '/b.wav': pa, '/c.wav': { ...fs, calibrationStatus: 'calibrated' } });
    const a = drawn.get(canvases['/a.wav'])?.range, b = drawn.get(canvases['/b.wav'])?.range, c = drawn.get(canvases['/c.wav'])?.range;
    assert.ok(a && b && c);
    assert.notDeepEqual(b, a, 'Pa has its own range');
    assert.ok(b.max < 0.5, `the quiet Pa lane is not widened to the loud FS one's spike: ${b.min}..${b.max}`);
    assert.deepEqual(c, a, 'a gain-corrected FS lane is of the same identity as a raw one (R1): one range');
});

test('a trigger lane is read at every sample: the pointer reads a sample between the envelope\'s points, and ← / → go one sample at a time (R7)', () => {
    const loud = recording(0.2, -0.93);
    const { drawn, canvases } = lanes(0.4, { '/a.wav': loud });
    const plot = drawn.get(canvases['/a.wav'])?.plot;
    assert.ok(plot);
    const at = 3005;
    const drawnTimes = new Set([...(loud.view.waveform?.minT ?? []), ...(loud.view.waveform?.maxT ?? [])]);
    assert.ok(!drawnTimes.has(loud.times[at]), 'the sample is thinned out of the envelope drawn');
    const read = stageHover(plot, plot.xAt(loud.times[at]), (plot.lineYAt ?? plot.yAt)(loud.samples[at]));
    assert.ok(read && read.full, 'read from every sample');
    let step = read;
    const index = loud.times.indexOf(read.at as number);
    assert.ok(index >= 0);
    for (let n = 1; n <= 5; n++) {
        const next = stageStep(plot, step, 1);
        assert.ok(next);
        assert.equal(next.at, loud.times[index + n], `step ${n} is the next sample`);
        assert.equal(next.value, loud.samples[index + n]);
        step = next;
    }
});
