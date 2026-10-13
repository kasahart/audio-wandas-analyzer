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
    addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEvent) => void): void;
}

export function attachGlobalKeyboardListeners<A extends FocusedElementLike>(doc: KeyboardDocument<A>, handlers: GlobalKeyboardHandlers<A>): void {
    doc.addEventListener('keydown', function (e) {
        const active = doc.activeElement;
        const intent = keydownIntent(e, keydownContextFor(active, handlers.helpOverlay(), handlers.spectrumHasMouse()));
        if (!intent) {
            return;
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
    });
    doc.addEventListener('keyup', function (e) {
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
            handlers.arrowReleased();
        }
    });
}
