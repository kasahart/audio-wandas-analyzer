import type { AnalysisResultWithError, DirectoryTreeNode } from '../analysis/analysisTypes';

export class OrderedSelection {
    readonly paths: string[] = [];
    private readonly members = new Set<string>();

    has(path: string): boolean { return this.members.has(path); }
    add(path: string): void {
        if (this.members.has(path)) return;
        this.paths.push(path); this.members.add(path);
    }
    remove(path: string): void {
        const index = this.paths.indexOf(path);
        if (index !== -1) this.paths.splice(index, 1);
        this.members.delete(path);
    }
    clear(): void { this.paths.length = 0; this.members.clear(); }
}

export interface SelectedAudioFilePathDelta {
    addedFilePaths: string[];
    removedFilePaths: string[];
}

export function collectAudioFilePaths(tree: DirectoryTreeNode[]): string[] {
    const filePaths: string[] = [];

    for (const node of tree) {
        if (node.type === 'file' && node.filePath) {
            filePaths.push(node.filePath);
            continue;
        }

        if (node.type === 'directory' && node.children) {
            filePaths.push(...collectAudioFilePaths(node.children));
        }
    }

    return filePaths;
}

export function sanitizeSelectedAudioFilePaths(tree: DirectoryTreeNode[], selectedFilePaths: string[]): string[] {
    const allowed = new Set(collectAudioFilePaths(tree));
    const selection = new OrderedSelection();

    for (const filePath of selectedFilePaths) {
        if (!allowed.has(filePath) || selection.has(filePath)) {
            continue;
        }
        selection.add(filePath);
    }

    return selection.paths;
}

export function diffSelectedAudioFilePaths(
    previousSelectedFilePaths: string[],
    nextSelectedFilePaths: string[],
): SelectedAudioFilePathDelta {
    const previous = new Set(previousSelectedFilePaths);
    const next = new Set(nextSelectedFilePaths);

    return {
        addedFilePaths: nextSelectedFilePaths.filter((filePath) => !previous.has(filePath)),
        removedFilePaths: previousSelectedFilePaths.filter((filePath) => !next.has(filePath)),
    };
}

export function collectSelectedResults(
    selectedFilePaths: string[],
    cachedResultsByFilePath: Map<string, AnalysisResultWithError>,
): AnalysisResultWithError[] {
    return selectedFilePaths.flatMap((filePath) => {
        const result = cachedResultsByFilePath.get(filePath);
        return result ? [result] : [];
    });
}
