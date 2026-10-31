import { escapeHtml, serializeForScript } from '../../shared/utils/webviewEscaping';
import { getStrings, pickLocale } from '../../shared/i18n/strings';
import type { ComparisonState } from '../runtime/types';
import { createNonce } from './nonce';
import { DIFF_COLOR, FLAG_COLOR, LIGHT_DIFF_COLOR, LIGHT_ROLE_COLORS, ROLE_COLORS } from '../../shared/gui/roleColors';
import { SPECTROGRAM_COLORBAR_WIDTH } from '../draw/canvasDrawers';

export interface ComparisonAssets {
    waveformScriptUri: string;
    runtimeScriptUri: string;
    hostScriptUri?: string;
    cspSource: string;
    language: string;
    appVersion: string;
}

export function renderComparisonDocument(state: ComparisonState, assets: ComparisonAssets): string {
    const nonce = createNonce();
    const locale = pickLocale(assets.language);
    const strings = getStrings(assets.language);
    return `<!DOCTYPE html>
<html lang="${locale}">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${assets.cspSource}; media-src ${assets.cspSource} blob:; worker-src 'self'; connect-src 'self';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(strings.panelTitle)}</title>
    <style>${renderComparisonStyles()}</style>
</head>
<body>
    <div id="a11y-announce" role="status" aria-live="polite" aria-atomic="true" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0"></div>
    <div id="app"></div>
    <footer id="app-footer">
        <div id="hint-footer" aria-hidden="true"></div>
        <span id="task-status" aria-hidden="true" hidden></span>
        <span id="app-version">v${escapeHtml(assets.appVersion)}</span>
    </footer>
    <script nonce="${nonce}">
        const __AWA_NATIVE_ACQUIRE_VSCODE_API__ = window.acquireVsCodeApi;
        if (__AWA_NATIVE_ACQUIRE_VSCODE_API__) window.acquireVsCodeApi = function() {
            if (!window.__AWA_VSCODE_API__) {
                window.__AWA_VSCODE_API__ = __AWA_NATIVE_ACQUIRE_VSCODE_API__();
            }
            return window.__AWA_VSCODE_API__;
        };
        window.__APP_STATE__ = ${serializeForScript(state)};
        window.__APP_STRINGS__ = ${serializeForScript(strings)};
        window.__APP_LOCALE__ = ${serializeForScript(locale)};
    </script>
    <script src="${assets.waveformScriptUri}"></script>
    ${assets.hostScriptUri ? `<script src="${assets.hostScriptUri}"></script>` : ''}
    <script src="${assets.runtimeScriptUri}"></script>
</body>
</html>`;
}

