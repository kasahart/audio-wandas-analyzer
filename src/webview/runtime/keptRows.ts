/**
 * Writes the entry table's rows by bringing the rows already on screen up to date instead of writing them anew
 * (#781). A row whose key (`data-key`, or `data-derived` for a fixed Δ) is still drawn keeps its <tr> and its cells:
 * a value that arrives changes the text inside its cell, nothing else. So the pointer stays over the row it was over,
 * a hovered row keeps its tools in sight, and a test that measures a cell is never handed one that was just replaced.
 *
 * Within a row the cells and what is in them are matched by position; an element whose tag differs, or whose
 * children differ in number or kind, gets the new markup's children. Attributes follow the new markup exactly, so
 * what the runtime adds after a write (is-linked, is-flash) is taken off and added again, as when rows were rewritten.
 */

/** The key a top-level row is matched by; rows without one (spacers, the unmatched list) are matched in order. */
function rowKey(node: Node): string | null {
    if (node.nodeType !== 1) return null;
    const element = node as Element;
    const key = element.getAttribute('data-key') ?? element.getAttribute('data-derived');
    return key === null ? null : `${element.hasAttribute('data-derived') ? 'derived' : 'row'}:${key}`;
}

function syncAttributes(target: Element, source: Element): void {
    for (const name of target.getAttributeNames()) if (!source.hasAttribute(name)) target.removeAttribute(name);
    for (const { name, value } of source.attributes) if (target.getAttribute(name) !== value) target.setAttribute(name, value);
}

const sameKind = (a: Node, b: Node): boolean => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

/** Brings `target` (an element already on screen) to what `source` says, keeping its descendants where they match. */
function syncNode(target: Node, source: Node): void {
    if (target.nodeType !== 1) {
        if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
        return;
    }
    syncAttributes(target as Element, source as Element);
    const next = [...source.childNodes];
    const kept = [...target.childNodes];
    if (next.length === kept.length && next.every((node, index) => sameKind(node, kept[index]))) {
        next.forEach((node, index) => syncNode(kept[index], node));
    } else {
        (target as Element).replaceChildren(...next);
    }
}

/** Writes `html` (the rows of a <tbody>) into `body`, keeping each row still drawn and its cells (see the module note). */
export function writeKeptRows(body: HTMLElement, html: string): void {
    const template = body.ownerDocument.createElement('template');
    template.innerHTML = html;
    const next = [...template.content.childNodes];
    const keyed = new Map<string, ChildNode>();
    const unkeyed: ChildNode[] = [];
    for (const node of [...body.childNodes]) {
        const key = rowKey(node);
        if (key !== null && !keyed.has(key)) keyed.set(key, node);
        else unkeyed.push(node);
    }
    next.forEach((node, index) => {
        const key = rowKey(node);
        let kept: ChildNode | undefined;
        if (key !== null) kept = keyed.get(key);
        else {
            const at = unkeyed.findIndex(old => rowKey(old) === null && sameKind(old, node));
            if (at >= 0) kept = unkeyed.splice(at, 1)[0];
        }
        if (kept && key !== null) keyed.delete(key);
        const placed = kept && sameKind(kept, node) ? (syncNode(kept, node), kept) : node;
        if (body.childNodes[index] !== placed) body.insertBefore(placed, body.childNodes[index] ?? null);
    });
    while (body.childNodes.length > next.length) body.lastChild?.remove();
}
