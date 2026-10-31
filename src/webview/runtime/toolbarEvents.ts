import { eventTarget } from './domAdapter';
import type { HeightResize } from './heightResize';
import { keyRouterFor } from './keyRouter';

export interface ToolbarActionHandlers {
    onAction(action: string): void;
}

const HEIGHT_DRAG_HANDLE_SELECTOR = '[data-action="track-height-drag"], [data-action="spectrum-height-drag"]';

function actionOf(element: Element | null): string | null {
    return element && element.getAttribute ? element.getAttribute('data-action') : null;
}

export function attachToolbarActions(container: HTMLElement | null, handlers: ToolbarActionHandlers): void {
    if (!container) {
        return;
    }
    container.addEventListener('click', function (e) {
        const target = eventTarget(e) && eventTarget(e).closest ? eventTarget(e).closest('[data-action]') : eventTarget(e);
        const action = actionOf(target);
        if (!action) {
            return;
        }
        handlers.onAction(action);
    });
}

export function attachExclusiveMenus(toolbar: HTMLElement | null): void {
    if (!toolbar) {
        return;
    }
    toolbar.querySelectorAll<HTMLDetailsElement>('details.tb-menu').forEach(function (menu) {
        menu.addEventListener('toggle', function () {
            if (!menu.open) {
                return;
            }
            toolbar.querySelectorAll<HTMLDetailsElement>('details.tb-menu[open]').forEach(function (otherMenu) {
                if (otherMenu !== menu) {
                    otherMenu.open = false;
                }
            });
        });
    });
    // A menu closes once one of its items is used, on a press outside it, and on Esc.
    const closeAll = function (except?: Element | null): void {
        toolbar.querySelectorAll<HTMLDetailsElement>('details.tb-menu[open]').forEach(function (menu) {
            if (!except || !menu.contains(except)) {
                menu.open = false;
            }
        });
    };
    toolbar.addEventListener('click', function (e) {
        const target = eventTarget(e);
        const item = target && target.closest ? target.closest('.tb-menu-popover [data-action]') : null;
        if (item) {
            closeAll();
        }
    });
    toolbar.ownerDocument.addEventListener('pointerdown', function (e) {
        closeAll(eventTarget(e));
    }, true);
    keyRouterFor(toolbar.ownerDocument.defaultView!).add({
        layer: 'popover',
        keydown(e) {
            if (e.key !== 'Escape' || !toolbar.querySelector('details.tb-menu[open]')) {
                return false;
            }
            closeAll();
            return true;
        },
    });
}

export function attachHeightResizeListeners(
    heightResize: HeightResize,
    surfaces: ReadonlyArray<HTMLElement | null>,
    doc: Document,
    win: Window,
): void {
    function handleStart(e: PointerEvent): void {
        const target = eventTarget(e) && eventTarget(e).closest ? eventTarget(e).closest(HEIGHT_DRAG_HANDLE_SELECTOR) : null;
        if (!target) {
            return;
        }
        heightResize.begin(target.getAttribute('data-action') === 'track-height-drag' ? 'track' : 'spectrum', e.clientY || 0);
        e.preventDefault();
    }
    function handleMove(e: PointerEvent): void {
        heightResize.update(e.clientY || 0);
        if (heightResize.isActive()) {
            e.preventDefault();
        }
    }
    function handleEnd(): void {
        heightResize.end();
    }
    for (const surface of surfaces) {
        if (surface) {
            surface.addEventListener('pointerdown', handleStart);
        }
    }
    doc.addEventListener('pointerdown', handleStart);
    win.addEventListener('pointerdown', handleStart, true);
    doc.addEventListener('pointermove', handleMove);
    win.addEventListener('pointermove', handleMove, true);
    doc.addEventListener('pointerup', handleEnd);
    win.addEventListener('pointerup', handleEnd, true);
    win.addEventListener('pointercancel', handleEnd, true);
}
