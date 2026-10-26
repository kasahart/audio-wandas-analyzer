/**
 * "?" / F1 on the entry table and the comparison: the keys of the screen on show and what its symbols and
 * colours mean, over the screen until ?, F1, Esc or a click outside closes it. Nothing of it is on
 * screen otherwise, so the screens keep to their few words.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';

export type ScreenHelpStrings = Pick<UiStrings, 'screenHelpTitle' | 'screenHelpEntry' | 'screenHelpCompare' | 'screenHelpSymbols' | 'helpClose'>;

export interface ScreenHelp {
    open(screen: 'entry' | 'compare'): void;
    close(): boolean;
    isOpen(): boolean;
}

function rows(list: string): string {
    return list.split('\n').map(line => {
        const [key, meaning] = line.split('\t');
        return `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(meaning ?? '')}</td></tr>`;
    }).join('');
}

/**
 * Installs the overlay. Its key listener is registered on the window's capture phase before the
 * screens' own, so while it is open no key reaches them; `active` says which screen is on show.
 */
export function installScreenHelp(
    document: Document, window: Pick<Window, 'addEventListener'>, strings: ScreenHelpStrings, active: () => 'entry' | 'compare' | null,
): ScreenHelp {
    const overlay = document.createElement('div');
    overlay.className = 'screen-help';
    overlay.setAttribute('data-screen-help', '');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', strings.screenHelpTitle);
    overlay.hidden = true;
    document.body.append(overlay);
    let returnFocus: HTMLElement | null = null;

    function open(screen: 'entry' | 'compare'): void {
        returnFocus = document.activeElement as HTMLElement | null;
        overlay.innerHTML = `<div class="screen-help-box">
            <div class="screen-help-head"><strong>${escapeHtml(strings.screenHelpTitle)}</strong><button type="button" data-action="screen-help-close">${escapeHtml(strings.helpClose)}</button></div>
            <div class="screen-help-tables">
                <table data-screen-help-keys>${rows(screen === 'entry' ? strings.screenHelpEntry : strings.screenHelpCompare)}</table>
                <table data-screen-help-symbols>${rows(strings.screenHelpSymbols)}</table>
            </div>
        </div>`;
        overlay.hidden = false;
        overlay.querySelector<HTMLElement>('[data-action="screen-help-close"]')?.focus();
    }
    function close(): boolean {
        if (overlay.hidden) return false;
        overlay.hidden = true;
        returnFocus?.focus?.();
        return true;
    }
    overlay.addEventListener('click', event => {
        if (event.target === overlay || (event.target as HTMLElement).closest('[data-action="screen-help-close"]')) close();
    });
    window.addEventListener('keydown', (event: KeyboardEvent) => {
        const isToggle = event.key === '?' || event.key === 'F1';
        if (!overlay.hidden) {
            // The overlay is modal: it takes every key, and ?, F1 and Esc close it.
            if (event.key === 'Tab') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (isToggle || event.key === 'Escape') close();
            return;
        }
        const screen = active();
        if (!screen || !isToggle) return;
        const target = event.target as HTMLElement | null;
        // "?" typed into a field is a character; F1 always opens.
        if (event.key === '?' && target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        open(screen);
    }, true);
    return { open, close, isOpen: () => !overlay.hidden };
}
