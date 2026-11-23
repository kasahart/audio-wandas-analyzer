import { eventTarget } from './domAdapter';

export interface OffsetEditorLabels {
    placeholder: string;
    ariaLabel: string;
}

export function isOffsetEditorOpen(span: HTMLElement): boolean {
    return span.style.display === 'none';
}

export function openOffsetEditor(
    doc: Document,
    span: HTMLElement,
    currentMs: number,
    labels: OffsetEditorLabels,
    onCommit: (offsetMs: number | null) => void,
): () => void {
    if (isOffsetEditorOpen(span)) {
        return () => undefined;
    }
    const input = doc.createElement('input');
    input.type = 'number';
    input.className = 'track-offset-input';
    input.value = String(currentMs);
    input.placeholder = labels.placeholder;
    input.setAttribute('aria-label', labels.ariaLabel);
    span.style.display = 'none';
    span.before(input);
    input.focus();
    input.select();
    let settled = false;
    function close(): boolean {
        if (settled) {
            return false;
        }
        settled = true;
        if (input.parentNode) {
            input.parentNode.removeChild(input);
        }
        span.style.display = '';
        return true;
    }
    function commitEdit() {
        const val = parseFloat(input.value);
        if (close()) {
            onCommit(isNaN(val) ? null : val);
        }
    }
    input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
            ev.preventDefault();
            commitEdit();
        }
        else if (ev.key === 'Escape') {
            ev.preventDefault();
            close();
        }
    });
    input.addEventListener('blur', commitEdit);
    /** Closes the editor without committing, as Escape does. */
    return () => { close(); };
}

export interface OffsetEditingHooks {
    trackIndexFromElement(element: HTMLElement): number | null;
    currentOffsetMs(trackIndex: number): number;
    onReset(trackIndex: number): void;
    onEdited(trackIndex: number, offsetMs: number | null): void;
}

/**
 * A lane's offset label follows the plots' click rule (docs/display-rules.md R13, "クリックはすぐに動きます"): a click
 * opens the editor at once, and the second press of a double click takes that opening back (the editor closes and
 * nothing it would have changed is committed) and resets the offset to 0. The browser decides what a double click is
 * (the press's `detail` 2, at whatever interval the OS sets); no timer of ours waits to tell a click from one, so a
 * slow double click resets as a quick one does.
 */
export function attachOffsetEditing(
    wrapper: HTMLElement,
    doc: Document,
    labels: OffsetEditorLabels,
    hooks: OffsetEditingHooks,
): void {
    /** The editor the last click opened, while its double click's second press may still take it back. */
    let opened: { trackIndex: number; takeBack(): void } | null = null;
    // Taken on the way down (capture), before the lanes see the press and before it moves the focus (which would
    // commit the editor on blur): the second press lands on the editor, or beside it, not on the label it hid.
    wrapper.addEventListener('mousedown', function (e) {
        const first = opened;
        opened = null;
        if (!first || e.detail < 2) {
            return;
        }
        e.preventDefault();
        first.takeBack();
        hooks.onReset(first.trackIndex);
    }, true);
    wrapper.addEventListener('click', function (e) {
        const span = eventTarget(e);
        // The second click of a double click is no click: its press already took the first one back.
        if (!span.classList.contains('track-offset-val') || e.detail > 1) {
            return;
        }
        const idx = hooks.trackIndexFromElement(span);
        if (idx === null || isOffsetEditorOpen(span)) {
            return;
        }
        let settled = false;
        const close = openOffsetEditor(doc, span, hooks.currentOffsetMs(idx), labels, function (offsetMs) {
            settled = true;
            if (opened?.trackIndex === idx) opened = null;
            hooks.onEdited(idx, offsetMs);
        });
        opened = { trackIndex: idx, takeBack: () => { if (!settled) close(); } };
    });
}
