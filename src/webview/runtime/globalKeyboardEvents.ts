import type { KeyRouter } from './keyRouter';
import { keydownContextFor, keydownIntent, type FocusedElementLike, type GlobalShortcutAction } from './shortcuts';

export interface GlobalKeyboardHandlers<A extends FocusedElementLike> {
    helpOverlay(): { hidden: boolean } | null;
    spectrumHasMouse(): boolean;
    stepSpectrum(delta: -1 | 1): void;
    runShortcut(action: GlobalShortcutAction): void;
    togglePlayback(target: 'focused-track' | 'current', active: A | null): void;
    stepCursor(direction: -1 | 1, shiftKey: boolean, active: A | null): void;
    arrowReleased(): void;
}

interface KeyboardDocument<A> {
    readonly activeElement: A | null;
}

/** The lanes' keys: the context at the back of the router, reached by what the views in front leave. */
export function attachGlobalKeyboardListeners<A extends FocusedElementLike>(router: Pick<KeyRouter, 'add'>, doc: KeyboardDocument<A>, handlers: GlobalKeyboardHandlers<A>): void {
    router.add({ layer: 'lanes', keydown, keyup });
    function keydown(e: KeyboardEvent): boolean {
        // A focused role chip takes the digits as its slot (roleChip.ts).
        if (/^[0-3]$/.test(e.key) && (e.target as Element | null)?.closest?.('details.role-chip')) {
            return false;
        }
        const active = doc.activeElement;
        const intent = keydownIntent(e, keydownContextFor(active, handlers.helpOverlay(), handlers.spectrumHasMouse()));
        if (!intent) {
            return false;
        }
        e.preventDefault();
        if (intent.kind === 'spectrum-step') {
            handlers.stepSpectrum(intent.delta);
        }
        else if (intent.kind === 'shortcut') {
            handlers.runShortcut(intent.action);
        }
        else if (intent.kind === 'toggle-playback') {
            handlers.togglePlayback(intent.target, active);
        }
        else {
            handlers.stepCursor(intent.direction, e.shiftKey, active);
        }
        return true;
    }
    function keyup(e: KeyboardEvent): boolean {
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            handlers.arrowReleased();
        }
        return false;
    }
}
