import type { BarChart, ChartSpec, HeatmapChart, LineChart, ScalarTable } from '../../shared/chartSpec';
import { magma, normalizedColor, rasterize, viridis, type Palette } from '../../shared/gui-core/index';
import { getStrings, rangePopoverStrings } from '../../shared/i18n/strings';
import type { ChartSpecGlobals } from '../panels/chartSpecDocument';
import { installRangePopover } from '../rangePopover';
import { positionPopover } from './settingsPopover';

type Axis = 'x' | 'y' | 'color';
type AxisRange = { min: number | null; max: number | null };
type RangeOverride = Partial<Record<Axis, AxisRange>>;
type Redraw = (override: RangeOverride | undefined) => void;
type Plot = { x: number; y: number; w: number; h: number };
type CanvasSetup = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number };

const PALETTES: Record<string, Palette> = { viridis, magma };
const SERIES_COLORS = ['#4ea1ff', '#ff7e6b', '#7fd97f', '#d6a3ff', '#ffd166', '#ef476f', '#06d6a0', '#118ab2'];

function colorAt(index: number): string {
    return SERIES_COLORS[index % SERIES_COLORS.length];
}

function paletteFor(name: string | undefined): Palette {
    return (name !== undefined && PALETTES[name]) || PALETTES.viridis;
}

function sampleColormap(name: string | undefined, t: number): string {
    const rgb = normalizedColor(t, paletteFor(name));
    return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
}

function isFiniteValue(value: unknown): value is number {
    return Number.isFinite(value);
}

