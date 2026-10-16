import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { SelectionTree } from './directorySelection';
import { eventTarget, inputMatching } from './domAdapter';
import type { PersistedWebviewState, SelectionTreeNode } from './types';

/** What the directory-selection tree needs from the comparison runtime. */
export interface SelectionTreeViewDeps {
    document: Document;
    strings: Pick<UiStrings, 'ariaSelectionTreeDir' | 'selectionNoSupported'>;
    tree: SelectionTree;
    /** The directory the tree lists; persisted collapse and filter state is keyed to it. */
    rootPath: string;
    collapseState: Record<string, boolean>;
    filterQuery: string;
    isSelected(filePath: string): boolean;
    persist(patch: Partial<PersistedWebviewState>): void;
    onFileToggled(filePath: string, checked: boolean): void;
    /** Toolbar and select-all buttons in the selection layout; returns false for actions it does not own. */
    handleAction(action: string): boolean;
    syncSummary(): void;
    setFilterFlush(handler: () => void): void;
    setTimeout(handler: () => void, timeout: number): number;
    clearTimeout(timeoutId: number): void;
}

export interface SelectionTreeView {
    readonly filterQuery: string;
    renderTree(nodes: SelectionTreeNode[], isRoot: boolean, depth: number): string;
    isVisible(el: HTMLElement): boolean;
    /** Wires folder toggles, checkboxes, the filter box and the sidebar resizer inside the selection layout. */
    attach(layout: HTMLElement): void;
    /** Swaps in another directory's files and re-renders the attached tree with that directory's saved collapse and filter state. */
    replaceTree(next: Pick<SelectionTreeViewDeps, 'tree' | 'rootPath' | 'collapseState' | 'filterQuery'>): void;
}

