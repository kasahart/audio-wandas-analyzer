/**
 * Renderer for ChartSpec dicts inside the ChartSpecPanel webview.
 *
 * Exposes a single function string `getChartSpecRenderScript()` that the
 * panel inlines into its HTML. The script defines four renderers — line,
 * heatmap, bar, scalar — and walks `window.__CHART_SPECS__` once on load,
 * appending a labelled `<canvas>` (or `<table>` for scalar) to `#charts`
 * for each spec.
 *
 * Drawing is intentionally minimal Canvas2D — no zoom/cursor — because the
 * panel is for one-shot recipe output. The webview keeps no state beyond
 * the initial paint.
 */

export function getChartSpecRenderScript(): string {
    return `(function() {
    'use strict';

    const rangeOverrides = {};   // chartIndex → { min: number, max: number } (wired in Task 2/3/4)
    const chartRedraws   = [];   // chartIndex → function(override) (wired in Task 2/3)
    let   activeChartIdx = -1;   // 現在ポップアップが開いているチャート index (wired in Task 2/3/4)

    // ── レンジポップアップ ────────────────────────────────────────
    (function buildRangePopup() {
        if (document.getElementById('range-popup')) { return; }
        const pop = document.createElement('div');
        pop.id = 'range-popup';
        pop.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--vscode-editorWidget-background,#2d2d2d);border:1px solid var(--vscode-editorWidget-border,#555);border-radius:4px;padding:10px 12px;font-size:12px;color:var(--vscode-editor-foreground,#ddd);box-shadow:0 4px 12px rgba(0,0,0,.4);min-width:180px;';
        pop.innerHTML = '<div style="margin-bottom:6px;font-weight:600;font-size:11px;color:var(--vscode-descriptionForeground,#aaa)">Range</div>'
            + '<div style="display:flex;flex-direction:column;gap:6px;">'
            + '<label style="display:flex;align-items:center;gap:6px;"><span style="width:30px">Min</span><input id="range-min" type="number" step="any" style="width:80px;background:var(--vscode-input-background,#3c3c3c);color:inherit;border:1px solid var(--vscode-input-border,#555);border-radius:2px;padding:2px 4px;font-size:12px;"></label>'
            + '<label style="display:flex;align-items:center;gap:6px;"><span style="width:30px">Max</span><input id="range-max" type="number" step="any" style="width:80px;background:var(--vscode-input-background,#3c3c3c);color:inherit;border:1px solid var(--vscode-input-border,#555);border-radius:2px;padding:2px 4px;font-size:12px;"></label>'
            + '</div>'
            + '<div style="display:flex;gap:6px;margin-top:8px;">'
            + '<button id="range-apply" style="flex:1;padding:3px 0;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:2px;cursor:pointer;font-size:11px;">Apply</button>'
            + '<button id="range-auto"  style="flex:1;padding:3px 0;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ddd);border:none;border-radius:2px;cursor:pointer;font-size:11px;">Auto</button>'
            + '<button id="range-close" style="padding:3px 6px;background:transparent;color:var(--vscode-descriptionForeground,#aaa);border:none;cursor:pointer;font-size:13px;" aria-label="Close">×</button>'
            + '</div>'
            + '<div id="range-error" style="color:#f48771;font-size:11px;margin-top:4px;min-height:14px;"></div>';
        document.body.appendChild(pop);
    })();

    const specs = Array.isArray(window.__CHART_SPECS__) ? window.__CHART_SPECS__ : [];
    const host = document.getElementById('charts');
    if (!host) { return; }
    if (specs.length === 0) {
        host.textContent = window.__CHART_NO_RESULTS_LABEL__ || 'No chart specs returned.';
        return;
    }

    function colorAt(index) {
        const palette = ['#4ea1ff','#ff7e6b','#7fd97f','#d6a3ff','#ffd166','#ef476f','#06d6a0','#118ab2'];
        return palette[index % palette.length];
    }
    function cssVar(name, fallback) {
        const v = getComputedStyle(document.body).getPropertyValue(name);
        const trimmed = v ? v.trim() : '';
        return trimmed || fallback;
    }

    function attachCard(title, body) {
        const card = document.createElement('section');
        card.className = 'chart-card';
        const h = document.createElement('h3');
        h.className = 'chart-title';
        h.textContent = title || '';
        card.appendChild(h);
        card.appendChild(body);
        host.appendChild(card);
    }

    function setupCanvas(width, height) {
        const c = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
        c.style.width = width + 'px';
        c.style.height = height + 'px';
        const ctx = c.getContext('2d');
        ctx.scale(dpr, dpr);
        return { canvas: c, ctx: ctx, width: width, height: height };
    }

    function drawFrame(ctx, x, y, w, h) {
        ctx.strokeStyle = cssVar('--line', '#666');
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
    }

    function drawAxisLabels(ctx, plot, spec, xRange, yRange, opts) {
        ctx.fillStyle = cssVar('--muted', '#aaa');
        ctx.font = '10px monospace';
        const x0 = plot.x, y0 = plot.y, w = plot.w, h = plot.h;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 4; i++) {
            const v = yRange.max - (i / 4) * (yRange.max - yRange.min);
            const py = y0 + (i / 4) * h;
            ctx.fillText(v.toFixed(opts && opts.yDecimals != null ? opts.yDecimals : 1), x0 - 4, py);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= 4; i++) {
            const v = xRange.min + (i / 4) * (xRange.max - xRange.min);
            const px = x0 + (i / 4) * w;
            ctx.fillText(v.toFixed(opts && opts.xDecimals != null ? opts.xDecimals : 0), px, y0 + h + 4);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(spec.xLabel || '', x0 + w / 2, y0 + h + 18);
        ctx.save();
        ctx.translate(x0 - 36, y0 + h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(spec.yLabel || '', 0, 0);
        ctx.restore();
    }

    function drawLine(spec) {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot = { x: 50, y: 16, w: cv.width - 60, h: cv.height - 50 };
        drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);

        const xs = spec.xs || [];
        const series = spec.series || [];
        if (xs.length === 0 || series.length === 0) { attachCard(spec.title, cv.canvas); return; }

        let yMin = Infinity, yMax = -Infinity;
        for (const s of series) {
            for (const y of s.ys || []) {
                if (!Number.isFinite(y)) { continue; }
                if (y < yMin) { yMin = y; }
                if (y > yMax) { yMax = y; }
            }
        }
        if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 1; }
        if (yMin === yMax) { yMax = yMin + 1; }
        const xMin = xs[0], xMax = xs[xs.length - 1];

        const yToPx = function(v) { return plot.y + plot.h - ((v - yMin) / (yMax - yMin)) * plot.h; };
        const xToPx = function(v) { return plot.x + ((v - xMin) / (xMax - xMin || 1)) * plot.w; };

        series.forEach(function(s, idx) {
            ctx.strokeStyle = colorAt(idx);
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            const ys = s.ys || [];
            for (let i = 0; i < xs.length && i < ys.length; i++) {
                const px = xToPx(xs[i]);
                const py = yToPx(ys[i]);
                if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
            }
            ctx.stroke();
        });

        drawAxisLabels(ctx, plot, spec, { min: xMin, max: xMax }, { min: yMin, max: yMax }, {
            yDecimals: (spec.yScale === 'db') ? 0 : 2,
            xDecimals: xMax >= 100 ? 0 : 2,
        });

        // legend
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let lx = plot.x + 8;
        const ly = plot.y + 8;
        series.forEach(function(s, idx) {
            ctx.fillStyle = colorAt(idx);
            ctx.fillRect(lx, ly - 4, 10, 8);
            ctx.fillStyle = cssVar('--text', '#ddd');
            const name = (s && s.name) ? s.name : ('series ' + (idx + 1));
            ctx.fillText(name, lx + 14, ly);
            lx += 14 + Math.max(40, ctx.measureText(name).width + 18);
        });

        attachCard(spec.title, cv.canvas);
    }

    function drawHeatmap(spec) {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot = { x: 50, y: 16, w: cv.width - 90, h: cv.height - 50 };
        drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);
        const matrix = spec.matrix || [];
        const rows = matrix.length;
        const cols = rows > 0 ? matrix[0].length : 0;
        if (rows === 0 || cols === 0) { attachCard(spec.title, cv.canvas); return; }

        let vMin = (spec.vmin != null) ? spec.vmin : Infinity;
        let vMax = (spec.vmax != null) ? spec.vmax : -Infinity;
        if (spec.vmin == null || spec.vmax == null) {
            for (let r = 0; r < rows; r++) {
                const row = matrix[r];
                for (let c = 0; c < cols; c++) {
                    const v = row[c];
                    if (!Number.isFinite(v)) { continue; }
                    if (v < vMin) { vMin = v; }
                    if (v > vMax) { vMax = v; }
                }
            }
        }
        if (!isFinite(vMin) || !isFinite(vMax)) { vMin = 0; vMax = 1; }
        if (vMin === vMax) { vMax = vMin + 1; }

        const cellW = plot.w / cols;
        const cellH = plot.h / rows;
        // Note: matrix[0] is the lowest y (first row) — draw from bottom to top.
        for (let r = 0; r < rows; r++) {
            const yPx = plot.y + plot.h - (r + 1) * cellH;
            const row = matrix[r];
            for (let c = 0; c < cols; c++) {
                const v = row[c];
                const t = Number.isFinite(v) ? Math.max(0, Math.min(1, (v - vMin) / (vMax - vMin))) : 0;
                ctx.fillStyle = sampleColormap(spec.colormap, t);
                ctx.fillRect(plot.x + c * cellW, yPx, cellW + 0.5, cellH + 0.5);
            }
        }

        const xs = spec.xs || [];
        const ys = spec.ys || [];
        const xMinAxis = xs.length > 0 ? xs[0] : 0;
        const xMaxAxis = xs.length > 0 ? xs[xs.length - 1] : cols;
        const yMinAxis = ys.length > 0 ? ys[0] : 0;
        const yMaxAxis = ys.length > 0 ? ys[ys.length - 1] : rows;
        drawAxisLabels(ctx, plot, spec,
            { min: xMinAxis, max: xMaxAxis },
            { min: yMinAxis, max: yMaxAxis },
            { xDecimals: 2, yDecimals: 0 });

        // colour bar
        const cbX = plot.x + plot.w + 8;
        const cbW = 14, cbH = plot.h;
        for (let i = 0; i < cbH; i++) {
            const t = 1 - (i / cbH);
            ctx.fillStyle = sampleColormap(spec.colormap, t);
            ctx.fillRect(cbX, plot.y + i, cbW, 1);
        }
        ctx.strokeStyle = cssVar('--line', '#666');
        ctx.strokeRect(cbX, plot.y, cbW, cbH);
        ctx.fillStyle = cssVar('--muted', '#aaa');
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(vMax.toFixed(0), cbX + cbW + 2, plot.y);
        ctx.textBaseline = 'bottom';
        ctx.fillText(vMin.toFixed(0), cbX + cbW + 2, plot.y + cbH);

        attachCard(spec.title, cv.canvas);
    }

    function drawBar(spec) {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot = { x: 50, y: 16, w: cv.width - 60, h: cv.height - 50 };
        drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);

        const cats = spec.categories || [];
        const series = spec.series || [];
        if (cats.length === 0 || series.length === 0) { attachCard(spec.title, cv.canvas); return; }

        let yMin = Infinity, yMax = -Infinity;
        for (const s of series) {
            for (const v of s.values || []) {
                if (!Number.isFinite(v)) { continue; }
                if (v < yMin) { yMin = v; }
                if (v > yMax) { yMax = v; }
            }
        }
        if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 1; }
        if (yMin === yMax) { yMin = yMin - 1; yMax = yMax + 1; }
        if (yMin > 0) { yMin = 0; }

        const groupW = plot.w / cats.length;
        const barW = (groupW * 0.7) / series.length;

        series.forEach(function(s, sIdx) {
            ctx.fillStyle = colorAt(sIdx);
            const vals = s.values || [];
            for (let i = 0; i < cats.length && i < vals.length; i++) {
                const v = vals[i];
                if (!Number.isFinite(v)) { continue; }
                const x = plot.x + i * groupW + (groupW - groupW * 0.7) / 2 + sIdx * barW;
                const yPx = plot.y + plot.h - ((v - yMin) / (yMax - yMin)) * plot.h;
                const baseY = plot.y + plot.h - ((0 - yMin) / (yMax - yMin)) * plot.h;
                ctx.fillRect(x, Math.min(yPx, baseY), barW, Math.abs(baseY - yPx));
            }
        });

        ctx.fillStyle = cssVar('--muted', '#aaa');
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const stride = Math.max(1, Math.ceil(cats.length / 8));
        for (let i = 0; i < cats.length; i += stride) {
            ctx.fillText(String(cats[i]), plot.x + (i + 0.5) * groupW, plot.y + plot.h + 4);
        }
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 4; i++) {
            const v = yMax - (i / 4) * (yMax - yMin);
            ctx.fillText(v.toFixed(0), plot.x - 4, plot.y + (i / 4) * plot.h);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(spec.xLabel || '', plot.x + plot.w / 2, plot.y + plot.h + 18);
        ctx.save();
        ctx.translate(plot.x - 36, plot.y + plot.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(spec.yLabel || '', 0, 0);
        ctx.restore();

        attachCard(spec.title, cv.canvas);
    }

    function drawScalar(spec) {
        const table = document.createElement('table');
        table.className = 'scalar-table';
        const rows = spec.rows || [];
        const head = document.createElement('tr');
        const headerLabels = (window.__CHART_SCALAR_HEADERS__ && window.__CHART_SCALAR_HEADERS__.length === 3)
            ? window.__CHART_SCALAR_HEADERS__
            : ['Label', 'Value', 'Unit'];
        headerLabels.forEach(function(name) {
            const th = document.createElement('th');
            th.textContent = name;
            head.appendChild(th);
        });
        table.appendChild(head);
        rows.forEach(function(row) {
            const tr = document.createElement('tr');
            const label = document.createElement('td');
            label.textContent = row.label != null ? row.label : '';
            const value = document.createElement('td');
            const val = row.value;
            value.textContent = (typeof val === 'number') ? val.toPrecision(4) : String(val);
            const unit = document.createElement('td');
            unit.textContent = row.unit != null ? row.unit : '';
            tr.appendChild(label); tr.appendChild(value); tr.appendChild(unit);
            table.appendChild(tr);
        });
        attachCard(spec.title, table);
    }

    const COLORMAPS = {
        viridis: [
            [0.0, [68, 1, 84]], [0.25, [59, 82, 139]], [0.5, [33, 144, 141]],
            [0.75, [94, 201, 98]], [1.0, [253, 231, 37]],
        ],
        magma: [
            [0.0, [0, 0, 4]], [0.25, [80, 18, 123]], [0.5, [183, 55, 121]],
            [0.75, [251, 136, 97]], [1.0, [252, 253, 191]],
        ],
    };
    function sampleColormap(name, t) {
        const stops = COLORMAPS[name] || COLORMAPS.viridis;
        const last = stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i], b = stops[i + 1];
            if (t >= a[0] && t <= b[0]) {
                const u = (t - a[0]) / (b[0] - a[0]);
                const r = Math.round(a[1][0] + u * (b[1][0] - a[1][0]));
                const g = Math.round(a[1][1] + u * (b[1][1] - a[1][1]));
                const bb = Math.round(a[1][2] + u * (b[1][2] - a[1][2]));
                return 'rgb(' + r + ',' + g + ',' + bb + ')';
            }
        }
        return 'rgb(' + last[1][0] + ',' + last[1][1] + ',' + last[1][2] + ')';
    }

    specs.forEach(function(spec) {
        if (!spec || typeof spec !== 'object') { return; }
        if (spec.kind === 'line') { drawLine(spec); }
        else if (spec.kind === 'heatmap') { drawHeatmap(spec); }
        else if (spec.kind === 'bar') { drawBar(spec); }
        else if (spec.kind === 'scalar') { drawScalar(spec); }
    });
})();`;
}
