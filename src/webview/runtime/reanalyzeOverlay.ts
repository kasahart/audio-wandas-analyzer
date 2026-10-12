import { escapeHtml } from '../../shared/utils/webviewEscaping';

export interface ReanalyzeOverlayOptions {
    defaultMessage: string;
    onShow(message: string): void;
}

export interface ReanalyzeOverlay {
    setBusy(busy: boolean, message?: string): void;
    isBusy(): boolean;
}

export function reanalyzeOverlayHtml(defaultMessage: string): string {
    return '<div id="reanalyze-overlay" style="position:fixed;top:0;left:0;right:0;z-index:60;background:var(--panel);color:var(--text);'
        + 'padding:8px 14px;border-bottom:1px solid var(--line);font-family:var(--font-ui);font-size:12px;'
        + 'display:none;align-items:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,0.3)">'
        + '<span class="spinner" style="width:12px;height:12px;border:2px solid var(--muted);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite"></span>'
        + '<span id="reanalyze-overlay-msg">' + escapeHtml(defaultMessage) + '</span>'
        + '</div>'
        + '<style>@keyframes spin { to { transform: rotate(360deg); } }</style>';
}

export function installReanalyzeOverlay(document: Document, options: ReanalyzeOverlayOptions): ReanalyzeOverlay {
    document.body.insertAdjacentHTML('beforeend', reanalyzeOverlayHtml(options.defaultMessage));
    const overlay = document.getElementById('reanalyze-overlay');
    const messageEl = document.getElementById('reanalyze-overlay-msg');
    return {
        setBusy(busy, message) {
            if (!overlay || !messageEl) {
                return;
            }
            if (busy) {
                const text = message || options.defaultMessage;
                messageEl.textContent = text;
                overlay.style.display = 'flex';
                options.onShow(text);
            }
            else {
                overlay.style.display = 'none';
            }
        },
        isBusy: () => !!overlay && overlay.style.display !== 'none',
    };
}
