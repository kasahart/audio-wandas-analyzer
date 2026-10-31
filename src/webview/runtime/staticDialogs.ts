import type { ChartSpec } from '../../shared/chartSpec';
import type { UiStrings } from '../../shared/i18n/strings';
import { chartSpecGlobals, renderChartSpecStyles } from '../panels/chartSpecDocument';
import { keyRouterFor } from './keyRouter';

/** A small in-page choice (the page's language and look, not the browser's prompt); Esc or a press outside cancels. */
export function choose<T extends string>(
    document: Document, window: Window, title: string, options: ReadonlyArray<readonly [T, string]>,
): Promise<T | undefined> {
    return new Promise(resolve => {
        const box = document.createElement('div');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', title);
        box.setAttribute('data-web-choice', '');
        box.style.cssText = 'position:fixed;top:30%;left:50%;transform:translateX(-50%);z-index:80;display:grid;gap:6px;min-width:240px;padding:12px 14px;'
            + 'background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.35);font-size:13px';
        const heading = document.createElement('div');
        heading.textContent = title;
        heading.style.cssText = 'color:var(--muted);margin-bottom:2px';
        box.append(heading);
        const close = (value: T | undefined): void => {
            box.remove();
            document.removeEventListener('pointerdown', outside, true);
            removeKeys();
            resolve(value);
        };
        const outside = (event: Event): void => { if (!box.contains(event.target as Node)) close(undefined); };
        let removeKeys = (): void => undefined;
        for (const [value, label] of options) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tb-btn';
            button.textContent = label;
            button.addEventListener('click', () => close(value));
            box.append(button);
        }
        document.body.append(box);
        document.addEventListener('pointerdown', outside, true);
        removeKeys = keyRouterFor(window).add({
            layer: 'popover',
            keydown(event) {
                if (event.key !== 'Escape') return false;
                event.preventDefault();
                close(undefined);
                return true;
            },
        });
        box.querySelector('button')?.focus();
    });
}

/**
 * Recipe charts render in a same-origin frame: the bundled ChartSpec renderer arrives as ./chartSpecRuntime.js under
 * the page CSP, and a fresh document per run keeps the renderer's one-shot range popup and listeners isolated.
 * `prepareFrame` gets the frame's window before the renderer loads (the host lets it take dropped files too).
 */
export function showRecipeCharts(
    document: Document, strings: UiStrings, title: string, charts: ChartSpec[], caption: string, prepareFrame: (frame: Window) => void,
): void {
    document.querySelector('[data-recipe-result]')?.remove();
    const panel = document.createElement('section');
    panel.setAttribute('data-recipe-result', title);
    panel.style.cssText = 'margin:8px;border:1px solid #444;border-radius:4px;background:#1e1e1e;color:#ddd';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #444';
    const heading = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = title;
    const inputs = document.createElement('span'); inputs.textContent = caption;
    inputs.style.cssText = 'margin-left:8px;font-size:11px;color:#999';
    heading.append(name, inputs);
    const close = document.createElement('button');
    close.setAttribute('data-action', 'browser-recipe-close');
    close.textContent = strings.btnCloseRecipeResult;
    close.onclick = (): void => { panel.remove(); };
    header.append(heading, close);
    const frame = document.createElement('iframe');
    frame.setAttribute('title', title);
    frame.style.cssText = 'display:block;width:100%;height:60vh;border:0;background:#1e1e1e';
    panel.append(header, frame);
    document.body.prepend(panel);
    // A same-origin frame has its document and window once it is in the page.
    const target = frame.contentDocument;
    const frameWindow = frame.contentWindow;
    if (!target || !frameWindow) throw new Error('The recipe chart frame did not open');
    const style = target.createElement('style'); style.textContent = renderChartSpecStyles();
    const chartsHost = target.createElement('div'); chartsHost.id = 'charts';
    target.head.append(style); target.body.append(chartsHost);
    Object.assign(frameWindow as unknown as Record<string, unknown>, chartSpecGlobals(charts, strings));
    prepareFrame(frameWindow);
    const script = target.createElement('script'); script.src = './chartSpecRuntime.js';
    target.body.append(script);
}
