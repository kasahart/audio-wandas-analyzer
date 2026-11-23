/**
 * What the entry screen's distribution of a table column takes of the table: the groups' order and their names as
 * shown. (The distribution itself is the figure service's: python-backend/figures/. Nothing is counted here.)
 * Pure, so it is unit-tested.
 */

/** Group names in order: numbers by value (900 before 1500), then the rest as text, the blank last. */
export function compareGroupNames(a: string, b: string): number {
    if (!a || !b) return a === b ? 0 : a ? -1 : 1;
    const x = Number(a), y = Number(b);
    const numeric = (text: string, number: number): boolean => text.trim() !== '' && Number.isFinite(number);
    if (numeric(a, x) && numeric(b, y)) return x - y;
    if (numeric(a, x) !== numeric(b, y)) return numeric(a, x) ? -1 : 1;
    return a.localeCompare(b, undefined, { numeric: true });
}

/**
 * Group names as shown: when they all share a long start or end (LOT-2026-13-東工場-…), the part that differs,
 * with … where the shared part was.
 */
export function groupLabels(names: readonly string[]): Map<string, string> {
    const labels = new Map(names.map(name => [name, name]));
    if (names.length < 2) return labels;
    const shortest = names.reduce((least, name) => Math.min(least, name.length), Infinity);
    let head = 0, tail = 0;
    while (head < shortest && names.every(name => name[head] === names[0][head])) head++;
    while (tail < shortest - head && names.every(name => name[name.length - 1 - tail] === names[0][names[0].length - 1 - tail])) tail++;
    if (head + tail < 6) return labels;
    for (const name of names) labels.set(name, `${head ? '…' : ''}${name.slice(head, name.length - tail)}${tail ? '…' : ''}`);
    return labels;
}

