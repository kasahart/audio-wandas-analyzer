import type { UiStrings } from '../../shared/i18n/strings';
import type { BrowserLimits } from '../../shared/protocol/generated/backendProtocolSchema';
import { userErrorText } from '../../shared/protocol/backendProtocol';
import { isSupportedAudioFile } from '../../shared/utils/audioTarget';

/** A file found under a picked or dropped folder, by its path from that folder's name. */
export interface FoundFile { path: string; file: File }
/** A file to load as a track under `/sources/<sourceId>`. */
export interface SourceToLoad { file: File; sourceId: string }

/** The parts of a File System Access handle the folder picker walks. */
export type FolderEntryHandle =
    | { kind: 'file'; name: string; getFile(): Promise<File> }
    | { kind: 'directory'; name: string; values(): AsyncIterable<FolderEntryHandle> };
export type ShowDirectoryPicker = (options: { mode: 'read' }) => Promise<FolderEntryHandle & { kind: 'directory' }>;

export async function collectSourceFiles(directory: FolderEntryHandle & { kind: 'directory' }, prefix: string, found: FoundFile[]): Promise<void> {
    for await (const entry of directory.values()) {
        const path = `${prefix}/${entry.name}`;
        if (entry.kind === 'directory') await collectSourceFiles(entry, path, found);
        else if (isSupportedAudioFile(entry.name)) found.push({ path, file: await entry.getFile() });
    }
}

const readEntryBatch = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => new Promise((resolve, reject) => reader.readEntries(resolve, reject));

/** A dropped folder arrives as an entry whose reader returns its children in batches until an empty one. */
export async function collectDroppedSourceFiles(directory: FileSystemDirectoryEntry, prefix: string, found: FoundFile[]): Promise<void> {
    const reader = directory.createReader();
    for (let batch = await readEntryBatch(reader); batch.length; batch = await readEntryBatch(reader)) {
        for (const entry of batch) {
            const path = `${prefix}/${entry.name}`;
            if (entry.isDirectory) await collectDroppedSourceFiles(entry as FileSystemDirectoryEntry, path, found);
            else if (isSupportedAudioFile(entry.name)) found.push({ path, file: await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)) });
        }
    }
}

export const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const sameFile = (a: File, b: File): boolean => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/**
 * Lists individually opened files at the top of `/sources`. Picking an unchecked top-level file again (`isIdle`)
 * reuses its entry; a file from an opened folder, or one already loaded, gets its own entry with a free name.
 */
export function listOpenedFiles(folder: Map<string, File>, files: File[], isIdle: (path: string) => boolean): SourceToLoad[] {
    const listed = Array.from(folder);
    const reused = new Set<string>();
    return files.map(file => {
        const same = listed.find(([path, entry]) => path.split('/').length === 3 && isIdle(path) && !reused.has(path) && sameFile(entry, file));
        if (same) { reused.add(same[0]); return { file, sourceId: same[0].slice('/sources/'.length) }; }
        const extension = file.name.slice(file.name.lastIndexOf('.'));
        const stem = file.name.slice(0, -extension.length).replace(/[\\/\u0000-\u001f]/g, '_');
        let sourceId = `${stem}${extension}`;
        for (let n = 2; folder.has(`/sources/${sourceId}`); n++) sourceId = `${stem} (${n})${extension}`;
        folder.set(`/sources/${sourceId}`, file);
        return { file, sourceId };
    });
}

/**
 * Lists an opened folder under `/sources/<its name>`, beside what is listed. Opening a listed folder again keeps
 * its entries and returns false; a different folder with a taken name gets a numbered suffix.
 */
export function listOpenedFolder(folder: Map<string, File>, rootName: string, files: FoundFile[]): boolean {
    const inFolder = files.map(({ path, file }) => ({ rest: path.slice(rootName.length), file }));
    const listedUnder = (name: string): string[] => Array.from(folder.keys()).filter(path => path === `/sources/${name}` || path.startsWith(`/sources/${name}/`));
    let name = rootName;
    for (let n = 2; listedUnder(name).length; n++) {
        const same = listedUnder(name).length === inFolder.length && inFolder.every(({ rest, file }) => {
            const entry = folder.get(`/sources/${name}${rest}`);
            return entry !== undefined && sameFile(entry, file);
        });
        if (same) return false;
        name = `${rootName} (${n})`;
    }
    inFolder.forEach(({ rest, file }) => folder.set(`/sources/${name}${rest}`, file));
    return true;
}

