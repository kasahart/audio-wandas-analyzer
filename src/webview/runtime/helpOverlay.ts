/**
 * "?" / F1: the keys of every view, the one on show first, and what the screens' symbols and colours mean.
 * It is modal: while it is open it takes every key (Tab moves within it), and ?, F1, Esc or a click outside closes it.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { eventTarget } from './domAdapter';
import { isTextEntryTarget, keyRouterFor } from './keyRouter';
import { HELP_SECTIONS, type HelpView, type KeyRow } from './shortcuts';

export interface Help {
    open(view: HelpView): void;
    close(): boolean;
    isOpen(): boolean;
}

function keyRows(rows: readonly KeyRow[], strings: UiStrings): string {
    return rows.map(row => `<tr><th scope="row">${escapeHtml(row.shortcutKey ? strings[row.shortcutKey] : row.shortcut)}</th><td>${escapeHtml(strings[row.labelKey])}</td></tr>`).join('');
}

function symbolRows(list: string): string {
    return list.split('\n').map(line => {
        const [symbol, meaning] = line.split('\t');
        return `<tr><th scope="row">${escapeHtml(symbol)}</th><td>${escapeHtml(meaning ?? '')}</td></tr>`;
    }).join('');
}

/** `view` says which view is on show when ? or F1 is pressed. */
export function installHelpOverlay(document: Document, window: Pick<Window, 'addEventListener'>, strings: UiStrings, view: () => HelpView): Help {
    const overlay = document.createElement('div');
    overlay.id = 'help-overlay';
    overlay.className = 'screen-help';
    overlay.setAttribute('data-screen-help', '');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', strings.screenHelpTitle);
    overlay.hidden = true;
    document.body.append(overlay);
    let returnFocus: HTMLElement | null = null;

    function open(current: HelpView): void {
        returnFocus = document.activeElement as HTMLElement | null;
        const sections = [...HELP_SECTIONS].sort((a, b) => Number(b.view === current) - Number(a.view === current));
        overlay.innerHTML = `<div class="screen-help-box">
            <div class="screen-help-head"><strong>${escapeHtml(strings.screenHelpTitle)}</strong><button type="button" id="help-close-btn" class="tb-btn" data-action="help-close">${escapeHtml(strings.helpClose)}</button></div>
            <div class="screen-help-tables">
                ${sections.map(section => `<section data-help-section="${section.view}"${section.view === current ? ' data-screen-help-keys aria-current="true"' : ''}>`
                    + `<h3>${escapeHtml(strings[section.titleKey])}</h3><table>${keyRows(section.rows, strings)}</table></section>`).join('')}
                <section data-help-section="symbols"><h3>${escapeHtml(strings.helpSectionSymbols)}</h3><table data-screen-help-symbols>${symbolRows(strings.screenHelpSymbols)}</table></section>
            </div>
        </div>`;
        overlay.hidden = false;
        overlay.querySelector<HTMLElement>('#help-close-btn')?.focus();
    }
    function close(): boolean {
        if (overlay.hidden) return false;
        overlay.hidden = true;
        returnFocus?.focus?.();
        return true;
    }
    overlay.addEventListener('click', event => {
        const target = eventTarget(event);
        if (target === overlay || target?.closest?.('[data-action="help-close"]')) close();
    });
    /** aria-modal: Tab stays in the dialog. It runs in the help's key context: a context behind it (the maximized
     * entry table) would otherwise take Tab on the close button, and the router stops every other listener. */
    function trapTab(event: KeyboardEvent): void {
        const focusable = Array.from(overlay.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); return; }
        const at = focusable.indexOf(document.activeElement as HTMLElement);
        const wraps = at < 0 || (event.shiftKey ? at === 0 : at === focusable.length - 1);
        if (wraps) {
            (event.shiftKey ? last : first).focus();
            event.preventDefault();
        }
    }
    const SCROLL_LINE = 40;
    function scrollHelp(key: string): boolean {
        const box = overlay.querySelector<HTMLElement>('.screen-help-box');
        if (!box) return false;
        const page = Math.max(SCROLL_LINE, box.clientHeight - SCROLL_LINE);
        const by: Record<string, number> = { ArrowDown: SCROLL_LINE, ArrowUp: -SCROLL_LINE, PageDown: page, PageUp: -page };
        if (key === 'Home') box.scrollTop = 0;
        else if (key === 'End') box.scrollTop = box.scrollHeight;
        else if (key in by) box.scrollTop += by[key];
        else return false;
        return true;
    }
    keyRouterFor(window).add({
        layer: 'help',
        keydown(event) {
            const toggle = event.key === '?' || event.key === 'F1';
            if (!overlay.hidden) {
                if (event.key === 'Tab') { trapTab(event); return true; }
                // The help can be taller than the window: the scrolling keys scroll it, and reach nothing behind it.
                if (scrollHelp(event.key)) { event.preventDefault(); return true; }
                // Enter and Space still press the close button.
                const pressing = (event.key === 'Enter' || event.key === ' ') && overlay.contains(event.target as Node);
                if (!pressing) event.preventDefault();
                if (toggle || event.key === 'Escape') close();
                return true;
            }
            // "?" typed into a field is a character; F1 always opens.
            if (!toggle || (event.key === '?' && isTextEntryTarget(event.target))) return false;
            event.preventDefault();
            open(view());
            return true;
        },
    });
    return { open, close, isOpen: () => !overlay.hidden };
}
