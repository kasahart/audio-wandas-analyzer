import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { eventTarget } from './domAdapter';
import type { TrackId } from './types';

export interface ColorPickerOptions {
    colors: readonly string[];
    resetLabel: string;
    onPick(trackId: TrackId, color: string | null): void;
}

export interface ColorPicker {
    open(trackId: TrackId, anchor: HTMLElement): void;
    close(): void;
    target(): TrackId | null;
}

export function installColorPicker(document: Document, options: ColorPickerOptions): ColorPicker {
    let target: TrackId | null = null;
    let anchor: HTMLElement | null = null;
    const swatches = options.colors.map(hex => '<div class="color-palette-swatch" data-color="' + escapeHtml(hex) + '"'
        + ' style="background:' + escapeHtml(hex) + '" role="button" tabindex="0"'
        + ' aria-label="' + escapeHtml(hex) + '"></div>').join('');
    const container = document.createElement('div');
    container.innerHTML = '<div id="color-picker-popover" hidden tabindex="-1"'
        + ' style="position:fixed;z-index:9999;background:var(--panel);'
        + 'border:1px solid var(--line);padding:8px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">'
        + '<div style="display:flex;flex-wrap:wrap;gap:4px;width:148px">' + swatches + '</div>'
        + '<button id="color-reset-btn" style="margin-top:6px;width:100%;font-size:11px;'
        + 'background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:2px;cursor:pointer;padding:2px 0">'
        + escapeHtml(options.resetLabel) + '</button>'
        + '</div>';
    const popover = container.firstChild as HTMLElement | null;
    if (popover) {
        document.body.appendChild(popover);
    }

    function close(): void {
        popover?.setAttribute('hidden', '');
        if (anchor && typeof anchor.focus === 'function') {
            anchor.focus();
        }
        target = null;
        anchor = null;
    }

    function pick(color: string | null): void {
        if (target === null) {
            return;
        }
        options.onPick(target, color);
        close();
    }

    popover?.addEventListener('keydown', function (e: KeyboardEvent) {
        if (e.key === 'Escape') {
            close();
            return;
        }
        if (e.key !== 'Enter' && e.key !== ' ') {
            return;
        }
        const swatch = eventTarget(e).closest ? eventTarget(e).closest<HTMLElement>('.color-palette-swatch') : null;
        if (swatch) {
            e.preventDefault();
            swatch.click();
        }
    });
    popover?.addEventListener('click', function (e: MouseEvent) {
        const swatch = eventTarget(e).closest ? eventTarget(e).closest<HTMLElement>('.color-palette-swatch') : null;
        if (swatch) {
            pick(swatch.getAttribute('data-color'));
        }
        else if (eventTarget(e).id === 'color-reset-btn') {
            pick(null);
        }
    });
    document.addEventListener('click', function (e: MouseEvent) {
        if (!popover || popover.hasAttribute('hidden')) {
            return;
        }
        const clickedTrigger = eventTarget(e).closest ? eventTarget(e).closest('[data-action="pick-color"]') : null;
        if (popover.contains(eventTarget(e)) || clickedTrigger) {
            return;
        }
        close();
    }, true);

    return {
        open(trackId, anchorEl) {
            target = trackId;
            anchor = anchorEl || null;
            if (!popover) {
                return;
            }
            const rect = anchorEl.getBoundingClientRect();
            popover.style.top = (rect.bottom + 4) + 'px';
            popover.style.left = rect.left + 'px';
            popover.removeAttribute('hidden');
            popover.focus();
        },
        close,
        target: () => target,
    };
}
