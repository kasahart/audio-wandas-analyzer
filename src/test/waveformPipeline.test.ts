/**
 * renderWaveformPipeline の単体テスト。
 *
 * これは元 media/comparisonWaveform.js が公開していた window.renderWaveformPipeline
 * と同一挙動を持つ TS 実装。今後はこの TS 関数のみが単一ソース。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderWaveformPipeline, type WaveformPipelineParams } from '../webview/waveform/waveformRenderer';

interface PathOp { op: string; args: number[]; }

interface MockCtx {
    lineWidth: number;
    strokeStyle: string;
    ops: PathOp[];
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    stroke(): void;
}

function makeCtx(): MockCtx {
    const ops: PathOp[] = [];
    return {
        lineWidth: 0,
        strokeStyle: '',
        ops,
        beginPath() { ops.push({ op: 'beginPath', args: [] }); },
        moveTo(x, y) { ops.push({ op: 'moveTo', args: [x, y] }); },
        lineTo(x, y) { ops.push({ op: 'lineTo', args: [x, y] }); },
        stroke() { ops.push({ op: 'stroke', args: [] }); },
    };
}

const baseEnv = {
    min: [-0.5, -0.3, -0.4, -0.6],
    max: [0.8, 0.6, 0.7, 0.9],
    minT: [0.1, 0.3, 0.5, 0.8],
    maxT: [0.2, 0.4, 0.6, 0.9],
    absolutePeak: 0.9,
};

function defaultParams(over: Partial<WaveformPipelineParams> = {}): WaveformPipelineParams {
    return {
        zoomStart: 0,
        zoomEnd: 1,
        offsetNorm: 0,
        dataStart: 0,
        dataEnd: 1,
        color: '#4ec994',
        trackDurRatio: 1,
        lineWidth: 1.5,
        ...over,
    };
}

test('renderWaveformPipeline: 何も描画しない (空 env)', () => {
    const ctx = makeCtx();
    renderWaveformPipeline(ctx, 800, 100, { min: [], max: [], absolutePeak: 0 }, defaultParams());
    assert.equal(ctx.ops.length, 0);
});

test('renderWaveformPipeline: 通常入力で beginPath/moveTo/lineTo/stroke を呼ぶ', () => {
    const ctx = makeCtx();
    renderWaveformPipeline(ctx, 800, 100, baseEnv, defaultParams());
    const opNames = ctx.ops.map((o) => o.op);
    assert.ok(opNames.includes('beginPath'));
    assert.ok(opNames.includes('moveTo'));
    assert.ok(opNames.includes('lineTo'));
    assert.ok(opNames.includes('stroke'));
});

test('renderWaveformPipeline: lineWidth と strokeStyle がセットされる', () => {
    const ctx = makeCtx();
    renderWaveformPipeline(ctx, 800, 100, baseEnv, defaultParams({ color: '#ff00aa', lineWidth: 2.5 }));
    assert.equal(ctx.strokeStyle, '#ff00aa');
    assert.equal(ctx.lineWidth, 2.5);
});

test('renderWaveformPipeline: x 座標は offsetNorm/trackDurRatio に応じてスパン変換される', () => {
    // offsetNorm=0.5, trackDurRatio=0.5 → t=0 がグローバル norm 0.5、t=1 がグローバル 1.0。
    // zoom=[0,1], W=800 なら x はおおむね [400, 800] に収まる。
    const ctx = makeCtx();
    renderWaveformPipeline(ctx, 800, 100, baseEnv, defaultParams({ offsetNorm: 0.5, trackDurRatio: 0.5 }));
    const xs = ctx.ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo').map((o) => o.args[0]);
    assert.ok(xs.length > 0);
    for (const x of xs) {
        assert.ok(x >= 399 && x <= 801, `x=${x} should be within scaled range`);
    }
});

test('renderWaveformPipeline: y 座標は absolutePeak で正規化され H 内に収まる', () => {
    const ctx = makeCtx();
    const H = 100;
    renderWaveformPipeline(ctx, 800, H, baseEnv, defaultParams());
    const ys = ctx.ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo').map((o) => o.args[1]);
    for (const y of ys) {
        assert.ok(y >= 0 && y <= H, `y=${y} should be within canvas height`);
    }
});

test('renderWaveformPipeline: invalid amplitudeScale falls back to env absolutePeak', () => {
    const fallbackCtx = makeCtx();
    const env = {
        min: [-0.25],
        max: [0.25],
        minT: [0.5],
        maxT: [0.5],
        absolutePeak: 0.5,
    };
    renderWaveformPipeline(fallbackCtx, 800, 100, env, defaultParams());
    const fallbackYs = fallbackCtx.ops
        .filter((o) => o.op === 'moveTo' || o.op === 'lineTo')
        .map((o) => o.args[1]);

    for (const amplitudeScale of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
        const ctx = makeCtx();
        renderWaveformPipeline(ctx, 800, 100, env, defaultParams({ amplitudeScale }));
        const ys = ctx.ops
            .filter((o) => o.op === 'moveTo' || o.op === 'lineTo')
            .map((o) => o.args[1]);
        assert.deepEqual(ys, fallbackYs);
    }
});

test('renderWaveformPipeline: falls back to 1 when amplitudeScale and env absolutePeak are invalid', () => {
    const invalidEnv = {
        min: [-0.25],
        max: [0.25],
        minT: [0.5],
        maxT: [0.5],
        absolutePeak: 0,
    };
    const explicitOneCtx = makeCtx();
    renderWaveformPipeline(explicitOneCtx, 800, 100, invalidEnv, defaultParams({ amplitudeScale: 1 }));
    const explicitOneYs = explicitOneCtx.ops
        .filter((o) => o.op === 'moveTo' || o.op === 'lineTo')
        .map((o) => o.args[1]);

    for (const amplitudeScale of [Number.NaN, Number.POSITIVE_INFINITY, 0]) {
        const ctx = makeCtx();
        renderWaveformPipeline(ctx, 800, 100, invalidEnv, defaultParams({ amplitudeScale }));
        const ys = ctx.ops
            .filter((o) => o.op === 'moveTo' || o.op === 'lineTo')
            .map((o) => o.args[1]);
        assert.deepEqual(ys, explicitOneYs);
    }
});

test('renderWaveformPipeline: explicit amplitudeScale keeps Y stable for range waveform data', () => {
    const overviewCtx = makeCtx();
    const rangeCtx = makeCtx();
    const H = 100;
    const overviewEnv = {
        min: [-1.0, -0.25, -0.25],
        max: [1.0, 0.25, 0.25],
        minT: [0.0, 0.5, 0.75],
        maxT: [0.0, 0.5, 0.75],
        absolutePeak: 1.0,
    };
    const rangeEnv = {
        min: [-0.25],
        max: [0.25],
        minT: [0.5],
        maxT: [0.5],
        absolutePeak: 0.25,
    };

    renderWaveformPipeline(overviewCtx, 800, H, overviewEnv, defaultParams({
        zoomStart: 0.45,
        zoomEnd: 0.55,
        amplitudeScale: 1.0,
    }));
    renderWaveformPipeline(rangeCtx, 800, H, rangeEnv, defaultParams({
        zoomStart: 0.45,
        zoomEnd: 0.55,
        dataStart: 0.45,
        dataEnd: 0.55,
        amplitudeScale: 1.0,
    }));

    const overviewYs = overviewCtx.ops
        .filter((o) => o.op === 'moveTo' || o.op === 'lineTo')
        .map((o) => o.args[1]);
    const rangeYs = rangeCtx.ops
        .filter((o) => o.op === 'moveTo' || o.op === 'lineTo')
        .map((o) => o.args[1]);

    assert.ok(overviewYs.includes(61));
    assert.ok(overviewYs.includes(39));
    assert.deepEqual(rangeYs, [61, 39]);
});


test('renderWaveformPipeline: range waveform minT/maxT are full-file normalized', () => {
    const ctx = makeCtx();
    const H = 100;
    const rangeEnv = {
        min: [-0.25],
        max: [0.25],
        minT: [0.5],
        maxT: [0.5],
        absolutePeak: 0.25,
    };

    renderWaveformPipeline(ctx, 800, H, rangeEnv, defaultParams({
        zoomStart: 0.45,
        zoomEnd: 0.55,
        dataStart: 0.45,
        dataEnd: 0.55,
        amplitudeScale: 1.0,
    }));

    const points = ctx.ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo');
    const xs = points.map((o) => o.args[0]);
    const ys = points.map((o) => o.args[1]);

    assert.equal(xs.length, 2);
    assert.ok(xs.every((x) => Math.abs(x - 400) < 1e-9), `xs=${JSON.stringify(xs)}`);
    assert.deepEqual(ys, [61, 39]);
});


test('renderWaveformPipeline: i1 < i0 のとき何も描画しない (zoom 外)', () => {
    // データ範囲が描画範囲外
    const ctx = makeCtx();
    renderWaveformPipeline(ctx, 800, 100, baseEnv, defaultParams({
        zoomStart: 2,
        zoomEnd: 3,
        offsetNorm: 0,
        trackDurRatio: 1,
    }));
    assert.equal(ctx.ops.length, 0);
});

test('renderWaveformPipeline: dist/webview/comparisonWaveform.js に同じ署名で公開される', () => {
    // 生成された JS が window.renderWaveformPipeline を提供することを担保するスモークテスト。
    // 実体検証は renderScript.integration.test.ts の jsdom 経由でも行う。
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const generated = path.join(__dirname, '..', 'webview', 'comparisonWaveform.js');
    const content = fs.readFileSync(generated, 'utf8');
    assert.match(content, /AUTO-GENERATED by scripts\/build-webview\.js/);
    assert.match(content, /window\.renderWaveformPipeline\s*=\s*exports\.renderWaveformPipeline/);
    assert.match(content, /window\.paintLoopRegion\s*=\s*exports\.paintLoopRegion/);
});
