import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { hintAttr } from './hintFooter';

export interface SelectionLayoutParts {
    rootPath: string;
    isEmpty?: boolean;
    filterQuery: string;
    treeHtml: string;
    resultsPaneHtml: string;
    python?: { text: string; tooltip: string; warning: boolean };
}

export type SelectionLayoutStrings = Pick<UiStrings,
    | 'selectionHeader' | 'btnOpenFile' | 'btnOpenFolder' | 'btnOpenAnotherFolder' | 'treeFilterPlaceholder'
    | 'btnSelectAll' | 'btnClear' | 'ariaSelectionTree'
    | 'hintOpenFile' | 'hintOpenFolder' | 'hintBrowserOpenFolder' | 'hintSelectAll' | 'hintClearAll' | 'hintTreeFilter' | 'hintTreeResizer'>;

/** Without a listed folder there is no "another" folder to open. */
export function selectionFolderButton(rootPath: string, strings: SelectionLayoutStrings): { text: string; hint: string } {
    return rootPath
        ? { text: strings.btnOpenAnotherFolder, hint: strings.hintOpenFolder }
        : { text: strings.btnOpenFolder, hint: strings.hintBrowserOpenFolder };
}

export function selectionLayoutHtml(parts: SelectionLayoutParts, strings: SelectionLayoutStrings): string {
    const python = parts.python;
    const folder = selectionFolderButton(parts.rootPath, strings);
    const pythonButton = python
        ? '    <button class="tb-btn' + (python.warning ? ' is-warning' : '') + '" id="selection-python-environment" data-action="select-python-environment"' + hintAttr(python.tooltip) + '>' + escapeHtml(python.text) + '</button>'
        : '';
    return '<div id="directory-selection-layout"' + (parts.isEmpty ? ' class="is-empty"' : '') + '>'
        + '  <div id="selection-toolbar">'
        + '    <span style="font-weight:700;font-size:12px;color:var(--accent)">' + escapeHtml(strings.selectionHeader) + '</span>'
        + '    <div class="tb-sep"></div>'
        + '    <button class="tb-btn" data-action="open-file"' + hintAttr(strings.hintOpenFile) + '>' + escapeHtml(strings.btnOpenFile) + '</button>'
        + '    <button class="tb-btn" data-action="open-folder"' + hintAttr(folder.hint) + '>' + escapeHtml(folder.text) + '</button>'
        + pythonButton
        + '  </div>'
        + '  <div id="selection-body">'
        + '    <div id="selection-sidebar">'
        + '      <div id="selection-summary">'
        + '        <div class="selection-count" id="selection-count"></div>'
        + '        <div class="selection-path">' + escapeHtml(parts.rootPath) + '</div>'
        + '      </div>'
        + '      <div id="tree-filter-wrap">'
        + '        <input id="tree-filter-input" type="text" value="' + escapeHtml(parts.filterQuery) + '" placeholder="' + escapeHtml(strings.treeFilterPlaceholder || 'Filter files...') + '"' + hintAttr(strings.hintTreeFilter) + ' autocomplete="off" spellcheck="false">'
        + '      </div>'
        + '      <div id="selection-actions">'
        + '        <button class="tb-btn" data-action="selection-select-all"' + hintAttr(strings.hintSelectAll) + '>' + escapeHtml(strings.btnSelectAll) + '</button>'
        + '        <button class="tb-btn" data-action="selection-clear-all"' + hintAttr(strings.hintClearAll) + '>' + escapeHtml(strings.btnClear) + '</button>'
        + '      </div>'
        + '      <div id="selection-tree" role="group" aria-label="' + escapeHtml(strings.ariaSelectionTree) + '">' + parts.treeHtml + '</div>'
        + '    </div>'
        + '    <div class="tree-resizer" id="tree-resizer"' + hintAttr(strings.hintTreeResizer) + ' role="separator" aria-orientation="vertical"></div>'
        + '    <div id="selection-results-pane">'
        + parts.resultsPaneHtml
        + '    </div>'
        + '  </div>'
        + '</div>';
}
