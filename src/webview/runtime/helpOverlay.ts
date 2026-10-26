import type { UiStrings } from '../../shared/i18n/strings';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { eventTarget } from './domAdapter';
import { SHORTCUT_ROWS } from './shortcuts';

/** Keyboard-shortcut dialog toggled by `?`; the comparison runtime suspends its shortcuts while it is open. */
export function installHelpOverlay(document: Document, STR: UiStrings): void {
    const tableRows = SHORTCUT_ROWS.map(function (row) {
        return '<tr><td style="padding:3px 12px 3px 0;font-family:var(--font-mono);white-space:nowrap;color:var(--accent)">' + escapeHtml(row.shortcut)
            + '</td><td style="padding:3px 0;color:var(--text)">' + escapeHtml(STR[row.labelKey as keyof typeof STR]) + '</td></tr>';
    }).join('');
    document.body.insertAdjacentHTML('beforeend', '<div id="help-overlay" hidden role="dialog" aria-modal="true" aria-label="' + escapeHtml(STR.helpTitle) + '" '
        + 'style="position:fixed;inset:0;z-index:70;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.45)">'
        + '<div style="background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:20px 24px;min-width:320px;box-shadow:0 4px 24px rgba(0,0,0,0.4)">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">'
        + '<span style="font-weight:700;font-size:13px;color:var(--text)">' + escapeHtml(STR.helpTitle) + '</span>'
        + '<button id="help-close-btn" class="tb-btn" style="font-size:11px;padding:2px 8px">' + escapeHtml(STR.helpClose) + '</button>'
        + '</div>'
        + '<table style="border-collapse:collapse;font-size:12px;width:100%">' + tableRows + '</table>'
        + '</div></div>');
    function openHelp() {
        var el = document.getElementById('help-overlay');
        if (el) {
            el.hidden = false;
            el.style.display = 'flex';
            var btn = document.getElementById('help-close-btn');
            if (btn) {
                btn.focus();
            }
        }
    }
    function closeHelp() {
        var el = document.getElementById('help-overlay');
        if (el) {
            el.style.display = 'none';
            el.hidden = true;
        }
    }
    function isHelpOpen() { var el = document.getElementById('help-overlay'); return el && !el.hidden; }
    var closeBtn = document.getElementById('help-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeHelp);
    }
    const overlayEl = document.getElementById('help-overlay');
    if (!overlayEl) {
        return;
    }
    overlayEl.addEventListener('click', function (e) {
        if (eventTarget(e) === overlayEl) {
            closeHelp();
        }
    });
    // フォーカストラップ: aria-modal="true" の期待に応えるため、Tab キーをダイアログ内に閉じ込める
    overlayEl.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Tab') {
            return;
        }
        var focusable = Array.from(overlayEl.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        if (focusable.length === 0) {
            ev.preventDefault();
            return;
        }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (ev.shiftKey) {
            if (document.activeElement === first) {
                last.focus();
                ev.preventDefault();
            }
        }
        else {
            if (document.activeElement === last) {
                first.focus();
                ev.preventDefault();
            }
        }
    });
    document.addEventListener('keydown', function (ev) {
        var tag = document.activeElement && document.activeElement.tagName ? document.activeElement.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            return;
        }
        if (ev.key === '?' || ev.key === 'F1') {
            if (isHelpOpen()) {
                closeHelp();
            }
            else {
                openHelp();
            }
            ev.preventDefault();
            return;
        }
        if (ev.key === 'Escape' && isHelpOpen()) {
            closeHelp();
            ev.stopPropagation();
        }
    });
}
