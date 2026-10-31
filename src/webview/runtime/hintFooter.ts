import { escapeHtml } from '../../shared/utils/webviewEscaping';

export interface HintFooter {
    show(text: string): void;
    clear(): void;
    clearIfShowing(text: string): void;
}

// The footer is pointer-only and aria-hidden, so the hint doubles as the accessible description that title used to provide.
export function hintAttr(text: string): string {
    const value = escapeHtml(text);
    return ' data-hint="' + value + '" aria-description="' + value + '"';
}

// The entry table and the comparison also show it at the pointer (title): their footer line is easy to miss, and
// nothing there sits under the pointer for long the way the waveform does.
export function titledHintAttr(text: string): string {
    return hintAttr(text) + ' title="' + escapeHtml(text) + '"';
}

// For a wrapper such as a <label> whose focusable control carries hintAttr, so the description is not announced twice.
export function hoverHintAttr(text: string): string {
    return ' data-hint="' + escapeHtml(text) + '"';
}

export function setHint(el: Pick<Element, 'setAttribute'>, text: string): void {
    el.setAttribute('data-hint', text);
    el.setAttribute('aria-description', text);
}

// Hints go to a footer instead of native title tooltips, which cover the waveform next to the pointer.
export function createHintFooter(doc: Document): HintFooter {
    function setText(text: string): void {
        const el = doc.getElementById('hint-footer');
        if (el) {
            el.textContent = text;
        }
    }
    return {
        show: setText,
        clear() {
            setText('');
        },
        clearIfShowing(text) {
            const el = doc.getElementById('hint-footer');
            if (el && el.textContent === text) {
                el.textContent = '';
            }
        },
    };
}

export function attachHoverHints(doc: Document, footer: HintFooter): void {
    doc.addEventListener('mouseover', function (e) {
        const node = e.target as Element | null;
        const target = node && typeof node.closest === 'function' ? node.closest<HTMLElement>('[data-hint]') : null;
        if (target && target.dataset.hint) {
            footer.show(target.dataset.hint);
        }
        else {
            footer.clear();
        }
    });
    doc.addEventListener('mouseout', function (e) {
        if (!e.relatedTarget) {
            footer.clear();
        }
    });
}

export function attachCanvasFocusHint(canvas: HTMLElement, footer: HintFooter, text: string): void {
    canvas.addEventListener('focus', function () {
        footer.show(text);
    });
    // A click elsewhere blurs the canvas after the new target's hint is already showing.
    canvas.addEventListener('blur', function () {
        footer.clearIfShowing(text);
    });
}

export type TaskStatusState = 'busy' | 'done' | 'failed';

/**
 * A long task's state at the footer's right end ("Exporting PNG…", then done or failed), which hover hints do not
 * overwrite. A finished state fades after a few seconds. The footer is aria-hidden, so a finished or failed state also
 * goes to `announce` (the page's live region); the start is announced by the caller.
 */
export function createTaskStatus(doc: Document, win: Pick<Window, 'setTimeout' | 'clearTimeout'>, announce?: (text: string) => void): (text: string, state: TaskStatusState) => void {
    let timer: number | undefined;
    return function (text, state) {
        const el = doc.getElementById('task-status');
        if (!el) return;
        if (timer !== undefined) win.clearTimeout(timer);
        timer = undefined;
        el.textContent = text;
        el.dataset.state = state;
        el.hidden = false;
        if (state !== 'busy' && announce) announce(text);
        if (state !== 'busy') timer = win.setTimeout(function () { el.hidden = true; timer = undefined; }, state === 'failed' ? 8000 : 4000);
    };
}
