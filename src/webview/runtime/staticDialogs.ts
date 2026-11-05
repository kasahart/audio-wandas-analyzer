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
