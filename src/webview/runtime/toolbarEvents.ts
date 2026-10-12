import { eventTarget } from './domAdapter';
import type { HeightResize } from './heightResize';
import type { RuntimeElement } from './types';

export interface ToolbarActionHandlers {
    onAction(action: string): void;
    onHeightInput(action: string | null, value: string | null): void;
}

// Height inputs are handled by their input/change events; a click on them must not also run as a toolbar action.
const HEIGHT_INPUT_ACTIONS = new Set(['track-height-input', 'spectrum-height-input']);
const HEIGHT_DRAG_HANDLE_SELECTOR = '[data-action="track-height-drag"], [data-action="spectrum-height-drag"]';

function actionOf(element: RuntimeElement | null): string | null {
    return element && element.getAttribute ? element.getAttribute('data-action') : null;
}

export function attachToolbarActions(container: RuntimeElement | null, handlers: ToolbarActionHandlers): void {
    if (!container) {
        return;
    }
    container.addEventListener('click', function (e) {
        const target = eventTarget(e) && eventTarget(e).closest ? eventTarget(e).closest('[data-action]') : eventTarget(e);
        const action = actionOf(target);
        if (!action || HEIGHT_INPUT_ACTIONS.has(action)) {
            return;
        }
        handlers.onAction(action);
    });
    function onHeightInput(e: Event): void {
        const target = eventTarget(e);
        handlers.onHeightInput(actionOf(target), target ? target.value : null);
    }
    container.addEventListener('input', onHeightInput);
    container.addEventListener('change', onHeightInput);
}

export function attachExclusiveMenus(toolbar: RuntimeElement | null): void {
    if (!toolbar) {
        return;
    }
    toolbar.querySelectorAll('details.tb-menu').forEach(function (menu: RuntimeElement) {
        menu.addEventListener('toggle', function () {
            if (!menu.open) {
                return;
            }
            toolbar.querySelectorAll('details.tb-menu[open]').forEach(function (otherMenu: RuntimeElement) {
                if (otherMenu !== menu) {
                    otherMenu.open = false;
                }
            });
        });
    });
}

export function attachHeightResizeListeners(
    heightResize: HeightResize,
    surfaces: ReadonlyArray<RuntimeElement | null>,
    doc: Document,
    win: Window,
): void {
    function handleStart(e: MouseEvent): void {
        const target = eventTarget(e) && eventTarget(e).closest ? eventTarget(e).closest(HEIGHT_DRAG_HANDLE_SELECTOR) : null;
        if (!target) {
            return;
        }
        heightResize.begin(target.getAttribute('data-action') === 'track-height-drag' ? 'track' : 'spectrum', e.clientY || 0);
        e.preventDefault();
    }
    function handleMove(e: MouseEvent): void {
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
            surface.addEventListener('mousedown', handleStart);
        }
    }
    doc.addEventListener('mousedown', handleStart);
    win.addEventListener('mousedown', handleStart, true);
    doc.addEventListener('mousemove', handleMove);
    win.addEventListener('mousemove', handleMove, true);
    doc.addEventListener('mouseup', handleEnd);
    win.addEventListener('mouseup', handleEnd, true);
}
