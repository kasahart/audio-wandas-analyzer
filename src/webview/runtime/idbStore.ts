/**
 * The Web host's store for a folder's scan index, session and CSV: IndexedDB, which holds what localStorage's
 * few megabytes cannot. Without IndexedDB (a private window that denies it, a test), the given fallback.
 */
export interface AsyncStore {
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
}

const DB = 'audio-wandas-analyzer', STORE = 'entry';

export function createIdbStore(factory: IDBFactory | undefined, fallback: { read(key: string): unknown; write(key: string, value: unknown): void }): AsyncStore {
    let opened: Promise<IDBDatabase | null> | undefined;
    const open = (): Promise<IDBDatabase | null> => (opened ??= new Promise(resolve => {
        if (!factory) { resolve(null); return; }
        try {
            const request = factory.open(DB, 1);
            request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch { resolve(null); }
    }));
    const run = <T>(db: IDBDatabase, mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> => new Promise(resolve => {
        try {
            const request = act(db.transaction(STORE, mode).objectStore(STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(undefined);
        } catch { resolve(undefined); }
    });
    return {
        async read(key) {
            const db = await open();
            return db ? run(db, 'readonly', store => store.get(key)) : fallback.read(key);
        },
        async write(key, value) {
            const db = await open();
            if (!db) { fallback.write(key, value); return; }
            await run<unknown>(db, 'readwrite', store => (value === undefined || value === null ? store.delete(key) : store.put(value, key)) as IDBRequest<unknown>);
        },
    };
}