// Pixel i of n covers [lo, hi) of the visible axis; map it to the source cells it overlaps.
function sourceIntervals(n: number, visibleMin: number, visibleMax: number, axisMin: number, axisMax: number, count: number): ([number, number] | null)[] {
    const intervals: ([number, number] | null)[] = [];
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

/**
 * Renders ChartSpec dicts once into `#charts`: line, heatmap and bar as labelled `<canvas>`, scalar as `<table>`.
 * Drawing is minimal Canvas2D (no zoom/cursor) because recipe output is one-shot; only the per-chart axis range
 * overrides set through the double-click popover are kept.
 */
export function startChartSpecRenderer(win: Window, doc: Document, globals: Partial<ChartSpecGlobals>): void {
    const rangeOverrides: Record<number, RangeOverride> = {};
    const chartRedraws: Redraw[] = [];

    const RANGE_STRINGS = globals.__CHART_RANGE_STRINGS__ || rangePopoverStrings(getStrings('en'));
    const rangePopover = installRangePopover(doc, {
        rootId: 'range-popup', badgeId: 'popup-axis-badge', idPrefix: 'range',
        strings: RANGE_STRINGS, position: positionPopover,
    });
    const AXIS_BADGES: Record<Axis, [string, string]> = {
        x: [RANGE_STRINGS.axisX, '#6b3fa0'],
        y: [RANGE_STRINGS.axisY, '#0e639c'],
        color: [RANGE_STRINGS.axisColor, '#5a8a30'],
    };

    function redrawChart(chartIdx: number): void {
        if (typeof chartRedraws[chartIdx] === 'function') { chartRedraws[chartIdx](rangeOverrides[chartIdx]); }
    }

    function openRangePopup(chartIdx: number, clientX: number, clientY: number, axis: Axis): void {
        const current = rangeOverrides[chartIdx] && rangeOverrides[chartIdx][axis];
        rangePopover.open({
            axisLabel: AXIS_BADGES[axis][0],
            badgeColor: AXIS_BADGES[axis][1],
            horizontal: axis === 'x',
            min: current && current.min != null ? String(current.min) : '',
            max: current && current.max != null ? String(current.max) : '',
            clientX,
            clientY,
            apply(min, max) {
                if (!rangeOverrides[chartIdx]) { rangeOverrides[chartIdx] = {}; }
                if (min === null && max === null) { delete rangeOverrides[chartIdx][axis]; }
                else { rangeOverrides[chartIdx][axis] = { min, max }; }
                redrawChart(chartIdx);
            },
            auto() {
                if (rangeOverrides[chartIdx]) { delete rangeOverrides[chartIdx][axis]; }
                redrawChart(chartIdx);
            },
        });
    }

    function resetAxes(chartIdx: number, axes: Axis[]): void {
        const override = rangeOverrides[chartIdx];
        if (override) {
            for (const axis of axes) { delete override[axis]; }
        }
        redrawChart(chartIdx);
    }

    const specs: unknown[] = Array.isArray(globals.__CHART_SPECS__) ? globals.__CHART_SPECS__ : [];
    const host = doc.getElementById('charts');
    if (!host) { return; }
    const chartsHost: HTMLElement = host;
    if (specs.length === 0) {
        chartsHost.textContent = globals.__CHART_NO_RESULTS_LABEL__ || 'No chart specs returned.';
        return;
    }

    function cssVar(name: string, fallback: string): string {
        const v = win.getComputedStyle(doc.body).getPropertyValue(name);
        const trimmed = v ? v.trim() : '';
        return trimmed || fallback;
    }

    function attachCard(title: string | undefined, body: HTMLElement): void {
        const card = doc.createElement('section');
        card.className = 'chart-card';
        const h = doc.createElement('h3');
        h.className = 'chart-title';
        h.textContent = title || '';
        card.appendChild(h);
        card.appendChild(body);
        chartsHost.appendChild(card);
    }

    function setupCanvas(width: number, height: number): CanvasSetup {
        const c = doc.createElement('canvas');
        const dpr = win.devicePixelRatio || 1;
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
        c.style.width = width + 'px';
        c.style.height = height + 'px';
        const ctx = c.getContext('2d')!;
        ctx.scale(dpr, dpr);
        return { canvas: c, ctx, width, height };
    }

    function drawFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
        ctx.strokeStyle = cssVar('--line', '#666');
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
    }

    function drawAxisLabels(
        ctx: CanvasRenderingContext2D,
        plot: Plot,
        spec: { xLabel?: string; yLabel?: string },
        xRange: { min: number; max: number },
        yRange: { min: number; max: number },
        opts: { xDecimals: number; yDecimals: number },
    ): void {
        ctx.fillStyle = cssVar('--muted', '#aaa');
        ctx.font = '10px monospace';
        const x0 = plot.x, y0 = plot.y, w = plot.w, h = plot.h;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 4; i++) {
            const v = yRange.max - (i / 4) * (yRange.max - yRange.min);
            const py = y0 + (i / 4) * h;
            ctx.fillText(v.toFixed(opts.yDecimals), x0 - 4, py);
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let i = 0; i <= 4; i++) {
            const v = xRange.min + (i / 4) * (xRange.max - xRange.min);
            const px = x0 + (i / 4) * w;
            ctx.fillText(v.toFixed(opts.xDecimals), px, y0 + h + 4);
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

    function drawLegend(ctx: CanvasRenderingContext2D, plot: Plot, series: { name?: string; unit?: string }[]): void {
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        let lx = plot.x + 8;
        const ly = plot.y + 8;
        series.forEach((s, idx) => {
            ctx.fillStyle = colorAt(idx);
            ctx.fillRect(lx, ly - 4, 10, 8);
            ctx.fillStyle = cssVar('--text', '#ddd');
            const label = (s && s.name) ? s.name : ('series ' + (idx + 1));
            const name = s && s.unit ? label + ' [' + s.unit + ']' : label;
            ctx.fillText(name, lx + 14, ly);
            lx += 14 + Math.max(40, ctx.measureText(name).width + 18);
        });
    }

    function toCanvasCoords(e: MouseEvent, canvas: HTMLCanvasElement, cv: CanvasSetup): { cx: number; cy: number } {
        const rect = canvas.getBoundingClientRect();
        const scaleX = cv.width / (rect.width || cv.width);
        const scaleY = cv.height / (rect.height || cv.height);
        return {
            cx: (e.clientX - rect.left) * scaleX,
            cy: (e.clientY - rect.top) * scaleY,
        };
    }

    function axisBounds(ov: AxisRange | undefined, dataMin: number, dataMax: number): { min: number; max: number } {
        const min = (ov && ov.min != null) ? ov.min : dataMin;
        let max = (ov && ov.max != null) ? ov.max : dataMax;
        if (max <= min) { max = min + 1; }
        return { min, max };
    }

    function drawLine(spec: LineChart, chartIdx: number): void {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot: Plot = { x: 50, y: 16, w: cv.width - 60, h: cv.height - 50 };
        const xs = spec.xs || [];
        const series = spec.series || [];

        function redraw(override: RangeOverride | undefined): void {
            ctx.clearRect(0, 0, cv.width, cv.height);

            let yMin = Infinity, yMax = -Infinity;
            for (const s of series) {
                for (const y of s.ys || []) {
                    if (!isFiniteValue(y)) { continue; }
                    if (y < yMin) { yMin = y; }
                    if (y > yMax) { yMax = y; }
                }
            }
            if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 1; }
            if (yMin === yMax) { yMax = yMin + 1; }

            const yAxis = axisBounds(override && override.y, yMin, yMax);
            const dataXMin = xs[0] != null ? xs[0] : 0;
            const dataXMax = xs[xs.length - 1] != null ? xs[xs.length - 1] : 1;
            const xAxis = axisBounds(override && override.x, dataXMin, dataXMax);

            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);

            const yToPx = (v: number): number => plot.y + plot.h - ((v - yAxis.min) / (yAxis.max - yAxis.min)) * plot.h;
            const xToPx = (v: number): number => plot.x + ((v - xAxis.min) / (xAxis.max - xAxis.min || 1)) * plot.w;

            ctx.save();
            ctx.beginPath();
            ctx.rect(plot.x, plot.y, plot.w, plot.h);
            ctx.clip();

            series.forEach((s, idx) => {
                ctx.strokeStyle = colorAt(idx);
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                const ys = s.ys || [];
                // null (NaN/inf in the source) breaks the line instead of dropping to 0.
                let penDown = false;
                for (let i = 0; i < xs.length && i < ys.length; i++) {
                    const y = ys[i];
                    if (!isFiniteValue(y)) { penDown = false; continue; }
                    const px = xToPx(xs[i]);
                    const py = yToPx(y);
                    if (penDown) { ctx.lineTo(px, py); } else { ctx.moveTo(px, py); penDown = true; }
                }
                ctx.stroke();
            });
            ctx.restore();

            // Y 軸クリックヒント（薄い帯）— テキストより前に描画
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(0, plot.y, plot.x, plot.h);

            drawAxisLabels(ctx, plot, spec, xAxis, yAxis,
                { yDecimals: (spec.yScale === 'db') ? 0 : 2, xDecimals: xAxis.max >= 100 ? 0 : 2 });

            drawLegend(ctx, plot, series);
        }

        if (xs.length === 0 || series.length === 0) {
            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);
            attachCard(spec.title, cv.canvas);
            return;
        }

        redraw(rangeOverrides[chartIdx]);
        chartRedraws[chartIdx] = redraw;

        cv.canvas.addEventListener('dblclick', (e) => {
            const { cx, cy } = toCanvasCoords(e, cv.canvas, cv);
            if (cx < plot.x) {
                openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy > plot.y + plot.h) {
                openRangePopup(chartIdx, e.clientX, e.clientY, 'x');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                resetAxes(chartIdx, ['x', 'y']);
            }
        });

        attachCard(spec.title, cv.canvas);
    }

    function drawHeatmap(spec: HeatmapChart, chartIdx: number): void {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot: Plot = { x: 50, y: 16, w: cv.width - (spec.unit ? 120 : 90), h: cv.height - 50 };
        const matrix = spec.matrix || [];
        const rows = matrix.length;
        const cols = rows > 0 ? matrix[0].length : 0;

        let dataVmin = (spec.vmin != null) ? spec.vmin : Infinity;
        let dataVmax = (spec.vmax != null) ? spec.vmax : -Infinity;
        if (spec.vmin == null || spec.vmax == null) {
            for (let r = 0; r < rows; r++) {
                const row = matrix[r];
                for (let c = 0; c < cols; c++) {
                    const v = row[c];
                    if (!isFiniteValue(v)) { continue; }
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
        const palette = paletteFor(spec.colormap);
        const columnMajor = new Float64Array(cols * rows);
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                const v = matrix[r][c];
                columnMajor[c * rows + r] = typeof v === 'number' ? v : NaN;
            }
        }

        function redraw(override: RangeOverride | undefined): void {
            ctx.clearRect(0, 0, cv.width, cv.height);
            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);

            const colorOv = override && override.color;
            const vMin = (colorOv && colorOv.min != null) ? colorOv.min : dataVmin;
            const vMax = (colorOv && colorOv.max != null) ? colorOv.max : dataVmax;
            const vRange = vMax - vMin || 1;

            const yAxis = axisBounds(override && override.y, yMinAxis, yMaxAxis);
            const xAxis = axisBounds(override && override.x, xMinAxis, xMaxAxis);

            // Shared raster kernel: each pixel takes the peak of the source cells it covers.
            const pxW = Math.max(1, Math.round(plot.w));
            const pxH = Math.max(1, Math.round(plot.h));
            const raster = rasterize({ layout: 'flat', values: columnMajor, bins: rows }, {
                columns: sourceIntervals(pxW, xAxis.min, xAxis.max, xMinAxis, xMaxAxis, cols),
                rows: sourceIntervals(pxH, yAxis.min, yAxis.max, yMinAxis, yMaxAxis, rows),
                peakMode: 'finite',
            }, { min: vMin, max: vMin + vRange }, palette);
            const off = doc.createElement('canvas');
            off.width = raster.width; off.height = raster.height;
            const offCtx = off.getContext('2d')!;
            const image = offCtx.createImageData(raster.width, raster.height);
            image.data.set(raster.pixels);
            offCtx.putImageData(image, 0, 0);
            ctx.drawImage(off, plot.x, plot.y, plot.w, plot.h);

            // Y 軸クリックヒント
            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(0, plot.y, plot.x, plot.h);

            drawAxisLabels(ctx, plot, spec, xAxis, yAxis, { xDecimals: 2, yDecimals: 0 });

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

        cv.canvas.addEventListener('dblclick', (e) => {
            const { cx, cy } = toCanvasCoords(e, cv.canvas, cv);
            if (cx < plot.x) {
                openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy > plot.y + plot.h) {
                openRangePopup(chartIdx, e.clientX, e.clientY, 'x');
            } else if (cx > plot.x + plot.w) {
                openRangePopup(chartIdx, e.clientX, e.clientY, 'color');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                resetAxes(chartIdx, ['color', 'x', 'y']);
            }
        });

        attachCard(spec.title, cv.canvas);
    }

    function drawBar(spec: BarChart, chartIdx: number): void {
        const cv = setupCanvas(720, 240);
        const ctx = cv.ctx;
        const plot: Plot = { x: 50, y: 16, w: cv.width - 60, h: cv.height - 50 };
        const cats = spec.categories || [];
        const series = spec.series || [];

        function redraw(override: RangeOverride | undefined): void {
            ctx.clearRect(0, 0, cv.width, cv.height);

            let yMin = Infinity, yMax = -Infinity;
            for (const s of series) {
                for (const v of s.values || []) {
                    if (!isFiniteValue(v)) { continue; }
                    if (v < yMin) { yMin = v; }
                    if (v > yMax) { yMax = v; }
                }
            }
            if (!isFinite(yMin) || !isFinite(yMax)) { yMin = 0; yMax = 1; }
            if (yMin === yMax) { yMin = yMin - 1; yMax = yMax + 1; }
            if (yMin > 0) { yMin = 0; }

            const yAxis = axisBounds(override && override.y, yMin, yMax);
            const _yMin = yAxis.min;
            const _yMax = yAxis.max;

            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);
            const groupW = plot.w / Math.max(cats.length, 1);
            const barW = (groupW * 0.7) / Math.max(series.length, 1);

            ctx.save();
            ctx.beginPath();
            ctx.rect(plot.x, plot.y, plot.w, plot.h);
            ctx.clip();
            series.forEach((s, sIdx) => {
                ctx.fillStyle = colorAt(sIdx);
                const vals = s.values || [];
                for (let i = 0; i < cats.length && i < vals.length; i++) {
                    const v = vals[i];
                    if (!isFiniteValue(v)) { continue; }
                    const x = plot.x + i * groupW + (groupW - groupW * 0.7) / 2 + sIdx * barW;
                    const yPx = plot.y + plot.h - ((v - _yMin) / (_yMax - _yMin)) * plot.h;
                    const baseY = plot.y + plot.h - ((0 - _yMin) / (_yMax - _yMin)) * plot.h;
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

            drawLegend(ctx, plot, series);
        }

        if (cats.length === 0 || series.length === 0) {
            drawFrame(ctx, plot.x, plot.y, plot.w, plot.h);
            attachCard(spec.title, cv.canvas);
            return;
        }

        redraw(rangeOverrides[chartIdx]);
        chartRedraws[chartIdx] = redraw;

        // bar は Y 軸のみ（X 軸はカテゴリ軸のため対象外）
        cv.canvas.addEventListener('dblclick', (e) => {
            const { cx, cy } = toCanvasCoords(e, cv.canvas, cv);
            if (cx < plot.x) {
                openRangePopup(chartIdx, e.clientX, e.clientY, 'y');
            } else if (cx >= plot.x && cx <= plot.x + plot.w && cy >= plot.y && cy <= plot.y + plot.h) {
                resetAxes(chartIdx, ['y']);
            }
        });

        attachCard(spec.title, cv.canvas);
    }

    function drawScalar(spec: ScalarTable): void {
        const table = doc.createElement('table');
        table.className = 'scalar-table';
        const rows = spec.rows || [];
        const head = doc.createElement('tr');
        const headers = globals.__CHART_SCALAR_HEADERS__;
        const headerLabels = (headers && headers.length === 3) ? headers : ['Label', 'Value', 'Unit'];
        headerLabels.forEach((name) => {
            const th = doc.createElement('th');
            th.textContent = name;
            head.appendChild(th);
        });
        table.appendChild(head);
        rows.forEach((row) => {
            const tr = doc.createElement('tr');
            const label = doc.createElement('td');
            label.textContent = row.label != null ? row.label : '';
            const value = doc.createElement('td');
            const val = row.value;
            value.textContent = (typeof val === 'number') ? val.toPrecision(4) : String(val);
            const unit = doc.createElement('td');
            unit.textContent = row.unit != null ? row.unit : '';
            tr.appendChild(label); tr.appendChild(value); tr.appendChild(unit);
            table.appendChild(tr);
        });
        attachCard(spec.title, table);
    }

    specs.forEach((candidate, idx) => {
        if (!candidate || typeof candidate !== 'object') { return; }
        const spec = candidate as ChartSpec;
        if (spec.kind === 'line') { drawLine(spec, idx); }
        else if (spec.kind === 'heatmap') { drawHeatmap(spec, idx); }
        else if (spec.kind === 'bar') { drawBar(spec, idx); }
        else if (spec.kind === 'scalar') { drawScalar(spec); }
    });
}
