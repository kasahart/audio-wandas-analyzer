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
