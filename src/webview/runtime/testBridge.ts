import type { HostInboundMessage, HostMessenger } from './hostMessaging';
import type { RuntimeEventFeed } from './runtimeEvents';
import type { RuntimeWindow, UiSmokeState } from './types';

export type TestActionMessage = Extract<HostInboundMessage, { type: 'comparison-panel-test-action' }>;

/** The rendered UI a test reads; `fallback` stands in when building it throws (a test action left it half-drawn). */
export interface TestSnapshotSource {
    build(): Record<string, unknown>;
    fallback(error: unknown): Record<string, unknown>;
}

export class ComparisonTestBridge {
    private source: TestSnapshotSource | undefined;

    constructor(
        private readonly browserWindow: RuntimeWindow,
        private readonly messenger: HostMessenger,
    ) {}

    /** Only a page the tests open sets `__AWA_TEST_HOOKS__` (the VS Code host in its test mode, the smoke pages). */
    get enabled(): boolean {
        return this.browserWindow.__AWA_TEST_HOOKS__ === true;
    }

    /** What a snapshot holds, built only when a test page publishes one. */
    provide(source: TestSnapshotSource): void {
        this.source = source;
    }

    get state(): UiSmokeState | undefined {
        return this.browserWindow.__uiSmokeState;
    }

    onActions(listener: (message: TestActionMessage) => void): () => void {
        return this.messenger.onMessage((message) => {
            if (message.type === 'comparison-panel-test-action') {
                listener(message);
            }
        });
    }

    /** The smoke tests read the runtime's view state from `__uiSmokeState`; elsewhere nothing listens. */
    observe(feed: RuntimeEventFeed): void {
        const state = this.state;
        if (!state) {
            return;
        }
        feed.subscribe((event) => {
            if (event.type === 'spectrum-zoom') {
                state.spectrumZoom = event.snapshot;
            }
            else if (event.type === 'waveform-zoom') {
                Object.assign(state, event.snapshot);
            }
            else {
                state.spectrumPerformance = event.timing;
            }
        });
    }

    publish(actionId?: string): void {
        if (!this.enabled || !this.source) return;
        this.post(this.source.build(), actionId);
    }

    /** As `publish`, after the next frame has drawn what the change asked for. */
    publishAfterFrame(): void {
        if (!this.enabled) return;
        this.browserWindow.requestAnimationFrame(() => { this.publish(); });
    }

    /** The answer to a test action: published even when building it throws, so the test sees the error. */
    publishFor(actionId?: string): void {
        if (!this.enabled || !this.source) return;
        let renderedUi: Record<string, unknown>;
        try {
            renderedUi = this.source.build();
        }
        catch (error) {
            renderedUi = this.source.fallback(error);
        }
        this.post(renderedUi, actionId);
    }

    private post(renderedUi: Record<string, unknown>, actionId?: string): void {
        this.messenger.post({ type: 'comparison-panel-test-snapshot', actionId, renderedUi });
    }
}
