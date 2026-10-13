import { eventTarget } from './domAdapter';
import type { RuntimeDocument, RuntimeElement } from './types';

export interface OffsetEditorLabels {
    placeholder: string;
    ariaLabel: string;
}

export function isOffsetEditorOpen(span: RuntimeElement): boolean {
    return span.style.display === 'none';
}

export function openOffsetEditor(
    doc: RuntimeDocument,
    span: RuntimeElement,
    currentMs: number,
    labels: OffsetEditorLabels,
    onCommit: (offsetMs: number | null) => void,
): void {
    if (isOffsetEditorOpen(span)) {
        return;
    }
    const input = doc.createElement('input');
    input.type = 'number';
    input.className = 'track-offset-input';
    input.value = String(currentMs);
    input.placeholder = labels.placeholder;
    input.setAttribute('aria-label', labels.ariaLabel);
    span.style.display = 'none';
    span.parentNode.insertBefore(input, span);
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
}

/** A single click waits this long so that a double-click (reset to 0) can cancel opening the editor. */
export const OFFSET_EDIT_OPEN_DELAY_MS = 200;

export interface OffsetEditingHooks {
    trackIndexFromElement(element: RuntimeElement): number | null;
    currentOffsetMs(trackIndex: number): number;
    onReset(trackIndex: number): void;
    onEdited(trackIndex: number, offsetMs: number | null): void;
}

export function attachOffsetEditing(
    wrapper: HTMLElement,
    doc: RuntimeDocument,
    labels: OffsetEditorLabels,
    hooks: OffsetEditingHooks,
): void {
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    function cancelPendingOpen(): void {
        if (openTimer !== null) {
            clearTimeout(openTimer);
        }
        openTimer = null;
    }
    wrapper.addEventListener('dblclick', function (e) {
        const target = eventTarget(e);
        if (!target.classList.contains('track-offset-val')) {
            return;
        }
        cancelPendingOpen();
        const idx = hooks.trackIndexFromElement(target);
        if (idx !== null) {
            hooks.onReset(idx);
        }
    });
    wrapper.addEventListener('click', function (e) {
        const span = eventTarget(e);
        if (!span.classList.contains('track-offset-val')) {
            return;
        }
        const idx = hooks.trackIndexFromElement(span);
        if (idx === null || isOffsetEditorOpen(span)) {
            return;
        }
        cancelPendingOpen();
        openTimer = setTimeout(function () {
            openTimer = null;
            openOffsetEditor(doc, span, hooks.currentOffsetMs(idx), labels, function (offsetMs) {
                hooks.onEdited(idx, offsetMs);
            });
        }, OFFSET_EDIT_OPEN_DELAY_MS);
    });
}
