/**
 * The entry table's slots 0–3 as row keys (a file, or file#chN for one channel of it): slot 0 is the base (null:
 * a group's median), slots 1–3 the rows compared. A file's role is read compared slots first, then the base.
 */
import { fileOfKey, rowKey } from '../../shared/dataset/datasetTable';

export type Slots = (string | null)[];

export const SLOT_COUNT = 4;
export const ROLE_ORDER = [1, 2, 3, 0] as const;

export const emptySlots = (): Slots => Array.from({ length: SLOT_COUNT }, () => null);

export const slotFiles = (slots: readonly (string | null)[]): (string | null)[] => slots.map(key => (key ? fileOfKey(key) : null));

/** Puts `key` in `slot`, out of any other; the key already there takes it out. A negative slot only takes it out. */
export function withSlot(slots: readonly (string | null)[], slot: number, key: string | null): Slots {
    const next = slots.map(item => (item === key ? null : item));
    if (slot >= 0) next[slot] = slots[slot] === key ? null : key;
    return next;
}

/** Every slot that holds a row of `filePath` emptied. */
export const withoutFile = (slots: readonly (string | null)[], filePath: string): Slots => slots.map(key => (key && fileOfKey(key) === filePath ? null : key));

/** The slots that hold a row of `filePath`, in slot order. */
export const slotsOfFile = (slots: readonly (string | null)[], filePath: string): number[] => slots.flatMap((key, slot) => (key && fileOfKey(key) === filePath ? [slot] : []));

/** The slot that gives `filePath` its role (compared slots first, then the base), if any. */
export function roleSlot(slots: readonly (string | null)[], filePath: string): number | undefined {
    return ROLE_ORDER.find(slot => { const key = slots[slot]; return !!key && fileOfKey(key) === filePath; });
}

/** The row key in the slot that gives `filePath` its role. */
export function roleKey(slots: readonly (string | null)[], filePath: string): string | undefined {
    const slot = roleSlot(slots, filePath);
    return slot === undefined ? undefined : slots[slot] ?? undefined;
}

/** The rows compared (slots 1–3, filled ones). */
export const comparedKeys = (slots: readonly (string | null)[]): string[] => slots.slice(1).filter((key): key is string => !!key);

/** The first empty compared slot, else slot 1. */
export const firstFreeCompareSlot = (slots: readonly (string | null)[]): number => [1, 2, 3].find(slot => !slots[slot]) ?? 1;

/** Slots kept from before (a saved state, a stored session): a key whose file is not listed any more is dropped. */
export function restoredSlots(saved: readonly unknown[], listed: (filePath: string) => boolean): Slots {
    return emptySlots().map((_, slot) => { const key = saved[slot]; return typeof key === 'string' && listed(fileOfKey(key)) ? key : null; });
}

/** Files back in their slots as the rows they held there (one channel of them), else as the files themselves. */
export function slotsForFiles(filePaths: readonly (string | null)[], slots: readonly (string | null)[]): Slots {
    return filePaths.map(path => (path ? slots.find(key => key && fileOfKey(key) === path) ?? path : null));
}

/**
 * The tracks a change of slots shows and takes off: a file that comes into a slot is shown, one that leaves every
 * slot is taken off (once per slot it comes into or left, as the slots say it).
 */
export function trackChanges(before: readonly (string | null)[], after: readonly (string | null)[]): { show: string[]; hide: string[] } {
    return {
        show: after.filter((path): path is string => !!path && !before.includes(path)),
        hide: before.filter((path): path is string => !!path && !after.includes(path)),
    };
}

/** A key of a file taken before its channels were known, once the file has rows by channel: its ch 1 row; else null. */
export function channelRowKey(key: string, keys: ReadonlySet<string>): string | null {
    return !keys.has(key) && fileOfKey(key) === key && keys.has(rowKey(key, 1, 2)) ? rowKey(key, 1, 2) : null;
}
