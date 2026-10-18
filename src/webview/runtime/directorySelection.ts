import type { SelectionTreeNode } from './types';

export interface SelectionTree {
    roots: SelectionTreeNode[];
    directories: Record<string, SelectionTreeNode>;
}

/** The path of a listed file or folder below the tree's root, with `/` separators; a path outside the root is kept whole. */
export function selectionRelativePath(rootPath: string, path: string): string {
    const normalizedRoot = rootPath ? rootPath.replace(/\\/gu, '/') : '';
    const rootPrefix = normalizedRoot && !normalizedRoot.endsWith('/')
        ? `${normalizedRoot}/`
        : normalizedRoot;
    const normalizedPath = path.replace(/\\/gu, '/');
    return rootPrefix && normalizedPath.startsWith(rootPrefix)
        ? normalizedPath.slice(rootPrefix.length)
        : normalizedPath;
}

export function buildSelectionTree(rootPath: string, allFilePaths: readonly string[]): SelectionTree {
    const directories: Record<string, SelectionTreeNode> = {};
    const roots: SelectionTreeNode[] = [];

    function ensureDirectory(parts: string[]): SelectionTreeNode {
        const key = parts.join('/');
        const existing = directories[key];
        if (existing) { return existing; }
        const node: SelectionTreeNode = {
            type: 'directory',
            name: parts.at(-1) ?? '',
            relativePath: key,
            children: [],
        };
        directories[key] = node;
        if (parts.length === 1) {
            roots.push(node);
        } else {
            ensureDirectory(parts.slice(0, -1)).children?.push(node);
        }
        return node;
    }

    for (const filePath of allFilePaths) {
        const relativePath = selectionRelativePath(rootPath, filePath);
        const parts = relativePath.split('/');
        const fileNode: SelectionTreeNode = {
            type: 'file',
            name: parts.at(-1) ?? '',
            filePath,
            relativePath,
        };
        if (parts.length === 1) {
            roots.push(fileNode);
        } else {
            ensureDirectory(parts.slice(0, -1)).children?.push(fileNode);
        }
    }

    return { roots, directories };
}