export function renderComparisonStyles(): string {
    return `
        :root {
            color-scheme: light dark;
            /* Role colours (roleColors.ts): blue base and primary, yellow compare, green Δ, orange failure. */
            --entry-base: ${ROLE_COLORS[0]}; --entry-compare: ${ROLE_COLORS[1]}; --entry-slot-2: ${ROLE_COLORS[2]}; --entry-slot-3: ${ROLE_COLORS[3]}; --entry-delta: ${DIFF_COLOR}; --entry-flag: ${FLAG_COLOR};
            --font-ui: var(--vscode-font-family, "Aptos", "Segoe UI", sans-serif);
            --font-mono: var(--vscode-editor-font-family, "Cascadia Mono", "SFMono-Regular", Consolas, monospace);
            --surface: #16181c;
            --panel: #1d2025;
            --line: #343942;
            --text: #d9dde3;
            --muted: #8f98a3;
            --accent: #0f7b6c;
            --track-bg: #090b0f;
            --track-header-bg: #14171c;
        }
        body.vscode-dark, body[data-theme-kind="dark"] {
            --surface: #1e1e1e;
            --panel: #252526;
            --line: #3c3c3c;
            --text: #cccccc;
            --muted: #888888;
            --track-bg: #0b0d10;
            --track-header-bg: #171a1f;
        }
        body.vscode-light, body[data-theme-kind="light"] {
            --surface: #ffffff;
            --panel: #f3f3f3;
            --line: #d4d4d4;
            --text: #1e1e1e;
            --muted: #6e7681;
            --track-bg: #f5f5f5;
            --track-header-bg: #ebebeb;
            --entry-base: ${LIGHT_ROLE_COLORS[0]}; --entry-compare: ${LIGHT_ROLE_COLORS[1]}; --entry-slot-2: ${LIGHT_ROLE_COLORS[2]}; --entry-slot-3: ${LIGHT_ROLE_COLORS[3]}; --entry-delta: ${LIGHT_DIFF_COLOR};
        }
        body.vscode-high-contrast,
        body.vscode-high-contrast-light {
            --surface:         var(--vscode-editor-background);
            --panel:           var(--vscode-sideBar-background, var(--vscode-editor-background));
            --line:            var(--vscode-contrastBorder);
            --text:            var(--vscode-editor-foreground);
            --muted:           var(--vscode-descriptionForeground);
            --accent:          var(--vscode-focusBorder);
            --track-bg:        var(--vscode-editor-background);
            --track-header-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
        }
        @media (forced-colors: active) {
            :root,
            body,
            body.vscode-dark, body.vscode-light,
            body.vscode-high-contrast, body.vscode-high-contrast-light,
            body[data-theme-kind] {
                --line:            ButtonBorder;
                --text:            ButtonText;
                --muted:           GrayText;
                --surface:         Canvas;
                --panel:           Canvas;
                --track-bg:        Canvas;
                --track-header-bg: Canvas;
                --accent:          Highlight;
            }
        }
        body.vscode-high-contrast .tb-btn,
        body.vscode-high-contrast .track-btn,
        body.vscode-high-contrast-light .tb-btn,
        body.vscode-high-contrast-light .track-btn {
            border-color: var(--vscode-contrastBorder) !important;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: var(--surface); color: var(--text); font-family: var(--font-ui); overflow: hidden; height: 100vh; display: flex; flex-direction: column; }

        /* ── Toolbar ── */
        #toolbar {
            display: flex; align-items: center; gap: 6px; padding: 4px 10px;
            background: var(--panel); border-bottom: 1px solid var(--line);
            flex-shrink: 0; flex-wrap: wrap; overflow: visible; position: relative; z-index: 25;
        }
        .tb-label { font-size: 11px; color: var(--muted); white-space: nowrap; }
        /* A mode chosen inside ⋯ (box zoom, follow) stays in sight once the menu closes. */
        #tb-more-menu:has([aria-pressed="true"], .is-active) > summary { background: var(--accent); color: #fff; border-color: var(--accent); }
        .tb-btn {
            font-size: 11px; padding: 2px 8px; border-radius: 3px;
            border: 1px solid var(--line); background: var(--surface);
            color: var(--text); cursor: pointer; white-space: nowrap;
        }
        .tb-btn.is-warning {
            background: var(--vscode-statusBarItem-warningBackground, #b89500);
            color: var(--vscode-statusBarItem-warningForeground, #111111);
            border-color: transparent;
        }
        .tb-btn.is-active { background: var(--accent); color: #fff; border-color: var(--accent); }
        .tb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tb-sep { width: 1px; height: 16px; background: var(--line); margin: 0 2px; }
        .tb-menu { position: relative; display: inline-flex; }
        .tb-menu > summary { list-style: none; }
        .tb-menu > summary::-webkit-details-marker { display: none; }
        .tb-menu[open] > summary { background: var(--accent); color: #fff; border-color: var(--accent); }
        .tb-menu-popover {
            position: absolute; top: calc(100% + 4px); left: 0; z-index: 30;
            min-width: 190px; max-width: min(320px, 90vw); padding: 6px;
            display: flex; flex-direction: column; gap: 6px;
            background: var(--panel); border: 1px solid var(--line); border-radius: 4px;
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.24);
        }
        .tb-menu-popover .tb-btn { width: 100%; text-align: left; }
        .tb-menu-row { display: flex; align-items: center; gap: 6px; }
        .tb-menu-row .tb-label:first-child { width: 58px; }
        .tb-menu-row .tb-btn { width: auto; }
        .tb-menu-row select {
            flex: 1; min-width: 0; font-size: 11px; padding: 2px 4px; border-radius: 3px;
            border: 1px solid var(--line); background: var(--surface); color: var(--text);
        }
        #cursor-display { font-size: 11px; font-family: var(--font-mono); color: var(--muted); min-width: 80px; }
        #playback-display { font-size: 11px; font-family: var(--font-mono); color: #64a0ff; min-width: 70px; display: none; }
        #loop-time-display { font-size: 0.85em; font-family: var(--font-mono); color: #64a0ff; margin-left: 6px; cursor: pointer; }

        #app { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
        .entry-screen {
            position: relative; flex: 1 1 auto; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: var(--surface);
            color: var(--text); font-family: var(--font-ui); font-size: 13px; }
        /* Maximized, the same table covers the window; in the side panel it fills the panel. */
        .entry-screen.is-max { position: fixed; inset: 0 0 22px 0; z-index: 50; }
        .entry-screen[hidden] { display: none; }
        #entry-dock { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
        /* The side plots need the whole window; in the side panel the table is the name, channel, group and value. */
        .entry-screen:not([data-cols="6"]) .entry-side { display: none; }
        .entry-screen:is([data-cols="1"], [data-cols="2"]) .entry-col-group, .entry-screen:is([data-cols="1"], [data-cols="2"]) col.entry-col-group-w { display: none; }
        /* In the side panel the bar keeps the filter, the progress, Open and ⤢; the chain is one chip that widens the table. */
        .entry-screen:not(.is-max) .entry-bar { flex-wrap: wrap; row-gap: 4px; }
        .entry-screen:not(.is-max):is([data-cols="1"], [data-cols="2"], [data-cols="3"]) .entry-keys { display: none; }
        /* Beside the tracks the slotted rows already are tracks: the table's Enter needs no button there. */
        .entry-screen:not(.is-max) [data-action="entry-open"] { display: none; }
        .entry-screen:not(.is-max) [data-step-bar] { display: none; }
        .entry-screen:not(.is-max) .entry-footer { flex-wrap: wrap; row-gap: 4px; }
        .entry-screen .entry-size { padding: 2px 6px; }
        /* The table's own 書き出し while it covers the window; beside the tracks the toolbar's menu has the same. */
        .entry-screen:not(.is-max) .entry-export { display: none; }
        .entry-export { position: relative; }
        .entry-export > summary { list-style: none; cursor: pointer; border: 1px solid var(--line); border-radius: 4px; padding: 2px 8px; }
        .entry-export > summary::-webkit-details-marker { display: none; }
        .entry-export-pop { position: absolute; right: 0; top: calc(100% + 2px); z-index: 30; display: flex; flex-direction: column; gap: 2px; padding: 4px; min-width: 220px; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; }
        .entry-export-pop button { text-align: left; white-space: nowrap; }
        /* In the side panel the bar leaves the panel's own collapse button its corner. */
        .entry-screen:not(.is-max) .entry-bar { padding-right: 40px; }
        /* A row's own track controls: ＋ shows the file as a track, 👁 and × once it is one. */
        .entry-screen .entry-row-play { font-size: 13px; }
        /* ▶ appears only on the row under the mouse (or in hand), and then plainly, in the text colour. */
        .entry-row:not(.is-focused):not(:hover) .entry-row-play:not(.is-playing) { visibility: hidden; }
        /* A file shown as a track: ● in the first column and a bold name; a row and its lane light up together under the mouse. */
        .entry-row.is-shown .entry-name { font-weight: 600; }
        .entry-table col.entry-col-mark-w { width: 1.8em; }
        .entry-table td.entry-mark, .entry-table th.entry-mark { padding: 0; text-align: center; color: var(--muted); cursor: pointer; }
        .entry-row.is-shown td.entry-mark, .entry-table td.entry-mark:hover { color: var(--text); }
        .entry-row.is-linked td, .track-row.is-linked { background: color-mix(in srgb, var(--text) 8%, transparent); }
        /* The name gives way (ellipsis) so the numbers and the row's buttons always fit the panel. */
        .entry-table td.entry-name { overflow: hidden; text-overflow: ellipsis; }
        .entry-bar, .entry-footer { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
        .entry-bar { border-bottom: 1px solid var(--line); background: var(--panel); }
        .entry-footer { border-top: 1px solid var(--line); background: var(--panel); }
        .entry-spacer { flex: 1; }
        .entry-screen button, .entry-screen select, .track-stage-bar button { font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 2px 8px; cursor: pointer; }
        .entry-screen .entry-primary { border-color: var(--text); }
        .entry-screen kbd { font-family: var(--font-mono); font-size: 11px; opacity: 0.8; }
        .entry-filter[aria-pressed="true"] { border-color: var(--entry-flag); }
        .entry-key { color: var(--muted); font-variant-numeric: tabular-nums; }
        .entry-body { flex: 1; display: flex; min-height: 0; }
        .entry-table-wrap { flex: 1; overflow: auto; min-width: 0; }
        /* In a narrow window the distribution goes below the table, so the table keeps its value column in sight. */
        @media (max-width: 960px) {
            .entry-screen.is-max .entry-body { flex-direction: column; }
            .entry-screen.is-max .entry-table-wrap { flex: 1 1 0; min-height: 120px; }
            .entry-screen.is-max .entry-side { width: auto; height: 300px; border-left: 0; border-top: 1px solid var(--line); flex-direction: row; }
            .entry-screen.is-max .entry-side > * { flex: 1 1 0; min-width: 0; }
            .entry-screen.is-max .entry-side .entry-overview { height: auto; align-self: stretch; }
        }
        .entry-side { width: 420px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 8px; border-left: 1px solid var(--line); background: var(--panel); }
        /* The distribution: neutral bars (lighter where a picked range takes them), the slots as ticks in their role colours. */
        .entry-dist-area { position: relative; flex: 1; display: flex; flex-direction: column; min-height: 160px; }
        .entry-dist { display: flex; flex-direction: column; min-height: 0; flex: 1; --dist-bar: #5b6470; --dist-bar-in: #aab3be; }
        .entry-dist-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 28px; color: var(--muted); font-size: 12px; }
        .entry-dist-n { font-variant-numeric: tabular-nums; }
        .entry-dist-legend { display: inline-flex; flex-wrap: wrap; gap: 10px; color: var(--text); }
        .entry-dist-key { display: inline-flex; align-items: center; gap: 4px; }
        .entry-dist-swatch { display: inline-block; width: 0; height: 12px; border-left: 2px solid var(--entry-compare); }
        .entry-dist-swatch.slot-0 { border-left-color: var(--entry-base); }
        .entry-dist-swatch.slot-2 { border-left-color: var(--entry-slot-2); }
        .entry-dist-swatch.slot-3 { border-left-color: var(--entry-slot-3); }
        .entry-dist-swatch.is-dashed { border-left-style: dashed; }
        .entry-dist-note { min-height: 16px; color: var(--muted); font-size: 11px; }
        .entry-dist-groups { overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; flex: 0 1 auto; }
        .entry-dist-axis { overflow: hidden; scrollbar-gutter: stable; }
        .entry-dist svg { display: block; }
        .entry-dist-plot { cursor: crosshair; user-select: none; touch-action: none; }
        .entry-dist-plot rect[data-bin], .entry-dist-plot circle { fill: var(--dist-bar); }
        .entry-dist-plot rect[data-bin].is-in, .entry-dist-plot circle.is-in { fill: var(--dist-bar-in); }
        .entry-dist-plot circle { cursor: pointer; }
        .entry-dist-rug { stroke: var(--dist-bar-in); stroke-opacity: 0.55; stroke-width: 1; fill: none; }
        .entry-dist-floor, .entry-dist-axis-line { stroke: var(--line); }
        .entry-dist-axis-line { stroke: var(--muted); }
        .entry-dist-name { fill: var(--text); font-size: 12px; }
        .entry-dist-count { fill: var(--muted); font-size: 11px; font-family: var(--font-mono); }
        .entry-dist-max { fill: var(--muted); opacity: 0.75; font-size: 10px; font-family: var(--font-mono); }
        .entry-dist-tick { fill: var(--muted); font-size: 10px; font-family: var(--font-mono); }
        .entry-dist-quantity { fill: var(--text); font-size: 11px; }
        .entry-dist-brush { fill: currentColor; fill-opacity: 0.12; stroke: var(--text); stroke-dasharray: 3 2; }
        .entry-dist-empty { display: grid; place-items: center; min-height: 120px; color: var(--muted); text-align: center; padding: 8px; }
        .entry-dist-empty[hidden] { display: none; }
        /* While a comparison is open the distribution folds into a low strip above the table, with a way back. */
        .entry-screen.is-dist-strip .entry-dist { flex: none; padding: 4px 10px 2px; border-bottom: 1px solid var(--line); background: var(--panel); }
        .entry-screen.is-dist-strip .entry-dist-note:empty { display: none; }
        .entry-screen.is-dist-strip .entry-dist-empty { min-height: 0; padding: 2px; }
        /* A held slot's Δ spectrum takes the distribution's frame while it is held, so nothing else moves. */
        .entry-held { position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--entry-delta); border-radius: 4px; padding: 2px 6px; }
        .entry-held[hidden] { display: none; }
        .entry-held canvas { flex: 1; width: 100%; min-height: 0; }
        .entry-overview { height: 114px; width: 100%; }
        .entry-row.is-derived .entry-name { color: var(--muted); padding-left: 16px; }
        .entry-table { border-collapse: collapse; width: 100%; outline: 1px solid transparent; outline-offset: -1px; }
        .entry-table th { position: sticky; top: 0; background: var(--panel); text-align: left; font-weight: 600; padding: 4px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
        .entry-table td { padding: 3px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
        .entry-table .entry-num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
        .entry-row { cursor: pointer; }
        /* Focus is not a role, so it is drawn without a role's colour. */
        .entry-row.is-focused { background: color-mix(in srgb, var(--text) 10%, transparent); outline: 1px solid color-mix(in srgb, var(--text) 55%, transparent); outline-offset: -1px; }
        .entry-badge { display: inline-block; min-width: 16px; border: 1px solid var(--muted); border-radius: 3px; font-size: 11px; text-align: center; }
        .entry-badge.entry-slot-0 { border-color: var(--entry-base); color: var(--entry-base); }
        .entry-badge.entry-slot-1 { border-color: var(--entry-compare); color: var(--entry-compare); }
        .entry-badge.entry-slot-2 { border-color: var(--entry-slot-2); color: var(--entry-slot-2); }
        .entry-badge.entry-slot-3 { border-color: var(--entry-slot-3); color: var(--entry-slot-3); }
        /* The dataset table: four fixed columns (nothing scrolls sideways); a row's tools right after its name. */
        .entry-table { table-layout: fixed; }
        /* Widened, the name takes the width the other columns leave (the filler at the right end then takes none). */
        .entry-screen.is-max .entry-table col.entry-col-name-w { width: auto; }
        .entry-screen.is-max .entry-table col.entry-col-fill-w { width: 0; }
        .entry-screen.is-max .entry-row > td:last-child:empty { padding: 0; }
        .entry-table col.entry-col-ch-w { width: 3.8em; }
        .entry-table col.entry-col-group-w { width: 8em; }
        .entry-table col.entry-col-value-w { width: 9.5em; }
        .entry-table col.entry-col-reason-w { width: 7em; }
        /* In the side panel the name takes what the channel, group and value leave. */
        .entry-screen:not(.is-max) .entry-table col.entry-col-name-w { width: 50%; }
        .entry-screen:not(.is-max) .entry-table col.entry-col-value-w { width: 8em; }
        .entry-screen:not(.is-max) .entry-table col.entry-col-group-w { width: 6em; }
        .entry-table tr { height: 24px; }
        .entry-table td { padding: 0 8px; overflow: hidden; text-overflow: ellipsis; }
        .entry-table th { padding: 2px 8px; }
        .entry-th { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; }
        th.entry-num .entry-th { justify-content: flex-end; width: 100%; }
        .entry-th-label { overflow: hidden; text-overflow: ellipsis; }
        /* The value's name and unit wrap between words rather than being cut: "A特性" stays whole; only a word wider than the column breaks, at its edge. */
        .entry-table th.entry-num { white-space: normal; }
        th.entry-num .entry-th-label { min-width: 0; overflow: visible; word-break: keep-all; overflow-wrap: break-word; }
        .entry-th-count { color: var(--muted); font-weight: normal; }
        .entry-screen .entry-fbtn { border: 0; padding: 0 3px; color: var(--muted); }
        .entry-screen .entry-fbtn:hover:not(:disabled) { color: var(--text); background: var(--line); }
        .entry-screen .entry-fbtn.is-on { color: var(--panel); background: var(--text); }
        .entry-screen .entry-fbtn:disabled { opacity: 0.4; cursor: default; }
        .entry-ncell { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .entry-nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        /* The name gives way in its middle: the head takes the ellipsis, the end (…run009.wav) stays in sight. */
        .entry-nm.is-split { display: inline-flex; }
        .entry-nm-head { overflow: hidden; text-overflow: ellipsis; min-width: 1.5em; }
        .entry-nm-tail { flex: none; }
        .entry-nm-full { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
        .entry-rowtools { display: inline-flex; gap: 1px; flex: none; }
        .entry-screen .entry-rbtn { min-width: 20px; height: 20px; padding: 0 3px; border-color: transparent; font-family: var(--font-mono); font-size: 11px; line-height: 1; }
        .entry-screen .entry-rbtn:hover { border-color: var(--line); }
        .entry-row:not(:hover):not(.is-focused) .entry-rbtn.is-hover { visibility: hidden; }
        /* In the side panel a row's hidden tools take no room, so its name has it. */
        .entry-screen:not(.is-max) .entry-row:not(:hover):not(.is-focused) .entry-rbtn.is-hover { display: none; }
        .entry-screen .entry-rbtn-slot { color: var(--muted); }
        .entry-col-ch.is-single { color: var(--muted); }
        .entry-row.is-stale td:not(.entry-name) { color: var(--muted); }
        .entry-row.is-excluded .entry-nm { color: var(--muted); }
        .entry-why { color: var(--entry-flag); }
        .entry-why-detail { color: var(--muted); }
        .entry-spacer-row, .entry-spacer-row td { border: 0; padding: 0; }
        .entry-pick { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
        .entry-pick select { color: var(--text); max-width: 14em; }
        .entry-compute { display: inline-flex; align-items: center; gap: 6px; }
        .entry-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 10px 4px; background: var(--panel); }
        .entry-chips:empty { display: none; }
        .entry-fchip { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--text); border-radius: 12px; padding: 0 2px 0 8px; font-family: var(--font-mono); }
        .entry-screen .entry-fchip button { border: 0; padding: 0 4px; max-width: 26em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .entry-screen .entry-fadd { border-style: dashed; color: var(--muted); }
        .entry-screen .entry-ftracks { border-style: dashed; color: var(--muted); }
        .entry-screen .entry-ftracks.is-on { border-style: solid; border-color: var(--text); color: var(--text); }
        .entry-table .entry-mark-all { font: inherit; color: inherit; background: none; border: 0; padding: 0; width: 100%; cursor: pointer; }
        .entry-table th.entry-mark.is-some, .entry-table th.entry-mark.is-all, .entry-table .entry-mark-all:hover { color: var(--text); }
        .entry-screen .entry-tracks-confirm { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .entry-screen .entry-tracks-confirm .is-primary { border-color: var(--text); font-weight: 600; }
        .entry-pop { position: absolute; z-index: 30; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); padding: 8px; }
        .entry-fpop, .entry-slotmenu, .entry-memo { display: grid; gap: 4px; width: 280px; }
        .entry-slotmenu { width: 190px; }
        .entry-screen .entry-mi { display: flex; align-items: center; gap: 8px; border: 0; text-align: left; padding: 3px 6px; }
        .entry-screen .entry-mi:hover:not(:disabled) { background: var(--surface); }
        .entry-screen .entry-mi:disabled { color: var(--muted); cursor: default; }
        .entry-mi-ic { width: 18px; font-family: var(--font-mono); font-size: 11px; color: var(--muted); }
        .entry-mi kbd { margin-left: auto; }
        .entry-pop hr { border: 0; border-top: 1px solid var(--line); margin: 2px 0; width: 100%; }
        .entry-pop input[type=search], .entry-pop input[type=number], .entry-pop textarea { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px; }
        .entry-pop textarea { min-height: 64px; resize: vertical; }
        .entry-frange { display: flex; align-items: center; gap: 6px; }
        .entry-frange input { width: 7em; }
        .entry-fpop-label { color: var(--muted); }
        .entry-flist { height: 170px; overflow-y: auto; border: 1px solid var(--line); border-radius: 4px; padding: 4px; }
        .entry-ck { display: flex; align-items: center; gap: 6px; height: 22px; white-space: nowrap; cursor: pointer; }
        .entry-ck-v { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .entry-ck-n { margin-left: auto; color: var(--muted); font-family: var(--font-mono); font-size: 11px; }
        .entry-ck-more { color: var(--muted); font-size: 11px; padding: 4px 2px; }
        .entry-fpop-bar { display: flex; justify-content: flex-end; gap: 6px; margin-top: 4px; }
        .entry-slot-wrap { display: inline-flex; align-items: center; gap: 2px; }
        .entry-screen .entry-slot-x { border: 0; padding: 0 4px; color: var(--muted); }
        /* Step bar: the scan Recipe's chips; red = a step left out for invalid settings. */
        .step-bar { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 10px; border-bottom: 1px solid var(--line); background: var(--panel); font-size: 12px; }
        .step-field.is-invalid input, .step-field.is-invalid select { border-color: var(--entry-flag) !important; color: var(--entry-flag); }
        /* A condition column that groups the rows reads as checked. */
        .step-form { position: absolute; top: 100%; left: 10px; z-index: 3; display: grid; gap: 6px; padding: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.35); }
        .step-field.is-invalid { color: var(--entry-flag); }
        .step-form [data-action="step-apply"]:disabled { opacity: 0.4; cursor: not-allowed; }
        .step-field input, .step-field select { width: 90px; font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: 3px; }
        /* A refused key or a new card lights up once. */
        @keyframes awa-flash { 0%, 60% { box-shadow: 0 0 0 2px var(--entry-flag); } 100% { box-shadow: none; } }
        .is-flash { animation: awa-flash 0.9s ease-out; }
        .entry-keys { display: inline-flex; gap: 8px; }
        .entry-keys .entry-key { font: inherit; color: var(--muted); background: transparent; border: 1px solid var(--line); border-radius: 3px; padding: 0 6px; cursor: pointer; user-select: none; }
        .entry-keys .entry-key:hover { color: var(--text); }
        .screen-help { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); font-family: var(--font-ui); font-size: 12px; color: var(--text); }
        .screen-help[hidden] { display: none; }
        .screen-help-box { max-width: min(900px, 94vw); max-height: 88vh; overflow: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px 20px; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
        .screen-help-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 10px; }
        .screen-help-tables { display: flex; flex-wrap: wrap; gap: 24px; }
        .screen-help table { border-collapse: collapse; }
        .screen-help th { text-align: left; padding: 2px 12px 2px 0; font-family: var(--font-mono); font-weight: normal; white-space: nowrap; color: var(--accent); }
        .screen-help td { padding: 2px 0; }
        .screen-help section { flex: 1 1 300px; }
        .screen-help h3 { margin: 0 0 4px; font-size: 12px; color: var(--muted); }
        .screen-help section[aria-current] h3 { color: var(--text); }
        .entry-footer [data-action="compare-report"]:disabled { opacity: 0.4; cursor: not-allowed; }
        /* The headline over the panes: both levels where they differ most among what is loud enough to hear. */
        .compare-legend { flex-wrap: wrap; row-gap: 2px; }
        .compare-legend-item { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
        .compare-legend-item.is-active { color: var(--text); }
        .compare-legend-item.is-held { outline: 1px solid var(--entry-compare); border-radius: 3px; padding: 0 4px; }
        .compare-pane-head { display: flex; align-items: center; gap: 8px; padding: 2px 8px; font-variant-numeric: tabular-nums; }
        .compare-value { font-family: var(--font-mono); }
        .compare-memo { color: var(--text); cursor: help; }
        .entry-batch { display: grid; gap: 6px; max-width: 320px; }
        .track-stage-gate { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); margin-left: 8px; }
        .track-stage-gate[hidden] { display: none; }
        .entry-batch-opt { display: flex; align-items: center; gap: 6px; }
        .entry-row.is-derived td { color: var(--muted); }
        .compare-play { padding: 0 6px !important; background: transparent; color: var(--text); border: 1px solid var(--line); border-radius: 4px; font-size: 10px; line-height: 16px; cursor: pointer; }
        .compare-play:hover { border-color: var(--accent); color: var(--accent); }
        .compare-readout { position: absolute; bottom: 30px; right: 14px; padding: 2px 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; font-family: var(--font-mono); pointer-events: none; }
        .compare-readout[hidden] { display: none; }
        .compare-zoom-box { position: absolute; border: 1px dashed var(--text); pointer-events: none; }
        .compare-zoom-box[hidden] { display: none; }
        .entry-side { position: relative; }
        .track-stage-bar[hidden], .track-stage[hidden], .track-stage-panel[hidden], .track-stage-diff[hidden] { display: none; }
        .track-stage-cursor { position: fixed; width: 0; border-left: 1px solid var(--muted); pointer-events: none; z-index: 20; }
        .track-stage-cursor[hidden], .track-stage-readout[hidden], .track-stage-box[hidden] { display: none; }
        .track-stage-readout { position: fixed; z-index: 21; bottom: auto; right: auto; }
        .track-stage-box { position: fixed; z-index: 21; }
        .track-stage { position: relative; z-index: 20; display: flex; flex-direction: column; flex-shrink: 0; font-family: var(--font-ui); font-size: 12px; color: var(--text); }
        .track-stage-controls { display: flex; align-items: center; gap: 6px; padding: 2px 12px 4px; }
        .track-stage.is-step-held .track-stage-panel, .track-stage.is-step-held ~ #stacked-wrap { outline: 2px solid var(--entry-delta); outline-offset: -2px; }
        .track-stage-headline { margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .track-stage-panel { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 220px; margin: 0 10px 8px; border: 1px solid var(--line); border-radius: 4px; position: relative; }
        .stage-base-more { border: none; background: none; color: var(--muted); padding: 0 2px; cursor: pointer; }
        .track-stage-base-info { position: absolute; z-index: 5; left: 8px; top: 28px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel, var(--bg)); font-size: 12px; line-height: 1.7; }
        .track-stage-base-info[hidden] { display: none; }
        .track-stage-base-info .tb-link { border: none; background: none; padding: 0; color: var(--accent); cursor: pointer; }
        /* Overlaid, the steps view fills the height the lanes leave (the cursor spectrum is folded): both axes in sight. */
        .track-stage[data-layout="overlay"] { flex: 1 1 auto; min-height: 0; }
        .track-stage-panel > canvas { flex: 1 1 0; width: 100%; min-height: 0; }
        .track-stage-diff { display: flex; flex-direction: column; flex: 0 0 35%; min-height: 0; border-top: 1px solid var(--line); }
        .track-stage-diff > canvas { flex: 1 1 0; width: 100%; min-height: 0; }
        .track-stage-bar { flex-shrink: 0; font-family: var(--font-ui); }
        .entry-zoom-box { position: absolute; border: 1px dashed var(--text); pointer-events: none; z-index: 2; }
        .entry-zoom-box[hidden] { display: none; }
        /* ── Controls of the entry table and the comparison (the approved chip design) ──
           Anything one can press is 28 px high with 12 px text; information that cannot be pressed is a
           20 px tag without a border. Colour keeps to roles; focus is a white ring. Greys derive from the
           theme's text and surface, so the light and high-contrast themes follow. */
        .entry-screen, .track-stage-bar, .spec-pop {
            --chip-bg: color-mix(in srgb, var(--text) 6%, var(--surface));
            --chip-line: color-mix(in srgb, var(--text) 18%, var(--surface));
            --chip-hover-bg: color-mix(in srgb, var(--text) 10%, var(--surface));
            --chip-hover-line: color-mix(in srgb, var(--text) 35%, var(--surface));
            --dim: color-mix(in srgb, var(--text) 32%, var(--surface));
            --dim-line: color-mix(in srgb, var(--text) 10%, var(--surface));
            --ring: 0 0 0 2px var(--surface), 0 0 0 4px var(--text);
        }
        /* The spectrogram / spectrum ⚙: the same chips, 12 px text, a row per setting (label left, control right). */
        .spec-pop { position: absolute; z-index: 50; width: 280px; display: grid; gap: 8px; padding: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.35); color: var(--text); font: 12px var(--font-ui); }
        .spec-pop[hidden] { display: none; }
        .spec-pop-check { display: flex; align-items: center; gap: 6px; cursor: pointer; }
        .spec-pop-check input { accent-color: var(--text); margin: 0; }
        .spec-pop-group { border: 0; border-top: 1px solid var(--line); padding: 6px 0 0; display: grid; gap: 6px; min-width: 0; }
        .spec-pop-group:disabled .spec-pop-row { color: var(--dim); }
        .spec-pop-group legend { padding: 0 6px 0 0; color: var(--muted); font-size: 11px; }
        .spec-pop-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .spec-pop-pair { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); }
        .spec-pop-pair .spec-pop-field { width: 64px; }
        .spec-pop-field { min-height: 28px; width: 120px; box-sizing: border-box; padding: 0 8px; border: 1px solid var(--chip-line); border-radius: 6px; background: var(--chip-bg); color: var(--text); font: 12px var(--font-mono); }
        .spec-pop-field:hover:not(:disabled) { border-color: var(--chip-hover-line); }
        .spec-pop-field:focus-visible { outline: none; box-shadow: var(--ring); }
        .spec-pop-field:disabled { color: var(--dim); border-color: var(--dim-line); cursor: not-allowed; }
        .spec-pop-field::placeholder { color: var(--dim); }
        .spec-pop-note { color: var(--muted); font-size: 11px; }
        .spec-pop-bar { display: flex; gap: 6px; justify-content: flex-end; }
        .spec-pop-bar .tb-btn { min-height: 28px; padding: 0 10px; border-radius: 6px; font-size: 12px; }
        .spec-pop-bar .spec-pop-apply { background: var(--text); border-color: var(--text); color: var(--surface); font-weight: 600; }
        .entry-screen button, .entry-screen select, .track-stage-bar button {
            min-height: 28px; box-sizing: border-box; font-size: 12px; border-color: var(--chip-line); border-radius: 6px; padding: 0 10px;
        }
        .entry-screen button:hover:not(:disabled), .track-stage-bar button:hover:not(:disabled) { background: var(--chip-hover-bg); border-color: var(--chip-hover-line); }
        .entry-screen button:focus-visible, .entry-screen select:focus-visible, .track-stage-bar button:focus-visible, .track-stage-bar input:focus-visible { outline: none; box-shadow: var(--ring); }
        .entry-screen button:disabled, .track-stage-bar button:disabled { color: var(--dim); border-color: var(--dim-line); cursor: not-allowed; }
        /* The next step of a screen is white, not blue: blue is the base's colour. */
        .entry-screen .entry-primary { background: var(--text); border-color: var(--text); color: var(--surface); font-weight: 600; }
        .entry-screen .entry-primary:hover:not(:disabled):not([aria-disabled="true"]) { background: color-mix(in srgb, var(--text) 70%, #ffffff); border-color: transparent; }
        .entry-screen .entry-primary[aria-disabled="true"] { background: var(--chip-hover-bg); border-color: transparent; color: var(--dim); cursor: not-allowed; }
        .entry-screen .entry-primary:disabled { background: var(--chip-hover-bg); border-color: transparent; color: var(--dim); opacity: 1; }
        .entry-screen .entry-primary kbd { opacity: 0.7; }
        /* The filters are one segmented control; on is the white inverse. */
        .entry-screen button.entry-filter[aria-pressed="true"] { background: var(--text); color: var(--surface); border-color: var(--chip-line); }
        /* Information one cannot press. */
        .awa-tag { display: inline-flex; align-items: center; min-height: 20px; padding: 0 6px; border-radius: 3px; background: var(--chip-bg); color: var(--muted); font-size: 11px; white-space: nowrap; }
        /* Step bar = the wandas Recipe (the early plan's form): square chips joined by ">", folded to the stage
           the screen answers with (white frame). A chip's body is held to see its step's effect; ⚙ is a
           button of its own; a step that offers nothing to press is a tag. */
        .step-bar { display: block; padding: 6px 12px; }
        .step-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .step-gap { flex: 1 0 10px; }
        .step-chip { display: inline-flex; align-items: stretch; min-height: 28px; box-sizing: border-box; border: 1px solid var(--chip-line); border-radius: 6px; background: var(--chip-bg); color: var(--text); font-size: 12px; white-space: nowrap; overflow: hidden; }
        .entry-screen .step-chip > button, .track-stage-bar .step-chip > button { min-height: 26px; border: 0; border-radius: 0; background: transparent; color: inherit; padding: 0 10px; }
        .step-chip > .step-body { display: inline-flex; align-items: center; padding: 0 10px; }
        .entry-screen .step-chip > button.step-body:hover, .track-stage-bar .step-chip > button.step-body:hover { background: var(--chip-hover-bg); }
        .step-chip.is-held > .step-body { background: color-mix(in srgb, var(--entry-delta) 18%, transparent) !important; }
        .entry-screen .step-chip > .step-gear, .entry-screen .step-chip > .step-reset, .track-stage-bar .step-chip > .step-gear, .track-stage-bar .step-chip > .step-reset { padding: 0 8px; border-left: 1px solid var(--chip-line); display: inline-flex; align-items: center; }
        .entry-screen .step-chip > .step-gear:hover, .track-stage-bar .step-chip > .step-gear:hover { background: var(--chip-hover-bg); }
        .step-icon { width: 12px; height: 12px; stroke: var(--muted); fill: none; stroke-width: 1.6; flex: none; }
        .step-chip.is-current { border-color: var(--text); box-shadow: inset 0 0 0 1px var(--text); }
        .step-chip.is-open { border-color: var(--text); }
        .step-chip.is-open .step-icon { stroke: var(--text); }
        .step-chip.is-invalid { border-color: var(--entry-flag); color: var(--entry-flag); }
        .step-chip.is-invalid .step-icon { stroke: var(--entry-flag); }
        .step-chip.is-differs { border-style: dashed; border-color: var(--text); }
        .step-reset { color: var(--muted) !important; }
        .entry-screen .step-more, .track-stage-bar .step-more { min-height: 28px; padding: 0 10px; }
        .entry-screen .step-add, .track-stage-bar .step-add { min-height: 28px; padding: 0 10px; color: var(--muted); }
        .step-link { display: flex; flex-direction: column; align-items: center; gap: 2px; padding-top: 2px; }
        .step-outside-row { margin-top: 10px; }
        .step-outside-heading { font-size: 13px; color: var(--muted); margin-right: 4px; }
        .step-link { position: relative; }
        .entry-screen .step-insert, .track-stage-bar .step-insert { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); min-height: 18px; min-width: 18px; padding: 0 4px; font-size: 11px; line-height: 16px; color: var(--muted); border: 1px solid var(--chip-line); border-radius: 6px; background: var(--chip-bg); opacity: 0; }
        .step-link:hover .step-insert, .step-insert:focus-visible, .step-insert[aria-expanded="true"] { opacity: 1; }
        .step-menu { position: absolute; top: 100%; left: 10px; z-index: 4; width: 300px; max-height: 360px; display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.35); }
        .step-menu-title { font-size: 12px; color: var(--muted); }
        .step-menu input { font: inherit; color: inherit; background: var(--surface); border: 1px solid var(--line); border-radius: 3px; padding: 2px 6px; }
        .step-menu-list { overflow: auto; display: flex; flex-direction: column; }
        .entry-screen .step-menu-item, .track-stage-bar .step-menu-item { display: flex; align-items: baseline; gap: 8px; min-height: 26px; padding: 0 6px; border: 0; border-radius: 4px; background: transparent; color: var(--text); text-align: left; }
        .entry-screen .step-menu-item:hover, .step-menu-item:focus-visible, .track-stage-bar .step-menu-item:hover { background: var(--chip-hover-bg); }
        .step-menu-item.is-off { color: var(--dim); cursor: not-allowed; }
        .step-menu-tag { margin-left: auto; font-size: 11px; color: var(--muted); border: 1px solid var(--chip-line); border-radius: 4px; padding: 0 4px; }
        .step-form-title { font: 11px var(--font-mono); color: var(--muted); }
        .step-form-why { max-width: 280px; color: var(--entry-flag); }
        .step-form-note { max-width: 260px; color: var(--muted); }
        .step-form-bar { display: flex; gap: 6px; justify-content: flex-end; }
        /* ── The step bar as the 手順バー prototype: "Steps", the input, round chips joined by →, a dot per Frame kind ── */
        .step-bar { --step-accent: var(--text); --step-err: #ef6b6b; --kind-channel: var(--muted); --kind-spectrogram: var(--muted); --kind-spectrum: var(--muted); --kind-other: var(--muted); }
        .step-bar .step-row { gap: 4px; align-items: center; }
        .step-label { color: var(--muted); font-size: 11px; letter-spacing: 0.06em; margin-right: 6px; }
        .step-arrow { color: var(--muted); font-size: 11px; padding: 0 1px; user-select: none; }
        .step-input, .step-bar .step-chip { position: relative; display: inline-flex; align-items: center; gap: 6px; height: 30px; box-sizing: border-box; padding: 0 12px; border-radius: 15px; border: 1px solid var(--chip-line); background: var(--chip-bg); color: var(--text); font-size: 12px; white-space: nowrap; overflow: visible; transition: opacity 0.12s, background 0.12s, border-color 0.12s; }
        .step-bar .step-chip:hover { border-color: var(--muted); }
        .entry-screen .step-bar .step-chip > button, .step-bar.track-stage-bar .step-chip > button { min-height: 0; height: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; }
        .entry-screen .step-bar .step-chip > button.step-body:hover, .step-bar.track-stage-bar .step-chip > button.step-body:hover { background: transparent; }
        .step-bar .step-chip > .step-body { gap: 6px; }
        .step-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--kind-other); }
        .step-dot[data-kind="ChannelFrame"] { background: var(--kind-channel); }
        .step-dot[data-kind="SpectrogramFrame"], .step-dot[data-kind="CepstrogramFrame"], .step-dot[data-kind="RoughnessFrame"] { background: var(--kind-spectrogram); border-radius: 1px; }
        /* Colour belongs to the roles (base, slots): a Frame's kind is told by the dot's shape (time ●, image ■, spectrum ◆). */
        .step-dot[data-kind="SpectralFrame"], .step-dot[data-kind="NOctFrame"] { background: var(--kind-spectrum); border-radius: 1px; transform: rotate(45deg) scale(0.85); }
        .step-dot[data-kind=""] { background: var(--step-err); }
        /* The stage on screen: a soft fill, a double border, and its ⚙ inside the chip. */
        .step-bar .step-chip.is-current { background: color-mix(in srgb, var(--step-accent) 14%, var(--chip-bg)); border-color: var(--step-accent); box-shadow: inset 0 0 0 1px var(--step-accent); }
        .step-bar .step-chip.is-after { opacity: 0.6; }
        /* A step that cannot run stays in place: dashed in the warning colour (not a role colour), muted, its dot a ⚠. */
        .step-bar .step-chip.is-invalid { border: 1px dashed var(--entry-flag); background: transparent; color: var(--text); }
        .step-bar .step-chip.is-invalid > .step-body { color: var(--muted); }
        .step-bar .step-dot[data-kind=""] { width: auto; height: auto; border-radius: 0; background: none; color: var(--entry-flag); font-size: 11px; line-height: 1; }
        .step-bar .step-dot[data-kind=""]::before { content: '⚠'; }
        .step-bar .step-chip.is-invalid .step-icon { stroke: var(--step-err); }
        .step-bar .step-chip.is-differs { border-style: dashed; }
        .entry-screen .step-bar .step-chip > .step-gear, .entry-screen .step-bar .step-chip > .step-reset, .step-bar.track-stage-bar .step-chip > .step-gear, .step-bar.track-stage-bar .step-chip > .step-reset { border-left: 0; padding: 0 0 0 2px; }
        /* ⚙ shows on the chip on screen (and while a chip is pointed at or has focus); × at the top right on hover. */
        .step-bar .step-chip > .step-gear { opacity: 0; }
        .step-bar .step-chip.is-current > .step-gear, .step-bar .step-chip.is-open > .step-gear, .step-bar .step-chip.is-invalid > .step-gear, .step-bar .step-chip:hover > .step-gear, .step-bar .step-chip:focus-within > .step-gear { opacity: 1; }
        .entry-screen .step-bar .step-x, .step-bar.track-stage-bar .step-x { position: absolute; top: -8px; right: -8px; width: 18px; height: 18px; min-height: 0; padding: 0; border-radius: 9px; border: 1px solid var(--chip-line); background: var(--panel); color: var(--text); font-size: 13px; line-height: 16px; text-align: center; opacity: 0; z-index: 1; }
        /* × shows on the chip under the pointer or with the focus, and on the chip on screen. */
        .step-bar .step-chip:hover > .step-x, .step-bar .step-chip:focus-within > .step-x, .step-bar .step-chip.is-current > .step-x { opacity: 1; }
        .step-bar .step-x::before { content: '×'; }
        .step-bar .step-x:hover { color: var(--entry-flag); border-color: var(--entry-flag); }
        /* The app's 1/3-octave branch stands apart at the bar's end: a thin rule, no arrow from the chain. */
        .step-bar .step-branch { display: inline-flex; align-items: center; padding-left: 10px; margin-left: 6px; border-left: 1px solid var(--line); }
        .step-bar .step-chip.is-dragging { opacity: 0.3; }
        /* Room above the chips for the bypass button that sits on their top edge. */
        .entry-screen .step-bar, .step-bar.track-stage-bar { padding-top: 14px; overflow: visible; }
        /* ↶ ↷ at the bar's start: undo and redo the bar's edits. */
        .step-bar .step-history { display: inline-flex; margin-right: 6px; padding-right: 6px; border-right: 1px solid var(--line); }
        .entry-screen .step-bar .step-history > button, .step-bar.track-stage-bar .step-history > button { min-height: 28px; width: 26px; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--text); font-size: 15px; }
        .step-bar .step-history > button:disabled { color: var(--dim); opacity: 0.5; cursor: default; }
        .step-bar .step-history > button:not(:disabled):hover { border-color: var(--muted); }
        /* Bypass sits beside ×: an effect pedal's bypass, shown with ×; pressed, the chip is dashed and struck through. */
        .entry-screen .step-bar .step-chip > .step-bypass, .step-bar.track-stage-bar .step-chip > .step-bypass { position: absolute; top: -13px; right: 14px; width: 24px; height: 17px; min-height: 0; padding: 0; border-radius: 6px; border: 1px solid var(--chip-line); background: var(--panel); color: var(--text); display: grid; place-items: center; opacity: 0; z-index: 1; }
        .step-bar .step-bypass-icon { width: 14px; height: 12px; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; }
        .step-bar .step-bypass-icon rect { fill: currentColor; fill-opacity: 0.35; }
        .step-bar .step-chip:hover > .step-bypass, .step-bar .step-chip:focus-within > .step-bypass, .step-bar .step-chip.is-current > .step-bypass, .step-bar .step-chip.is-bypassed > .step-bypass { opacity: 1; }
        .step-bar .step-bypass:hover { border-color: var(--text); }
        .step-bar .step-chip.is-bypassed { border-style: dashed; background: transparent; }
        .step-bar .step-chip.is-bypassed > .step-body { color: var(--dim); text-decoration: line-through; }
        .entry-screen .step-bar .step-chip.is-bypassed > .step-bypass, .step-bar.track-stage-bar .step-chip.is-bypassed > .step-bypass { border-color: var(--text); background: var(--text); color: var(--panel); }
        .step-bar .step-chip.is-bypassed > .step-bypass .step-bypass-icon rect { fill: none; stroke-dasharray: 1.2 1.2; }
        /* The input is a chip on the comparison: pressed, the files' waveforms. */
        .step-bar .step-chip.step-input > .step-body { cursor: pointer; }
        .step-menu-item.is-earlier .step-menu-hint { color: var(--text); }
        .step-drop { position: absolute; width: 3px; border-radius: 2px; background: var(--step-accent); pointer-events: none; }
        .entry-screen .step-bar .step-add, .step-bar.track-stage-bar .step-add { height: 30px; min-height: 30px; min-width: 30px; padding: 0 10px; border-radius: 15px; border: 1px dashed var(--chip-line); background: transparent; color: var(--muted); }
        .step-bar .step-add:hover, .step-bar .step-add[aria-expanded="true"] { border-color: var(--step-accent); color: var(--step-accent); }
        .step-bar .step-link { display: inline-flex; flex-direction: row; align-items: center; gap: 2px; padding: 0 2px; }
        .entry-screen .step-bar .step-insert, .step-bar.track-stage-bar .step-insert { position: static; transform: none; opacity: 0.75; border-radius: 9px; }
        .step-bar .step-link:hover .step-insert { opacity: 1; }
        .step-menu { width: 520px; max-width: calc(100vw - 24px); max-height: 440px; }
        .step-menu-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
        .step-menu-group { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .step-menu-group-name { color: var(--muted); font-size: 11px; letter-spacing: 0.04em; }
        .entry-screen .step-menu-item, .track-stage-bar .step-menu-item { flex-direction: column; align-items: stretch; gap: 1px; padding: 5px 8px; border: 1px solid var(--chip-line); border-radius: 6px; background: var(--chip-bg); }
        .entry-screen .step-menu-item:hover, .step-menu-item:focus-visible, .track-stage-bar .step-menu-item:hover { border-color: var(--step-accent, var(--text)); }
        .step-menu-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .step-menu-name { overflow-wrap: anywhere; }
        .step-menu-line .step-menu-tag { margin-left: auto; white-space: nowrap; }
        .step-menu-hint { color: var(--muted); font-size: 11px; }
        /* Rows of an earlier chain: greyed, their outlier marks too, until scanned again. */
        .entry-row.is-stale td { color: var(--dim); }
        .entry-filter.is-stale [data-entry-count] { color: var(--dim); }
        /* Slots (entry footer, comparison cards): a role-coloured number box and a label. */
        .entry-screen .awa-slot { display: inline-flex; align-items: center; gap: 8px; padding: 0 10px 0 5px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); background: transparent; }
        .awa-slot.role-base { --role: var(--entry-base); --role-tint: color-mix(in srgb, var(--entry-base) 16%, transparent); }
        .awa-slot.role-compare { --role: var(--entry-compare); --role-tint: color-mix(in srgb, var(--entry-compare) 16%, transparent); }
        /* Each slot keeps its colour everywhere: its card, its badge and its line on the comparison's overlay. */
        .awa-slot.slot-2 { --role: var(--entry-slot-2); --role-tint: color-mix(in srgb, var(--entry-slot-2) 16%, transparent); }
        .awa-slot.slot-3 { --role: var(--entry-slot-3); --role-tint: color-mix(in srgb, var(--entry-slot-3) 16%, transparent); }
        .awa-slot-num { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; box-sizing: border-box; border-radius: 4px; font-size: 11px; font-weight: 700; background: var(--role); color: var(--surface); }
        .awa-slot-label { overflow: hidden; text-overflow: ellipsis; }
        .entry-screen button.awa-slot.is-empty, .track-stage-bar button.awa-slot.is-empty { border-style: dashed; }
        .awa-slot.is-empty .awa-slot-num { background: transparent; border: 1px solid var(--role); color: var(--role); }
        .awa-slot.is-empty .awa-slot-label { color: var(--muted); }
        .entry-screen button.awa-slot.is-active, .track-stage-bar button.awa-slot.is-active { border-color: var(--role); background: var(--role-tint); }
        .entry-screen button.awa-slot.is-held, .track-stage-bar button.awa-slot.is-held { border-color: var(--role); background: var(--role); color: #0b1220; }
        .awa-slot.is-held .awa-slot-num { background: #0b1220; color: var(--role); }
        .entry-chip { margin-right: 6px; }
        /* A key that cannot act lights the focus ring once. */
        @keyframes awa-ring { 0%, 60% { box-shadow: var(--ring); } 100% { box-shadow: none; } }
        .awa-slot.is-flash, .entry-chip.is-flash { animation: awa-ring 0.9s ease-out; }
        /* Key hints: small, pressable, quiet. */
        .entry-keys .entry-key { min-height: 20px; font-size: 11px; border-radius: 3px; padding: 0 6px; }
        /* The bottom row: hints on the left, the version small at the right end. */
        #app-footer {
            display: flex; align-items: center; flex-shrink: 0; height: 22px; overflow: hidden;
            font-size: 11px; color: var(--muted); background: var(--panel); border-top: 1px solid var(--line);
        }
        #hint-footer {
            flex: 1; align-self: stretch; min-width: 0; line-height: 21px; padding: 0 10px;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        #task-status { flex: none; padding: 0 10px; white-space: nowrap; color: var(--text); }
        #task-status[hidden] { display: none; }
        #task-status[data-state="busy"]::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 6px; border: 1.5px solid var(--muted); border-top-color: transparent; border-radius: 50%; vertical-align: -1px; animation: awa-spin 0.8s linear infinite; }
        #task-status[data-state="failed"] { color: var(--entry-flag); }
        @keyframes awa-spin { to { transform: rotate(360deg); } }
        #app-version { flex: none; padding: 0 10px; font-family: var(--font-mono); white-space: nowrap; }
        /* On the entry table and the comparison the footer is where symbols explain themselves, so it reads as text, not as a status line. */
        body:has(#entry-screen:not([hidden])) #hint-footer { color: var(--text); font-size: 12px; }

        /* ── Track layout ── */
        #tracks-wrapper { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; background: var(--track-bg); }
        #ruler-row { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; }
        #ruler-spacer { width: 130px; flex-shrink: 0; border-right: 1px solid var(--line); background: var(--track-header-bg); }
        #ruler-canvas { flex: 1; height: 20px; display: block; }

        .track-row { display: flex; border-bottom: 1px solid var(--line); flex-shrink: 0; position: relative; }
        .track-header {
            width: 130px; flex-shrink: 0; border-right: 1px solid var(--line);
            padding: 5px 6px; display: flex; flex-direction: column; gap: 2px; font-size: 9px; background: var(--track-header-bg);
        }
        .track-channel-lanes { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .track-channel-lane { display: flex; flex-direction: column; min-height: 0; border-bottom: 1px solid rgba(128, 128, 128, 0.18); }
        .track-channel-lane:last-child { border-bottom: 0; }
        .track-channel-lane-header {
            height: 18px; display: flex; align-items: center; gap: 10px; padding: 0 6px;
            color: var(--muted); font-size: 9px; background: rgba(128, 128, 128, 0.06); white-space: nowrap; overflow: hidden;
        }
        .track-channel-lane-body { display: flex; min-width: 0; }
        .track-channel-lane-label { color: var(--text); font-weight: 600; min-width: 92px; overflow: hidden; text-overflow: ellipsis; }
        .track-name { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 600; }
        .clip-badge { display: inline-block; background: #d32f2f; color: #fff; font-size: 8px; font-weight: 700; border-radius: 2px; padding: 0px 3px; margin-left: 4px; vertical-align: middle; letter-spacing: 0.5px; cursor: default; }
        .track-meta { color: var(--muted); }
        .track-btns { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; align-items: center; }
        .track-btn {
            font-size: 9px; padding: 1px 4px; border-radius: 2px;
            border: 1px solid var(--line); background: var(--surface);
            color: var(--muted); cursor: pointer;
        }
        .track-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .track-btn.is-playing { background: var(--accent); color: #fff; border-color: var(--accent); }
        .track-offset { display: none; align-items: center; gap: 2px; margin-top: 3px; }
        .track-row.is-shifted .track-offset { display: flex; }
        .track-more { position: relative; display: inline-block; }
        .track-more > summary { list-style: none; cursor: pointer; }
        .track-more > summary::-webkit-details-marker { display: none; }
        .track-more-menu { position: absolute; z-index: 20; left: 0; top: calc(100% + 2px); display: flex; flex-direction: column; gap: 2px; min-width: 150px; padding: 4px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); }
        .track-more-menu .track-btn { width: 100%; text-align: left; white-space: nowrap; }
        .track-offset-val {
            font-size: 9px; font-family: var(--font-mono);
            background: var(--surface); border: 1px solid var(--line);
            border-radius: 2px; padding: 1px 3px; width: 56px; text-align: right;
            cursor: text;
        }
        .track-offset-input { width: 5em; font-size: inherit; font-family: var(--font-mono); text-align: right; background: var(--vscode-input-background, #1e1e1e); color: var(--vscode-input-foreground, #d4d4d4); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 2px; }
        .track-canvas-stack { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        /* The right padding is the spectrogram's colour bar, so both plots share one time axis. */
        .track-canvas-wrap { display: flex; position: relative; overflow: hidden; background: var(--track-bg); padding-right: ${SPECTROGRAM_COLORBAR_WIDTH}px; }
        .track-spec-wrap { display: flex; position: relative; overflow: hidden; background: var(--track-bg); }
        .track-split { flex: none; height: 5px; cursor: row-resize; background: var(--line); opacity: 0.5; }
        /* The keyboard's place: a focused lane, spectrum or resize edge has a ring in the theme's focus colour (the mouse's focus has none). */
        .track-canvas, .track-spectrum-canvas, #spectrum-overlay-canvas { outline: none; }
        .track-canvas:focus-visible, .track-spectrum-canvas:focus-visible, #spectrum-overlay-canvas:focus-visible, .entry-table td.entry-mark:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
        [role="separator"] { touch-action: none; }
        [role="separator"]:focus { outline: none; }
        [role="separator"]:focus-visible { outline: 2px solid var(--accent); outline-offset: -1px; background: color-mix(in srgb, var(--accent) 45%, transparent); opacity: 1; }
        .track-split:hover, body.is-split-resizing .track-split { opacity: 1; background: color-mix(in srgb, var(--accent) 45%, transparent); }
        body.is-stage-view .track-split, body.is-stage-view .track-spec-wrap { display: none; }
        body.is-stage-view .track-canvas-wrap { padding-right: 0; }
        .track-axis-canvas { flex: none; display: block; }
        .track-canvas { display: block; width: 100%; height: 80px; cursor: crosshair; }
        .track-spectrum-wrap { width: 180px; flex-shrink: 0; border-left: 1px solid var(--line); background: var(--track-bg); }
        .track-spectrum-canvas { display: block; width: 100%; height: 80px; cursor: crosshair; }
        .height-resizer { position: absolute; z-index: 5; cursor: row-resize; background: transparent; }
        .height-resizer:hover,
        body.is-height-resizing .height-resizer { background: color-mix(in srgb, var(--accent) 45%, transparent); }
        .track-height-resizer { left: 130px; right: 0; bottom: -3px; height: 6px; }

        /* ── Responsive power spectrum ── */
        @media (max-width: 900px) {
            .track-spectrum-wrap { width: 140px; }
        }
        @media (max-width: 700px) {
            .track-spectrum-wrap { width: 100px; }
        }
        @media (max-width: 500px) {
            .track-spectrum-wrap { display: none; }
        }

        /* ── Cursor power spectrum section ── */
        /* The steps view draws its own plots: the lanes' time zoom, heights, exports and cursor spectrum do nothing there. */
        body.is-stage-view .tb-track-only, body.is-stage-view #spectrum-section,
        body.is-stage-view [data-action="spectrum-height-drag"] { display: none !important; }
        /* Before anything is open: the side panel says what will be there, and the lanes' controls wait for a track. */
        #directory-selection-layout.is-empty #entry-dock::before { content: attr(data-empty-hint); display: block; padding: 48px 20px; color: var(--muted); text-align: center; line-height: 1.6; }
        #directory-selection-layout.is-empty #toolbar, #directory-selection-layout.is-empty #spectrum-section,
        #directory-selection-layout.is-empty [data-action="spectrum-height-drag"] { display: none !important; }
        /* The 書き出し menu offers what can be written now: the comparison in the steps view, the table's exports while it is open. */
        /* The table's exports show while the table does: not once the side panel holding it is folded. */
        body:not(.is-stage-view) .tb-stage-only, body:not(:has(#entry-screen:not([hidden]))) .tb-entry-only,
        body:has(#directory-selection-layout.sidebar-collapsed) .tb-entry-only { display: none !important; }
        #spectrum-section {
            border-top: 1px solid var(--line); background: var(--panel);
            display: flex; flex-direction: column; flex-shrink: 0; position: relative;
        }
        #spectrum-section-header {
            display: flex; align-items: center; gap: 8px; padding: 4px 10px;
            font-size: 11px; color: var(--muted); border-bottom: 1px solid var(--line);
        }
        #spectrum-split { display: flex; align-items: stretch; }
        /* Both halves share one layout: a header row (what was analysed, then the cursor readout at its right end) over the plot. */
        #spectrum-overlay-wrap, #spectrum-section.has-pair #pair-spectrum-wrap {
            display: flex; flex-direction: column; flex: 1 1 0; min-width: 0;
            padding: 2px 10px 6px; background: var(--track-bg); position: relative; overflow: hidden;
        }
        .spectrum-pane-header {
            display: flex; align-items: center; gap: 10px; height: 18px; flex: none;
            font-size: 10px; font-family: var(--font-mono); color: var(--muted); white-space: nowrap; overflow: hidden;
        }
        /* The readout keeps its full width; what was analysed gives way to it. */
        .spectrum-pane-header > * { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .spectrum-pane-header > .spectrum-readout { flex: none; margin-left: auto; }
        /* The pair view against a reference lane takes the right part of the spectrum section. */
        #pair-divider, #pair-spectrum-wrap { display: none; }
        #spectrum-section.has-pair #pair-divider { display: block; flex: none; width: 6px; cursor: col-resize; background: var(--line); }
        #spectrum-section.has-pair #pair-divider:hover,
        body.is-pair-resizing #pair-divider { background: color-mix(in srgb, var(--accent) 45%, transparent); }
        body.is-pair-resizing { cursor: col-resize; user-select: none; }
        #spectrum-section.has-pair #spectrum-overlay-wrap { flex: 0 0 50%; }
        #pair-spectrum-summary.is-warning { color: var(--vscode-editorWarning-foreground, #c98a00); }
        #pair-spectrum-legend { display: flex; gap: 8px; overflow: hidden; font-family: var(--font-ui); }
        .pair-legend-item { display: inline-flex; align-items: center; gap: 3px; }
        .pair-legend-item.is-empty { opacity: 0.45; }
        .pair-legend-swatch { width: 10px; height: 2px; border-radius: 1px; }
        .pair-legend-item.is-empty .pair-legend-swatch { background: var(--muted) !important; }
        .pair-legend-mark { margin-left: 1px; }
        #pair-spectrum-plot { position: relative; flex: 1 1 auto; min-height: 0; }
        /* A replacement request is computing; the plot still shows the previous inputs. */
        #pair-spectrum-wrap.is-stale #pair-spectrum-plot,
        #pair-spectrum-wrap.is-stale #pair-spectrum-summary { opacity: 0.45; }
        #pair-spectrum-canvas { display: block; width: 100%; cursor: crosshair; }
        #pair-spectrum-message {
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            font-size: 11px; color: var(--muted); text-align: center; padding: 0 12px; pointer-events: none;
        }
        .pair-ref-btn { display: inline-flex; align-items: center; gap: 2px; }
        .pair-ref-btn > * { pointer-events: none; }
        .track-channel-lane-header .pair-ref-btn { margin-left: auto; padding: 0 3px; height: 14px; }
        .pair-ref-badge { display: none; font-size: 9px; }
        .pair-ref-btn.is-active { color: var(--accent); }
        .pair-ref-btn.is-active .pair-ref-badge { display: inline; }
        .spectrum-height-resizer { left: 0; right: 0; top: -3px; height: 6px; }
        #spectrum-overlay-canvas { display: block; width: 100%; height: 140px; cursor: crosshair; }
        #spectrum-section-header .panel-toggle:first-of-type { margin-left: auto; }
        /* Maximized: the tracks keep a strip for moving the cursor and the plot takes the rest; flex-basis 0 lets the runtime size the canvas from the wrap. */
        .spectrum-maximized > #tracks-wrapper { flex: 0 1 auto; max-height: 30%; }
        .spectrum-maximized > #spectrum-section { flex: 1 1 0; min-height: 0; }
        #spectrum-section.is-maximized #spectrum-split { flex: 1 1 0; min-height: 0; overflow: hidden; }
        #spectrum-section.is-maximized #spectrum-overlay-wrap { overflow: hidden; }
        #spectrum-section.is-maximized .spectrum-height-resizer { display: none; }
        /* The zoom toolbar lays itself out with an inline display:flex. */
        #spectrum-section.is-collapsed #spectrum-zoom-toolbar,
        #spectrum-section.is-collapsed #spectrum-split { display: none !important; }
        #spectrum-section.is-collapsed #spectrum-section-header { border-bottom: none; }
        #spectrum-section.is-collapsed .spectrum-height-resizer { cursor: default; }
        #spectrum-section.is-collapsed #spectrum-section-header { cursor: pointer; }
        #spectrum-section.is-collapsed #spectrum-section-header:hover { background: color-mix(in srgb, var(--accent) 18%, transparent); }
        #directory-selection-layout.sidebar-collapsed #selection-sidebar,
        #directory-selection-layout.sidebar-collapsed .tree-resizer { display: none; }
        #selection-sidebar-rail {
            display: none; flex-direction: column; align-items: center; gap: 8px; flex-shrink: 0;
            width: 22px; padding: 8px 0; border: none; border-right: 1px solid var(--line);
            background: var(--panel); color: var(--muted); font: inherit; font-size: 11px; cursor: pointer;
        }
        #selection-sidebar-rail > span { pointer-events: none; }
        #selection-sidebar-rail > span:first-child { font-size: 14px; color: var(--accent); }
        #selection-rail-count { writing-mode: vertical-rl; font-family: var(--font-mono); }
        #selection-sidebar-rail:hover { background: color-mix(in srgb, var(--accent) 18%, var(--panel)); }
        #directory-selection-layout.sidebar-collapsed #selection-sidebar-rail { display: flex; }
        .track-title-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
        .track-title-row .track-name { flex: 1 1 auto; min-width: 0; }
        .track-drag-handle { cursor: grab; color: var(--muted); font-size: 12px; user-select: none; flex-shrink: 0; padding: 0 2px; line-height: 1; }
        .track-drag-handle:active { cursor: grabbing; }
        /* A role chip (roleChip.ts): the role's colour and number, or the track's own colour and · without one; its menu sets the slot. */
        .role-chip { position: relative; display: inline-block; flex-shrink: 0; }
        .role-chip > summary { list-style: none; cursor: pointer; }
        .role-chip > summary::-webkit-details-marker { display: none; }
        .role-chip-face { display: inline-flex; align-items: center; justify-content: center; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 3px; font: 600 9px/1 var(--font-mono); color: #111; white-space: nowrap; }
        .role-chip-face.is-none { background: var(--role-fallback, transparent); color: rgba(0, 0, 0, 0.55); }
        .role-chip-face:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
        .role-chip-menu { position: absolute; z-index: 30; left: 0; top: calc(100% + 2px); display: flex; flex-direction: column; gap: 1px; min-width: 120px; padding: 3px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); }
        .role-chip-item { display: flex; align-items: center; gap: 6px; padding: 2px 6px; border: 0; border-radius: 3px; background: transparent; color: var(--text); font: inherit; font-size: 11px; text-align: left; cursor: pointer; white-space: nowrap; }
        .role-chip-item:hover, .role-chip-item:focus-visible, .role-chip-item.is-current { background: var(--line); }
        .role-chip-item kbd { margin-left: auto; font: 9px var(--font-mono); color: var(--muted); }
        .role-chip-mark { display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; border-radius: 3px; font: 600 9px/1 var(--font-mono); color: #111; }
        .role-chip-mark.is-none { border: 1px dashed var(--muted); color: var(--muted); }
        .track-row.drag-over { outline: 2px solid var(--accent); outline-offset: -2px; }

        /* ── Empty state ── */
        #empty-state {
            display: none; flex: 1; align-items: center; justify-content: center;
            flex-direction: column; gap: 12px; color: var(--muted); font-size: 14px;
        }
        #empty-state.is-visible { display: flex; }
        #audio-host { display: none; }

        /* ── Directory selection ── */
        #directory-selection-layout {
            display: flex;
            flex-direction: column;
            flex: 1 1 auto;
            min-width: 0;
            min-height: 0;
        }
        #selection-toolbar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            border-bottom: 1px solid var(--line);
            background: var(--panel);
            flex-wrap: wrap;
        }
        /* The interpreter is named only when it needs attention; the command palette chooses another any time. */
        #selection-python-environment:not(.is-warning) { display: none; }
        #selection-python-environment {
            margin-left: auto;
            max-width: min(360px, 45vw);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        #selection-body {
            display: flex;
            flex-direction: row;
            flex: 1;
            min-height: 0;
        }
        #selection-sidebar {
            display: flex;
            flex-direction: column;
            min-height: 0;
            width: 340px;
            min-width: 160px;
            flex-shrink: 0;
            position: relative;
            background: var(--panel);
        }
        .tree-resizer {
            width: 4px;
            flex-shrink: 0;
            background: var(--line);
            cursor: col-resize;
            transition: background 0.15s;
            position: relative;
        }
        .tree-resizer:hover,
        .tree-resizer.is-dragging {
            background: var(--accent);
        }
        /* The collapse button sits in the panel's own top-right corner, like the spectrum's in its header. */
        #selection-sidebar > .panel-toggle { position: absolute; top: 8px; right: 8px; z-index: 1; }

        #selection-results-pane {
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            min-width: 0;
            min-height: 0;
            background:
                radial-gradient(circle at top right, rgba(15,123,108,0.14), transparent 34%),
                linear-gradient(160deg, rgba(255,255,255,0.6), rgba(15,123,108,0.05));
        }
        @media (max-width: 900px) {
            #selection-sidebar { max-width: 50vw; }
        }
        @media (max-width: 560px) {
            #selection-sidebar { max-height: 40vh; overflow: auto; max-width: none; }
            #selection-body {
                flex-direction: column;
            }
            #selection-sidebar-rail {
                width: 100%;
                flex-direction: row;
                justify-content: center;
                padding: 2px 0;
                border-right: none;
                border-bottom: 1px solid var(--line);
            }
            #selection-rail-count {
                writing-mode: horizontal-tb;
            }
            #selection-sidebar {
                width: 100% !important;
                min-width: 0;
                /* Stacked and empty, the panel would have no height left for its absolutely placed toggle. */
                min-height: 34px;
                border-right: none;
                border-bottom: 1px solid var(--line);
            }
            .tree-resizer {
                display: none;
            }
        }
        /* Accessibility: visible focus rings */
        .tb-btn:focus-visible,
        .track-btn:focus-visible {
            outline: 2px solid var(--vscode-focusBorder, #007fd4);
            outline-offset: 2px;
        }
        /* Suppress browser default outline on mouse/touch focus (non-keyboard) */
        .tb-btn:focus:not(:focus-visible),
        .track-btn:focus:not(:focus-visible) {
            outline: none;
        }
        `;
}
