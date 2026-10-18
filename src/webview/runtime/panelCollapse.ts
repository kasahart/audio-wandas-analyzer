import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr, setHint } from './hintFooter';

export type CollapsiblePanel = 'sidebar' | 'spectrum';

export type PanelCollapseStrings = Pick<UiStrings, 'hintCollapseSidebar' | 'hintExpandSidebar' | 'hintCollapseSpectrum' | 'hintExpandSpectrum'
    | 'hintMaximizeSpectrum' | 'hintRestoreSpectrum'>;

interface PanelToggleView {
    glyph: string;
    hint: string;
}

const PANEL_TOGGLE_ACTION_ATTRS: Record<CollapsiblePanel, string> = {
    sidebar: 'data-action="toggle-selection-sidebar"',
    spectrum: 'data-action="toggle-spectrum-panel"',
};

/** The sidebar folds to the left and the docked spectrum folds down, so each glyph points where the panel goes. */
function panelToggleView(panel: CollapsiblePanel, collapsed: boolean, strings: PanelCollapseStrings): PanelToggleView {
    if (panel === 'sidebar') {
        return collapsed ? { glyph: '›', hint: strings.hintExpandSidebar } : { glyph: '‹', hint: strings.hintCollapseSidebar };
    }
    return collapsed ? { glyph: '▴', hint: strings.hintExpandSpectrum } : { glyph: '▾', hint: strings.hintCollapseSpectrum };
}

export function panelToggleHtml(panel: CollapsiblePanel, collapsed: boolean, strings: PanelCollapseStrings): string {
    const view = panelToggleView(panel, collapsed, strings);
    return '<button class="tb-btn panel-toggle" ' + PANEL_TOGGLE_ACTION_ATTRS[panel] + ' aria-expanded="' + String(!collapsed) + '"'
        + hintAttr(view.hint) + ' aria-label="' + escapeHtml(view.hint) + '">' + view.glyph + '</button>';
}

export function syncPanelToggle(button: HTMLElement, panel: CollapsiblePanel, collapsed: boolean, strings: PanelCollapseStrings): void {
    const view = panelToggleView(panel, collapsed, strings);
    button.textContent = view.glyph;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', view.hint);
    setHint(button, view.hint);
}

function maximizeToggleView(maximized: boolean, strings: PanelCollapseStrings): PanelToggleView {
    return maximized ? { glyph: '⤡', hint: strings.hintRestoreSpectrum } : { glyph: '⤢', hint: strings.hintMaximizeSpectrum };
}

export function spectrumMaximizeHtml(maximized: boolean, strings: PanelCollapseStrings): string {
    const view = maximizeToggleView(maximized, strings);
    return '<button class="tb-btn panel-toggle" data-action="toggle-spectrum-maximize" aria-pressed="' + String(maximized) + '"'
        + hintAttr(view.hint) + ' aria-label="' + escapeHtml(view.hint) + '">' + view.glyph + '</button>';
}

export function syncSpectrumMaximize(button: HTMLElement, maximized: boolean, strings: PanelCollapseStrings): void {
    const view = maximizeToggleView(maximized, strings);
    button.textContent = view.glyph;
    button.setAttribute('aria-pressed', String(maximized));
    button.setAttribute('aria-label', view.hint);
    setHint(button, view.hint);
}
