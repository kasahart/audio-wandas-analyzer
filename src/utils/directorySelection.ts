import type { AnalysisResultWithError, DirectoryTreeNode } from '../panels/analysisTypes';

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
    const uniqueSelected: string[] = [];

    for (const filePath of selectedFilePaths) {
        if (!allowed.has(filePath) || uniqueSelected.includes(filePath)) {
            continue;
        }
        uniqueSelected.push(filePath);
    }

    return uniqueSelected;
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