/** The file tree of the directory-selection layout: lazy folder rendering, collapse state, filter and resizer. */
export function createSelectionTreeView(deps: SelectionTreeViewDeps): SelectionTreeView {
    const { document, strings, setTimeout, clearTimeout } = deps;
    let { tree, rootPath, collapseState, filterQuery } = deps;
    let applyAttachedFilter: ((query: string) => void) | undefined;
    function renderItems(nodes: SelectionTreeNode[], depth: number): string {
        return nodes.map(function (node: SelectionTreeNode) {
            if (node.type === 'directory') {
                // 保存済み状態があればそれを使う、なければ depth === 0 のみ展開
                var savedExpanded = collapseState[node.relativePath];
                var isExpanded = (savedExpanded !== undefined) ? savedExpanded : (depth === 0);
                // 折りたたみ時は子要素をレンダリングしない（#90 レイジーレンダリング）
                var childrenHtml: string = isExpanded ? renderItems(node.children || [], depth + 1) : '';
                var lazyAttr = isExpanded ? '' : ' data-lazy="true"';
                return '<li>'
                    + '<div class="selection-tree-directory" data-action="toggle-directory"'
                    + ' data-relative-path="' + escapeHtml(node.relativePath) + '"'
                    + ' data-depth="' + depth + '"'
                    + ' role="button" tabindex="0"'
                    + ' aria-expanded="' + (isExpanded ? 'true' : 'false') + '"'
                    + ' aria-label="' + escapeHtml(strings.ariaSelectionTreeDir) + ': ' + escapeHtml(node.name) + '">'
                    + '<span class="dir-toggle" aria-hidden="true">' + (isExpanded ? '▼' : '▶') + '</span>'
                    + '<span class="dir-name">' + escapeHtml(node.name) + '</span>'
                    + '</div>'
                    + '<ul class="selection-tree-list"' + lazyAttr + ' style="' + (isExpanded ? '' : 'display:none') + '">'
                    + childrenHtml
                    + '</ul>'
                    + '</li>';
            }
            const filePath = node.filePath || '';
            const checked = deps.isSelected(filePath) ? ' checked' : '';
            return '<li>'
                + '<label class="selection-file-row">'
                + '  <input class="selection-file-checkbox" type="checkbox" data-file-path="' + escapeHtml(filePath) + '"' + checked + '>'
                + '  <span class="selection-file-label">'
                + '    <span class="selection-file-name">' + escapeHtml(node.name) + '</span>'
                + '    <span class="selection-file-path">' + escapeHtml(node.relativePath) + '</span>'
                + '  </span>'
                + '</label>'
                + '</li>';
        }).join('');
    }
    function renderTree(nodes: SelectionTreeNode[], isRoot: boolean, depth: number): string {
        depth = depth || 0;
        if (!Array.isArray(nodes) || nodes.length === 0) {
            return '<div class="selection-path">' + escapeHtml(strings.selectionNoSupported) + '</div>';
        }
        return '<ul class="selection-tree-list' + (isRoot ? ' is-root' : '') + '">'
            + renderItems(nodes, depth)
            + '</ul>';
    }
    function isVisible(el: HTMLElement) {
        // el から #selection-tree までの祖先を辿り、display:none が設定された要素があれば非表示と判定する
        let node: HTMLElement | null = el;
        while (node && node.id !== 'selection-tree') {
            if (node.style.display === 'none') {
                return false;
            }
            node = node.parentElement;
        }
        return true;
    }
    function attach(layout: HTMLElement): void {
        function toggleDirectoryHeader(dirHeader: HTMLElement) {
            const list = dirHeader.nextElementSibling;
            const toggle = dirHeader.querySelector('.dir-toggle');
            if (list && list.classList && list.classList.contains('selection-tree-list')) {
                const listElement = list as HTMLElement;
                const isCollapsed = listElement.style.display === 'none';
                // 展開時: data-lazy な子要素を初めてレンダリングする (#90)
                if (isCollapsed && list.getAttribute('data-lazy') === 'true') {
                    const relPath = dirHeader.getAttribute('data-relative-path');
                    const depth = parseInt(dirHeader.getAttribute('data-depth') || '0', 10);
                    const node = relPath === null ? undefined : tree.directories[relPath];
                    if (node && node.children) {
                        listElement.innerHTML = renderItems(node.children, depth + 1);
                        listElement.removeAttribute('data-lazy');
                    }
                }
                listElement.style.display = isCollapsed ? '' : 'none';
                if (toggle) {
                    toggle.textContent = isCollapsed ? '▼' : '▶';
                }
                dirHeader.setAttribute('aria-expanded', isCollapsed ? 'true' : 'false');
                // 折りたたみ状態を保存し vscode.setState() で永続化する
                // (isCollapsed=true → 展開に戻った → expanded=true)
                const relativePath = dirHeader.getAttribute('data-relative-path');
                if (relativePath) {
                    collapseState[relativePath] = isCollapsed;
                    deps.persist({
                        directoryCollapseState: collapseState,
                        directoryCollapseRootPath: rootPath,
                    });
                }
            }
        }
        layout.addEventListener('click', function (e) {
            const target = eventTarget(e);
            if (!target || typeof target.getAttribute !== 'function') {
                return;
            }
            const dirHeader = target.closest<HTMLElement>('.selection-tree-directory');
            if (dirHeader) {
                toggleDirectoryHeader(dirHeader);
                return;
            }
            const action = target.getAttribute('data-action');
            if (!action) {
                return;
            }
            if (deps.handleAction(action)) {
                return;
            }
        });
        layout.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') {
                return;
            }
            const target = eventTarget(e);
            if (!target || typeof target.closest !== 'function') {
                return;
            }
            const dirHeader = target.closest<HTMLElement>('.selection-tree-directory');
            if (!dirHeader) {
                return;
            }
            e.preventDefault();
            toggleDirectoryHeader(dirHeader);
        });
        layout.addEventListener('change', function (e) {
            const target = eventTarget(e);
            if (!target || !target.classList || !target.classList.contains('selection-file-checkbox')) {
                return;
            }
            const filePath = target.getAttribute('data-file-path');
            if (!filePath) {
                return;
            }
            deps.onFileToggled(filePath, (target as HTMLInputElement).checked);
        });
        deps.syncSummary();
        // ── Tree filter ──
        const treeFilterInput = inputMatching(document, '#tree-filter-input');
        if (treeFilterInput) {
            function applyTreeFilter(query: string) {
                if (!query) {
                    // フィルタ解除: 全ファイル <li> を表示し、折りたたみ状態を復元する
                    document.querySelectorAll<HTMLElement>('#selection-tree li').forEach(function (li) {
                        li.style.display = '';
                    });
                    document.querySelectorAll<HTMLElement>('.selection-tree-directory').forEach(function (dirHeader) {
                        var relativePath = dirHeader.getAttribute('data-relative-path');
                        var list = dirHeader.nextElementSibling;
                        if (!list || !list.classList.contains('selection-tree-list')) {
                            return;
                        }
                        var savedExpanded = relativePath ? collapseState[relativePath] : undefined;
                        // 保存済み状態があればそれを、なければ depth=0 かどうかで判断（ルート直下要素は expanded）
                        // data-depth が付いていない場合はデフォルト展開
                        var expanded = (savedExpanded !== undefined) ? savedExpanded : true;
                        (list as HTMLElement).style.display = expanded ? '' : 'none';
                        var toggle = dirHeader.querySelector('.dir-toggle');
                        if (toggle) {
                            toggle.textContent = expanded ? '▼' : '▶';
                        }
                        dirHeader.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                    });
                    deps.syncSummary();
                    return;
                }
                // フィルタ適用前: レイジー未展開の子要素を全てレンダリングする (#90 との連携)
                // 1 回のループでは新たに挿入された子ノードに data-lazy が残るため、
                // lazy ノードがなくなるか進捗がなくなるまで繰り返す
                var prevLazyCount = -1;
                while (true) {
                    var lazyLists = document.querySelectorAll('#selection-tree [data-lazy="true"]');
                    if (!lazyLists.length || lazyLists.length === prevLazyCount) {
                        break;
                    }
                    prevLazyCount = lazyLists.length;
                    lazyLists.forEach(function (lazyList) {
                        var dh = lazyList.previousElementSibling;
                        if (!dh || !dh.classList.contains('selection-tree-directory')) {
                            return;
                        }
                        var relPath = dh.getAttribute('data-relative-path');
                        var depth = parseInt(dh.getAttribute('data-depth') || '0', 10);
                        var node = relPath ? tree.directories[relPath] : undefined;
                        if (node && node.children) {
                            lazyList.innerHTML = renderItems(node.children, depth + 1);
                            lazyList.removeAttribute('data-lazy');
                        }
                    });
                }
                // フィルタ適用: ファイル名・パスで一致する <li> のみ表示
                var allLis = document.querySelectorAll<HTMLElement>('#selection-tree li');
                for (var i = 0; i < allLis.length; i++) {
                    var li = allLis[i];
                    var fileRow = li.querySelector('.selection-file-row');
                    if (!fileRow) {
                        continue;
                    }
                    var checkbox = li.querySelector('.selection-file-checkbox');
                    var fp = checkbox ? (checkbox.getAttribute('data-file-path') || '') : '';
                    var nameEl = li.querySelector('.selection-file-name');
                    var nm = nameEl ? (nameEl.textContent || '') : '';
                    var match = fp.toLowerCase().indexOf(query) >= 0 || nm.toLowerCase().indexOf(query) >= 0;
                    li.style.display = match ? '' : 'none';
                    // 一致したファイルの祖先ディレクトリを全て展開する
                    if (match) {
                        var ancestor = li.parentElement;
                        while (ancestor && ancestor.id !== 'selection-tree') {
                            if (ancestor.classList && ancestor.classList.contains('selection-tree-list')) {
                                var dh = ancestor.previousElementSibling;
                                var rel = dh && dh.classList && dh.classList.contains('selection-tree-directory')
                                    ? dh.getAttribute('data-relative-path')
                                    : null;
                                var savedExpanded = rel ? collapseState[rel] : undefined;
                                var shouldExpandForFilter = savedExpanded !== false;
                                ancestor.style.display = shouldExpandForFilter ? '' : 'none';
                                if (dh && dh.classList.contains('selection-tree-directory')) {
                                    dh.setAttribute('aria-expanded', shouldExpandForFilter ? 'true' : 'false');
                                    var tog = dh.querySelector('.dir-toggle');
                                    if (tog) {
                                        tog.textContent = shouldExpandForFilter ? '▼' : '▶';
                                    }
                                }
                            }
                            ancestor = ancestor.parentElement;
                        }
                    }
                }
                // 一致ファイルを持たないディレクトリ <li> を非表示にする（葉から順に評価）
                var dirLis = document.querySelectorAll<HTMLElement>('#selection-tree li');
                for (var j = dirLis.length - 1; j >= 0; j--) {
                    var dirLi = dirLis[j];
                    var subList = dirLi.querySelector('.selection-tree-list');
                    if (!subList) {
                        continue;
                    }
                    var visCount = 0;
                    var children = subList.querySelectorAll('li');
                    for (var k = 0; k < children.length; k++) {
                        if (children[k].style.display !== 'none') {
                            visCount++;
                        }
                    }
                    dirLi.style.display = visCount > 0 ? '' : 'none';
                }
                deps.syncSummary();
            }
            applyAttachedFilter = applyTreeFilter;
            // debounce: 150ms (#92)
            var treeFilterTimer: number | null = null;
            treeFilterInput.addEventListener('input', function () {
                if (treeFilterTimer !== null) {
                    clearTimeout(treeFilterTimer);
                }
                filterQuery = treeFilterInput.value;
                deps.persist({
                    treeFilterQuery: filterQuery,
                    treeFilterRootPath: rootPath,
                });
                treeFilterTimer = setTimeout(function () {
                    applyTreeFilter(treeFilterInput.value.toLowerCase());
                }, 150);
            });
            // テスト環境からデバウンスを即時フラッシュできるようにする
            deps.setFilterFlush(function () {
                if (treeFilterTimer !== null) {
                    clearTimeout(treeFilterTimer);
                }
                treeFilterTimer = null;
                applyTreeFilter(treeFilterInput.value.toLowerCase());
            });
            if (filterQuery) {
                applyTreeFilter(filterQuery.toLowerCase());
            }
        }
        // ── Tree resizer ──
        const resizerEl = document.getElementById('tree-resizer');
        const sidebarEl = document.getElementById('selection-sidebar');
        if (resizerEl && sidebarEl) {
            var dragStartX = 0;
            var dragStartW = 0;
            var isDragging = false;
            const onResizerMouseMove = function (e: MouseEvent): void {
                if (!isDragging) {
                    return;
                }
                var delta = e.clientX - dragStartX;
                var newW = Math.max(160, Math.min(600, dragStartW + delta));
                sidebarEl.style.width = newW + 'px';
            };
            const onResizerMouseUp = function (): void {
                isDragging = false;
                resizerEl.classList.remove('is-dragging');
                document.removeEventListener('mousemove', onResizerMouseMove);
                document.removeEventListener('mouseup', onResizerMouseUp);
            };
            resizerEl.addEventListener('mousedown', function (e) {
                isDragging = true;
                dragStartX = e.clientX;
                dragStartW = sidebarEl.getBoundingClientRect().width;
                resizerEl.classList.add('is-dragging');
                document.addEventListener('mousemove', onResizerMouseMove);
                document.addEventListener('mouseup', onResizerMouseUp);
                e.preventDefault();
            });
        }
    }
    return {
        get filterQuery() { return filterQuery; },
        renderTree,
        isVisible,
        attach,
        replaceTree(next) {
            ({ tree, rootPath, collapseState, filterQuery } = next);
            const treeEl = document.getElementById('selection-tree');
            if (!treeEl) {
                return;
            }
            treeEl.innerHTML = renderTree(tree.roots, true, 0);
            const treeFilterInput = inputMatching(document, '#tree-filter-input');
            if (treeFilterInput) {
                treeFilterInput.value = filterQuery;
            }
            if (filterQuery && applyAttachedFilter) {
                applyAttachedFilter(filterQuery.toLowerCase());
            }
            else {
                deps.syncSummary();
            }
        },
    };
}
