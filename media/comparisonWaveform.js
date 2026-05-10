// media/comparisonWaveform.js
// waveformRenderer.ts の decimateBuckets + makeCoordTransform + paintDecimatedPoints と
// 同一ロジックを実装する。クロージャ参照なし。すべての入力が params で渡される。
(function () {
    'use strict';

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} W - canvas width
     * @param {number} H - canvas height
     * @param {{ min: number[], max: number[], minT?: number[], maxT?: number[], samples?: number[], absolutePeak: number }} env
     * @param {{ zoomStart: number, zoomEnd: number, offsetNorm: number,
     *           dataStart: number, dataEnd: number, color: string, lineWidth?: number }} params
     */
    function renderWaveformPipeline(ctx, W, H, env, params) {
        const { zoomStart, zoomEnd, offsetNorm, dataStart, dataEnd, color } = params;
        const lineWidth = params.lineWidth ?? 1.5;
        const peak = env.absolutePeak || 1;
        const minArr = env.min || [];
        const maxArr = env.max || [];
        const samplesArr = env.samples || [];
        const n = minArr.length || samplesArr.length;
        if (n === 0) { return; }

        const dataRange = Math.max(dataEnd - dataStart, 1e-9);
        const span = Math.max(zoomEnd - zoomStart, 1e-9);

        // ── Layer 2: computeViewRange ──
        const visStartNorm = (zoomStart - offsetNorm - dataStart) / dataRange;
        const visEndNorm   = (zoomEnd   - offsetNorm - dataStart) / dataRange;
        const extSpan = span / dataRange;
        const i0 = Math.max(0, Math.floor((visStartNorm - extSpan) * n));
        const i1 = Math.min(n - 1, Math.ceil((visEndNorm + extSpan) * n));
        if (i1 < i0) { return; }

        const visI0 = Math.max(0, Math.floor(visStartNorm * n) - 1);
        const visI1 = Math.min(n - 1, Math.ceil(visEndNorm * n) + 1);
        const div = Math.max(1, Math.floor(Math.max(1, visI1 - visI0 + 1) / (W * 2)));

        function lo(i) { return minArr.length > i ? minArr[i] : (samplesArr[i] ?? 0); }
        function hi(i) { return maxArr.length > i ? maxArr[i] : (samplesArr[i] ?? 0); }
        function tOfMin(idx) {
            return (env.minT && env.minT.length > idx) ? env.minT[idx] : dataStart + (idx / n) * dataRange;
        }
        function tOfMax(idx) {
            return (env.maxT && env.maxT.length > idx) ? env.maxT[idx] : dataStart + (idx / n) * dataRange;
        }

        // ── Layer 1: CoordTransform ──
        function toX(t) { return ((t + offsetNorm - zoomStart) / span) * W; }
        function toY(v) { return H / 2 - (v / peak) * (H * 0.44); }

        // ── Layer 3: paintDecimatedPoints ──
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = color;
        ctx.beginPath();
        let started = false;

        for (let b = i0; b <= i1; b += div) {
            const bEnd = Math.min(i1 + 1, b + div);
            let minIdx = b, maxIdx = b;
            let minVal = lo(b), maxVal = hi(b);
            for (let i = b + 1; i < bEnd; i++) {
                const l = lo(i), h = hi(i);
                if (l < minVal) { minVal = l; minIdx = i; }
                if (h > maxVal) { maxVal = h; maxIdx = i; }
            }
            const tMin = tOfMin(minIdx);
            const tMax = tOfMax(maxIdx);
            const fx = tMin <= tMax ? toX(tMin) : toX(tMax);
            const fy = tMin <= tMax ? toY(minVal) : toY(maxVal);
            const sx = tMin <= tMax ? toX(tMax) : toX(tMin);
            const sy = tMin <= tMax ? toY(maxVal) : toY(minVal);
            if (!started) { ctx.moveTo(fx, fy); started = true; } else { ctx.lineTo(fx, fy); }
            ctx.lineTo(sx, sy);
        }
        ctx.stroke();
    }

    // グローバルに公開
    window.renderWaveformPipeline = renderWaveformPipeline;
})();
