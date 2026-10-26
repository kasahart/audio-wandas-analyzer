import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';
import { panelToggleHtml, type PanelCollapseStrings } from './panelCollapse';

export interface SelectionLayoutParts {
    rootPath: string;
    isEmpty?: boolean;
    sidebarCollapsed?: boolean;
    resultsPaneHtml: string;
    python?: { text: string; tooltip: string; warning: boolean };
}

export type SelectionLayoutStrings = Pick<UiStrings,
    | 'selectionEmptyHint' | 'btnOpenFile' | 'btnOpenFolder' | 'btnOpenAnotherFolder'
    | 'hintOpenFile' | 'hintOpenFolder' | 'hintBrowserOpenFolder' | 'hintTreeResizer'> & PanelCollapseStrings;

/** Until the panel lists something there is no "another" folder to open. */
export function selectionFolderButton(listed: boolean, strings: SelectionLayoutStrings): { text: string; hint: string } {
    return listed
        ? { text: strings.btnOpenAnotherFolder, hint: strings.hintOpenFolder }
        : { text: strings.btnOpenFolder, hint: strings.hintBrowserOpenFolder };
}

export function selectionLayoutHtml(parts: SelectionLayoutParts, strings: SelectionLayoutStrings): string {
    const python = parts.python;
    const folder = selectionFolderButton(Boolean(parts.rootPath) || !parts.isEmpty, strings);
    const pythonButton = python
        ? '    <button class="tb-btn' + (python.warning ? ' is-warning' : '') + '" id="selection-python-environment" data-action="select-python-environment"' + hintAttr(python.tooltip) + '>' + escapeHtml(python.text) + '</button>'
        : '';
    const layoutClasses = [parts.isEmpty ? 'is-empty' : '', parts.sidebarCollapsed ? 'sidebar-collapsed' : ''].filter(Boolean).join(' ');
    return '<div id="directory-selection-layout"' + (layoutClasses ? ' class="' + layoutClasses + '"' : '') + '>'
        + '  <div id="selection-toolbar">'
        + '    <button class="tb-btn" data-action="open-file"' + hintAttr(strings.hintOpenFile) + '>' + escapeHtml(strings.btnOpenFile) + '</button>'
        + '    <button class="tb-btn" data-action="open-folder"' + hintAttr(folder.hint) + '>' + escapeHtml(folder.text) + '</button>'
        + pythonButton
        + '  </div>'
        + '  <div id="selection-body">'
        + '    <button id="selection-sidebar-rail" data-action="toggle-selection-sidebar"' + hintAttr(strings.hintExpandSidebar) + ' aria-label="' + escapeHtml(strings.hintExpandSidebar) + '"><span>›</span><span id="selection-rail-count"></span></button>'
        + '    <div id="selection-sidebar">'
        + '      ' + panelToggleHtml('sidebar', Boolean(parts.sidebarCollapsed), strings)
        // The entry table sits here (entryRuntime mounts it); maximized, the same table covers the window.
        + '      <div id="entry-dock" data-empty-hint="' + escapeHtml(strings.selectionEmptyHint) + '"></div>'
        + '    </div>'
        + '    <div class="tree-resizer" id="tree-resizer"' + hintAttr(strings.hintTreeResizer) + ' role="separator" aria-orientation="vertical"></div>'
        + '    <div id="selection-results-pane">'
        + parts.resultsPaneHtml
        + '    </div>'
        + '  </div>'
        + '</div>';
}
