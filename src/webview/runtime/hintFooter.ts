import { escapeHtml } from '../../shared/utils/webviewEscaping';

const FOCUS_OUTLINE = '1px solid rgba(100, 160, 255, 0.4)';

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
        canvas.style.outline = FOCUS_OUTLINE;
    });
    // A click elsewhere blurs the canvas after the new target's hint is already showing.
    canvas.addEventListener('blur', function () {
        footer.clearIfShowing(text);
        canvas.style.outline = 'none';
    });
}
