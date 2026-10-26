/**
 * A folder's recordings as tables name them: CSV/TSV files are the user's attribute table (picked, not
 * looked for), a recording is named by its path below the opened folder, and its subfolders can serve as
 * conditions. The table itself is read by asd-insight's rules in dataset/asdData.ts.
 */
import type { EntryConditionTable } from './entryScan';

export const METADATA_EXTENSIONS = ['.csv', '.tsv'] as const;

export function baseName(filePath: string): string {
    return filePath.slice(filePath.replace(/\\/g, '/').lastIndexOf('/') + 1);
}

export function isMetadataCandidate(filePath: string): boolean {
    const name = baseName(filePath).toLowerCase();
    return METADATA_EXTENSIONS.some(extension => name.endsWith(extension));
}

/** asd-insight normalizedAudioPath: `/` separators, no leading `./`. */
export function normalizedAudioPath(value: string): string {
    return value.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

/** The recording's path below the opened folder, as tables name it (asd-insight audioFileKey). */
export function audioKey(filePath: string, rootPath: string): string {
    const path = filePath.replaceAll('\\', '/');
    const root = rootPath.replaceAll('\\', '/').replace(/\/+$/, '');
    return root && path.startsWith(root + '/') ? path.slice(root.length + 1) : baseName(path);
}

/**
 * Subfolders as condition columns (asd-insight withFolderAttributes): level n holds each recording's
 * n-th folder below the opened one. When the table has no columns of its own, they decide the
 * condition by default.
 */
export function withFolderColumns(
    table: EntryConditionTable | null,
    recordings: readonly string[],
    rootPath: string,
    label: (level: number) => string,
): EntryConditionTable | null {
    const folders = new Map(recordings.map(filePath => [filePath, audioKey(filePath, rootPath).split('/').slice(0, -1)]));
    const levels = Math.max(0, ...[...folders.values()].map(parts => parts.length));
    if (!levels) return table;
    const base = table ?? { columns: [], checked: [], rows: {}, order: [] };
    const width = base.columns.length;
    const added = Array.from({ length: levels }, (_, index) => label(index + 1));
    const rows: Record<string, string[]> = {};
    for (const filePath of recordings) {
        rows[filePath] = [...(base.rows[filePath] ?? Array(width).fill('')), ...added.map((_, level) => folders.get(filePath)![level] ?? '')];
    }
    return {
        ...base,
        columns: [...base.columns, ...added],
        rows,
        numeric: [...(base.numeric ?? base.columns.map(() => false)), ...added.map(() => false)],
        checked: width ? base.checked : added.map((_, level) => width + level).slice(0, 2),
    };
}
