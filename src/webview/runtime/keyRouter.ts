/**
 * The one window-level key listener. Each part of the UI that takes keys adds a context to it; a key goes to
 * the contexts front to back (the help over a popover over a focused resize edge over the step bar over the
 * entry table over the comparison over the lanes) and stops at the first one that takes it.
 * A component's own element-level listeners (a role chip, a field, the step bar's chips) still see a key no
 * context took.
 */
export type KeyLayer = 'help' | 'popover' | 'widget' | 'step-bar' | 'entry' | 'stage' | 'lanes';

const LAYER_ORDER: readonly KeyLayer[] = ['help', 'popover', 'widget', 'step-bar', 'entry', 'stage', 'lanes'];

export interface KeyContext {
    readonly layer: KeyLayer;
    /** True when the context took the key: no context behind it, nor any other listener, sees it. */
    keydown: (event: KeyboardEvent) => boolean;
    keyup?: (event: KeyboardEvent) => boolean;
}

export interface KeyRouter {
    /** Adds a context; the returned function takes it out again (a popover closing). */
    add(context: KeyContext): () => void;
    /** The layers in front for this key, front first: for tests and the help's choice of section. */
    layers(): KeyLayer[];
}

type KeyWindow = Pick<Window, 'addEventListener'>;

const routers = new WeakMap<object, KeyRouter>();

function createKeyRouter(target: KeyWindow): KeyRouter {
    // Later additions to a layer sit in front of earlier ones: the newest popover closes first.
    const contexts: KeyContext[] = [];
    function ordered(): KeyContext[] {
        return contexts.map((context, index) => ({ context, index }))
            .sort((a, b) => LAYER_ORDER.indexOf(a.context.layer) - LAYER_ORDER.indexOf(b.context.layer) || b.index - a.index)
            .map(item => item.context);
    }
    function route(event: KeyboardEvent, phase: 'keydown' | 'keyup'): void {
        for (const context of ordered()) {
            const handler = phase === 'keydown' ? context.keydown : context.keyup;
            if (handler?.call(context, event)) {
                event.stopImmediatePropagation();
                return;
            }
        }
    }
    target.addEventListener('keydown', event => route(event, 'keydown'), true);
    target.addEventListener('keyup', event => route(event, 'keyup'), true);
    return {
        add(context) {
            contexts.push(context);
            return () => {
                const at = contexts.indexOf(context);
                if (at >= 0) contexts.splice(at, 1);
            };
        },
        layers: () => ordered().map(context => context.layer),
    };
}

/** The window's router, made with the first context added to it. */
export function keyRouterFor(target: KeyWindow): KeyRouter {
    let router = routers.get(target);
    if (!router) {
        router = createKeyRouter(target);
        routers.set(target, router);
    }
    return router;
}

/** A field, a select or editable text takes its own characters. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
    return !!(target as Element | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}
