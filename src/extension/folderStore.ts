/**
 * The entry table's large stored values (a folder's scan index, its session and CSV) as JSON files in the
 * extension's workspace storage, not in VS Code's state database and never in the user's folder. One file per
 * key, written whole through a temporary file and a rename, one write at a time per key; reads are cached.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface KeyValueStore {
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
}

export function createFolderStore(directory: string): KeyValueStore {
    const cache = new Map<string, unknown>();
    const writing = new Map<string, Promise<void>>();
    const fileOf = (key: string): string => path.join(directory, `${createHash('sha1').update(key).digest('hex')}.json`);
    return {
        async read(key) {
            if (cache.has(key)) return cache.get(key);
            await writing.get(key);
            let value: unknown;
            try { value = JSON.parse(await fs.readFile(fileOf(key), 'utf8')); } catch { value = undefined; }
            cache.set(key, value);
            return value;
        },
        async write(key, value) {
            cache.set(key, value);
            const previous = writing.get(key) ?? Promise.resolve();
            const next = previous.then(async () => {
                await fs.mkdir(directory, { recursive: true });
                const file = fileOf(key), temporary = `${file}.${process.pid}.tmp`;
                if (value === undefined || value === null) { await fs.rm(file, { force: true }); return; }
                await fs.writeFile(temporary, JSON.stringify(value));
                await fs.rename(temporary, file);
            }).catch(() => { /* A write that fails leaves the previous file; the table keeps working from memory. */ });
            writing.set(key, next);
            await next;
        },
    };
}

/** Keys kept as files: a folder's scan index, its session and its CSV (they grow with the folder). */
export const isFolderKey = (key: string): boolean => /^awa\.(scanIndex|session|sessionCsv)\./.test(key);