/** A list that holds one folder and nothing else is shown under that folder's name; any other list is shown from /sources. */
export function listingRoot(paths: string[]): { rootPath: string; rootLabel: string } {
    const roots = new Set(paths.map(path => path.split('/')[2]));
    const [first] = roots;
    const only = roots.size === 1 && first !== undefined && paths.every(path => path.split('/').length > 3) ? first : '';
    return { rootPath: only ? `/sources/${only}` : '/sources', rootLabel: only };
}

const mib = (bytes: number): string => String(bytes / (1024 * 1024));

/** Why a file of `size` bytes cannot be loaded or scanned at all, or undefined. */
export function inputTooLarge(size: number, limits: BrowserLimits, strings: UiStrings): string | undefined {
    return size > limits.maxInputBytes ? strings.browserInputTooLarge.replace('{mib}', mib(limits.maxInputBytes)) : undefined;
}

/** Why a file cannot join the loaded tracks (their count and total input), or undefined. */
export function sessionFull(size: number, loadedBytes: number[], limits: BrowserLimits, strings: UiStrings): string | undefined {
    return loadedBytes.length >= limits.maxSources || loadedBytes.reduce((sum, bytes) => sum + bytes, size) > limits.maxTotalInputBytes
        ? strings.browserAggregateLimit.replace('{count}', String(limits.maxSources)).replace('{mib}', mib(limits.maxTotalInputBytes))
        : undefined;
}

/** Failures of one load batch; files that fail for the same reason (the session limit, for many at once) are told once, with their count. */
export class LoadFailures {
    private readonly byMessage = new Map<string, { first: string; error: unknown; count: number }>();

    add(fileName: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        const group = this.byMessage.get(message);
        if (group) group.count++; else this.byMessage.set(message, { first: fileName, error, count: 1 });
    }

    /** What the status line says once the batch ends: the failures, else the last file and the track count. */
    announcement(strings: UiStrings, lastFileName: string, trackCount: number): string {
        if (!this.byMessage.size) return `${lastFileName}: ${strings.browserReady.replace('{count}', String(trackCount))}`;
        return [...this.byMessage.values()].map(({ first, error, count }) => strings.browserFileFailed
            .replace('{file}', `${first}${count > 1 ? ` (+${count - 1})` : ''}`).replace('{error}', () => userErrorText(error, strings))).join(' | ');
    }
}

/**
 * A picked folder is known by its name only (/sources/<name>): its stored index and session are also keyed by
 * how many files it has and the first few files' content hashes, so another folder of the same name has its own.
 */
export interface FolderKeys {
    /** Keys that belong to one folder's index, session or CSV (kept in IndexedDB, as they outgrow localStorage). */
    isFolderKey(key: string): boolean;
    tagged(key: string): Promise<string>;
    /**
     * A picked file as the browser knows it without reading it: its name, size and time. Reading every file's
     * content at open (to hash it) would read a folder of 10-minute recordings in full before showing a row.
     */
    identity(path: string): string | undefined;
}

const FOLDER_KEY = /^awa\.(scanIndex|session|sessionCsv)\./;

/** FNV-1a, 32 bits, as hex: a short tag, not a security hash. */
function shortHash(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, '0');
}

export function createFolderKeys(folder: ReadonlyMap<string, File>): FolderKeys {
    const folderTags = new Map<string, Promise<string>>();
    function identity(path: string): string | undefined {
        const file = folder.get(path);
        return file ? `${file.name}|${file.size}|${(file as File & { lastModified?: number }).lastModified ?? ''}` : undefined;
    }
    return {
        isFolderKey: key => FOLDER_KEY.test(key),
        identity,
        tagged(key) {
            const root = key.slice(key.indexOf(':') + 1);
            const paths = [...folder.keys()].filter(path => !root || path.startsWith(`${root}/`)).sort();
            const listing = `${root}|${paths.length}|${paths.slice(0, 3).join('|')}`;
            let tag = folderTags.get(listing);
            if (!tag) {
                tag = Promise.resolve(`${paths.length}:${shortHash(paths.slice(0, 3).map(path => identity(path) ?? '-').join('/'))}`);
                folderTags.set(listing, tag);
            }
            return tag.then(value => `${key}#${value}`);
        },
    };
}
