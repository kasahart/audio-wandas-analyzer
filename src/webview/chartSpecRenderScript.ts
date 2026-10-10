import { magma, normalizedColor, rasterize, viridis } from '../shared/gui-core/index';
import { getStrings, rangePopoverStrings } from '../shared/i18n/strings';
import { installRangePopover } from './rangePopover';
import { positionPopover } from './runtime/settingsPopover';

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

    const rangeOverrides = {};   // chartIndex → { y?: {min,max}, x?: {min,max}, color?: {min,max} }
    const chartRedraws   = [];   // chartIndex → function(override)

    // ── レンジポップアップ（比較画面のスペクトルと共通の実装） ──
    const RANGE_STRINGS = window.__CHART_RANGE_STRINGS__ || ${JSON.stringify(rangePopoverStrings(getStrings('en')))};
    ${positionPopover.toString()}
    ${installRangePopover.toString()}
    const rangePopover = installRangePopover(document, {
        rootId: 'range-popup', badgeId: 'popup-axis-badge', idPrefix: 'range',
        strings: RANGE_STRINGS, position: positionPopover,
    });
    const AXIS_BADGES = {
        x: [RANGE_STRINGS.axisX, '#6b3fa0'],
        y: [RANGE_STRINGS.axisY, '#0e639c'],
        color: [RANGE_STRINGS.axisColor, '#5a8a30'],
    };

    function openRangePopup(chartIdx, clientX, clientY, axis) {
        axis = axis || 'y';
        const current = rangeOverrides[chartIdx] && rangeOverrides[chartIdx][axis];
        function redraw() {
            if (typeof chartRedraws[chartIdx] === 'function') { chartRedraws[chartIdx](rangeOverrides[chartIdx]); }
        }
        rangePopover.open({
            axisLabel: AXIS_BADGES[axis][0],
            badgeColor: AXIS_BADGES[axis][1],
            horizontal: axis === 'x',
            min: current && current.min != null ? String(current.min) : '',
            max: current && current.max != null ? String(current.max) : '',
            clientX: clientX,
            clientY: clientY,
            apply: function(min, max) {
                if (!rangeOverrides[chartIdx]) { rangeOverrides[chartIdx] = {}; }
                if (min === null && max === null) { delete rangeOverrides[chartIdx][axis]; }
                else { rangeOverrides[chartIdx][axis] = { min: min, max: max }; }
                redraw();
            },
            auto: function() {
                if (rangeOverrides[chartIdx]) { delete rangeOverrides[chartIdx][axis]; }
                redraw();
            },
        });
    }

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

    function toCanvasCoords(e, canvas, cv) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = cv.width / (rect.width || cv.width);
        var scaleY = cv.height / (rect.height || cv.height);
        return {
            cx: (e.clientX - rect.left) * scaleX,
            cy: (e.clientY - rect.top)  * scaleY,
        };
    }

    function drawLine(spec, chartIdx) {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot = { x: 50, y: 16, w: cv.width - 60, h: cv.height - 50 };
        const xs = spec.xs || [];
        const series = spec.series || [];

        function redraw(override) {
            // clear
            ctx.clearRect(0, 0, cv.width, cv.height);

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

            const yOv = override && override.y;
            const xOv = override && override.x;
            const _yMin = (yOv && yOv.min != null) ? yOv.min : yMin;
            let _yMax   = (yOv && yOv.max != null) ? yOv.max : yMax;
            if (_yMax <= _yMin) { _yMax = _yMin + 1; }
            const dataXMin = xs[0] != null ? xs[0] : 0;
            const dataXMax = xs[xs.length - 1] != null ? xs[xs.length - 1] : 1;
            const _xMin = (xOv && xOv.min != null) ? xOv.min : dataXMin;
            let _xMax   = (xOv && xOv.max != null) ? xOv.max : dataXMax;
            if (_xMax <= _xMin) { _xMax = _xMin + 1; }

            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);

            const yToPx = function(v) { return plot.y + plot.h - ((v - _yMin) / (_yMax - _yMin)) * plot.h; };
            const xToPx = function(v) { return plot.x + ((v - _xMin) / (_xMax - _xMin || 1)) * plot.w; };

            // clip to plot area
            ctx.save();
            ctx.beginPath();
            ctx.rect(plot.x, plot.y, plot.w, plot.h);
            ctx.clip();

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
            ctx.restore();

            // Y 軸クリックヒント（薄い帯）— テキストより前に描画
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(0, plot.y, plot.x, plot.h);

            drawAxisLabels(ctx, plot, spec,
                { min: _xMin, max: _xMax },
                { min: _yMin, max: _yMax },
                { yDecimals: (spec.yScale === 'db') ? 0 : 2, xDecimals: _xMax >= 100 ? 0 : 2 });

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
                const label = (s && s.name) ? s.name : ('series ' + (idx + 1));
                const name = s && s.unit ? label + ' [' + s.unit + ']' : label;
                ctx.fillText(name, lx + 14, ly);
                lx += 14 + Math.max(40, ctx.measureText(name).width + 18);
            });
        }

        if (xs.length === 0 || series.length === 0) {
            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);
            attachCard(spec.title, cv.canvas);
            return;
        }

        redraw(rangeOverrides[chartIdx]);
        chartRedraws[chartIdx] = redraw;

        // ゾーン別ダブルクリック
        cv.canvas.addEventListener('dblclick', function(e) {
            var coords = toCanvasCoords(e, cv.canvas, cv);
            var cx = coords.cx;
            var cy = coords.cy;
            if (cx < plot.x) {
                // Y 軸エリア → Y レンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy > plot.y + plot.h) {
                // X 軸エリア → X レンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'x');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                // プロット内部 → X・Y 両レンジをリセット
                if (rangeOverrides[chartIdx]) {
                    delete rangeOverrides[chartIdx].x;
                    delete rangeOverrides[chartIdx].y;
                }
                if (typeof chartRedraws[chartIdx] === 'function') {
                    chartRedraws[chartIdx](rangeOverrides[chartIdx]);
                }
            }
        });

        attachCard(spec.title, cv.canvas);
    }

    function drawHeatmap(spec, chartIdx) {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot = { x: 50, y: 16, w: cv.width - (spec.unit ? 120 : 90), h: cv.height - 50 };
        const matrix = spec.matrix || [];
        const rows = matrix.length;
        const cols = rows > 0 ? matrix[0].length : 0;

        // データから vmin/vmax を事前計算
        let dataVmin = (spec.vmin != null) ? spec.vmin : Infinity;
        let dataVmax = (spec.vmax != null) ? spec.vmax : -Infinity;
        if (spec.vmin == null || spec.vmax == null) {
            for (let r = 0; r < rows; r++) {
                const row = matrix[r];
                for (let c = 0; c < cols; c++) {
                    const v = row[c];
                    if (!Number.isFinite(v)) { continue; }
                    if (v < dataVmin) { dataVmin = v; }
                    if (v > dataVmax) { dataVmax = v; }
                }
            }
        }
        if (!isFinite(dataVmin) || !isFinite(dataVmax)) { dataVmin = 0; dataVmax = 1; }
        if (dataVmin === dataVmax) { dataVmax = dataVmin + 1; }

        const xs = spec.xs || [];
        const ys = spec.ys || [];
        const xMinAxis = xs.length > 0 ? xs[0] : 0;
        const xMaxAxis = xs.length > 0 ? xs[xs.length - 1] : cols;
        const yMinAxis = ys.length > 0 ? ys[0] : 0;
        const yMaxAxis = ys.length > 0 ? ys[ys.length - 1] : rows;
        const palette = PALETTES[spec.colormap] || PALETTES.viridis;
        const columnMajor = new Float64Array(cols * rows);
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const v = matrix[r][c];
                columnMajor[c * rows + r] = typeof v === 'number' ? v : NaN;
            }
        }

        function redraw(override) {
            ctx.clearRect(0, 0, cv.width, cv.height);
            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);

            const colorOv = override && override.color;
            const vMin = (colorOv && colorOv.min != null) ? colorOv.min : dataVmin;
            const vMax = (colorOv && colorOv.max != null) ? colorOv.max : dataVmax;
            const vRange = vMax - vMin || 1;

            const yOv = override && override.y;
            const _yMin = (yOv && yOv.min != null) ? yOv.min : yMinAxis;
            let _yMax   = (yOv && yOv.max != null) ? yOv.max : yMaxAxis;
            if (_yMax <= _yMin) { _yMax = _yMin + 1; }
            const xOv = override && override.x;
            const _xMin = (xOv && xOv.min != null) ? xOv.min : xMinAxis;
            let _xMax   = (xOv && xOv.max != null) ? xOv.max : xMaxAxis;
            if (_xMax <= _xMin) { _xMax = _xMin + 1; }

            // Shared raster kernel: each pixel takes the peak of the source cells it covers.
            const pxW = Math.max(1, Math.round(plot.w));
            const pxH = Math.max(1, Math.round(plot.h));
            const raster = rasterize({ layout: 'flat', values: columnMajor, bins: rows }, {
                columns: sourceIntervals(pxW, _xMin, _xMax, xMinAxis, xMaxAxis, cols),
                rows: sourceIntervals(pxH, _yMin, _yMax, yMinAxis, yMaxAxis, rows),
                peakMode: 'finite',
            }, { min: vMin, max: vMin + vRange }, palette);
            const off = document.createElement('canvas');
            off.width = raster.width; off.height = raster.height;
            const offCtx = off.getContext('2d');
            const image = offCtx.createImageData(raster.width, raster.height);
            image.data.set(raster.pixels);
            offCtx.putImageData(image, 0, 0);
            ctx.drawImage(off, plot.x, plot.y, plot.w, plot.h);

            // Y 軸クリックヒント
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(0, plot.y, plot.x, plot.h);

            drawAxisLabels(ctx, plot, spec,
                { min: _xMin, max: _xMax },
                { min: _yMin, max: _yMax },
                { xDecimals: 2, yDecimals: 0 });

            // カラーバー
            const cbX = plot.x + plot.w + 8;
            const cbW = 14;
            for (let i = 0; i < plot.h; i++) {
                const t = 1 - (i / plot.h);
                ctx.fillStyle = sampleColormap(spec.colormap, t);
                ctx.fillRect(cbX, plot.y + i, cbW, 1);
            }
            ctx.strokeStyle = cssVar('--line', '#666');
            ctx.strokeRect(cbX, plot.y, cbW, plot.h);

            // カラーバークリックヒント— テキストより前に描画
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(cbX, plot.y, cbW + 20, plot.h);

            ctx.fillStyle = cssVar('--muted', '#aaa');
            ctx.font = '10px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(vMax.toFixed(0), cbX + cbW + 2, plot.y);
            ctx.textBaseline = 'bottom';
            ctx.fillText(vMin.toFixed(0), cbX + cbW + 2, plot.y + plot.h);
            if (spec.unit) {
                ctx.save();
                ctx.translate(cv.width - 4, plot.y + plot.h / 2);
                ctx.rotate(-Math.PI / 2);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(spec.unit, 0, 0);
                ctx.restore();
            }
        }

        if (rows === 0 || cols === 0) {
            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);
            attachCard(spec.title, cv.canvas);
            return;
        }

        redraw(rangeOverrides[chartIdx]);
        chartRedraws[chartIdx] = redraw;

        // ゾーン別ダブルクリック
        cv.canvas.addEventListener('dblclick', function(e) {
            var coords = toCanvasCoords(e, cv.canvas, cv);
            var cx = coords.cx;
            var cy = coords.cy;
            if (cx < plot.x) {
                // Y 軸エリア → Y レンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy > plot.y + plot.h) {
                // X 軸エリア → X レンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'x');
            } else if (cx > plot.x + plot.w) {
                // カラーバーエリア → カラーレンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'color');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                // プロット内部 → X・Y・カラー全レンジをリセット
                if (rangeOverrides[chartIdx]) {
                    delete rangeOverrides[chartIdx].color;
                    delete rangeOverrides[chartIdx].x;
                    delete rangeOverrides[chartIdx].y;
                }
                if (typeof chartRedraws[chartIdx] === 'function') {
                    chartRedraws[chartIdx](rangeOverrides[chartIdx]);
                }
            }
        });

        attachCard(spec.title, cv.canvas);
    }

    function drawBar(spec, chartIdx) {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot = { x: 50, y: 16, w: cv.width - 60, h: cv.height - 50 };
        const cats = spec.categories || [];
        const series = spec.series || [];

        function redraw(override) {
            ctx.clearRect(0, 0, cv.width, cv.height);

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

            const yOv   = override && override.y;
            const _yMin = (yOv && yOv.min != null) ? yOv.min : yMin;
            let _yMax   = (yOv && yOv.max != null) ? yOv.max : yMax;
            if (_yMax <= _yMin) { _yMax = _yMin + 1; }

            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);
            const groupW = plot.w / Math.max(cats.length, 1);
            const barW = (groupW * 0.7) / Math.max(series.length, 1);

            ctx.save();
            ctx.beginPath();
            ctx.rect(plot.x, plot.y, plot.w, plot.h);
            ctx.clip();
            series.forEach(function(s, sIdx) {
                ctx.fillStyle = colorAt(sIdx);
                const vals = s.values || [];
                for (let i = 0; i < cats.length && i < vals.length; i++) {
                    const v = vals[i];
                    if (!Number.isFinite(v)) { continue; }
                    const x = plot.x + i * groupW + (groupW - groupW * 0.7) / 2 + sIdx * barW;
                    const yPx  = plot.y + plot.h - ((v       - _yMin) / (_yMax - _yMin)) * plot.h;
                    const baseY = plot.y + plot.h - ((0       - _yMin) / (_yMax - _yMin)) * plot.h;
                    ctx.fillRect(x, Math.min(yPx, baseY), barW, Math.abs(baseY - yPx));
                }
            });
            ctx.restore();

            // Y 軸クリックヒント— テキストより前に描画
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(0, plot.y, plot.x, plot.h);

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
                const v = _yMax - (i / 4) * (_yMax - _yMin);
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

            ctx.font = '10px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            let lx = plot.x + 8;
            const ly = plot.y + 8;
            series.forEach(function(s, idx) {
                ctx.fillStyle = colorAt(idx);
                ctx.fillRect(lx, ly - 4, 10, 8);
                ctx.fillStyle = cssVar('--text', '#ddd');
                const label = (s && s.name) ? s.name : ('series ' + (idx + 1));
                const name = s && s.unit ? label + ' [' + s.unit + ']' : label;
                ctx.fillText(name, lx + 14, ly);
                lx += 14 + Math.max(40, ctx.measureText(name).width + 18);
            });
        }

        if (cats.length === 0 || series.length === 0) {
            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);
            attachCard(spec.title, cv.canvas);
            return;
        }

        redraw(rangeOverrides[chartIdx]);
        chartRedraws[chartIdx] = redraw;

        // ゾーン別ダブルクリック（bar は Y 軸のみ、X 軸はカテゴリ軸のため対象外）
        cv.canvas.addEventListener('dblclick', function(e) {
            var coords = toCanvasCoords(e, cv.canvas, cv);
            var cx = coords.cx;
            var cy = coords.cy;
            if (cx < plot.x) {
                // Y 軸エリア → Y レンジ設定
                openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                // プロット内部 → Y レンジをリセット
                if (rangeOverrides[chartIdx]) {
                    delete rangeOverrides[chartIdx].y;
                }
                if (typeof chartRedraws[chartIdx] === 'function') {
                    chartRedraws[chartIdx](rangeOverrides[chartIdx]);
                }
            }
        });

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

    const PALETTES = ${JSON.stringify({ viridis, magma })};
    ${normalizedColor.toString()}
    ${rasterize.toString()}
    function sampleColormap(name, t) {
        const rgb = normalizedColor(t, PALETTES[name] || PALETTES.viridis);
        return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    }
    // Pixel i of n covers [lo, hi) of the visible axis; map it to the source cells it overlaps.
    function sourceIntervals(n, visibleMin, visibleMax, axisMin, axisMax, count) {
        const intervals = [];
        const axisRange = axisMax - axisMin || 1;
        for (let i = 0; i < n; i++) {
            const lo = visibleMin + (i / n) * (visibleMax - visibleMin);
            const hi = visibleMin + ((i + 1) / n) * (visibleMax - visibleMin);
            const first = ((lo - axisMin) / axisRange) * count;
            const last = ((hi - axisMin) / axisRange) * count;
            if (last <= 0 || first >= count) { intervals.push(null); continue; }
            const start = Math.max(0, Math.floor(first));
            intervals.push([start, Math.min(count, Math.max(start + 1, Math.ceil(last)))]);
        }
        return intervals;
    }

    specs.forEach(function(spec, idx) {
        if (!spec || typeof spec !== 'object') { return; }
        if (spec.kind === 'line') { drawLine(spec, idx); }
        else if (spec.kind === 'heatmap') { drawHeatmap(spec, idx); }
        else if (spec.kind === 'bar') { drawBar(spec, idx); }
        else if (spec.kind === 'scalar') { drawScalar(spec); }
    });
})();`;
}
