const FOCUS_OUTLINE = '1px solid rgba(100, 160, 255, 0.4)';

export interface HintFooter {
    show(text: string): void;
    clear(): void;
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
    canvas.addEventListener('blur', function () {
        footer.clear();
        canvas.style.outline = 'none';
    });
}
