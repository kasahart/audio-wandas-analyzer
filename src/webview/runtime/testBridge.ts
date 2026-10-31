import type { HostInboundMessage, HostMessenger } from './hostMessaging';
import type { RuntimeEventFeed } from './runtimeEvents';
import type { RuntimeWindow, UiSmokeState } from './types';

export type TestActionMessage = Extract<HostInboundMessage, { type: 'comparison-panel-test-action' }>;

export class ComparisonTestBridge {
    constructor(
        private readonly browserWindow: RuntimeWindow,
        private readonly messenger: HostMessenger,
    ) {}

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

    publish(renderedUi: Record<string, unknown>, actionId?: string): void {
        this.messenger.post({ type: 'comparison-panel-test-snapshot', actionId, renderedUi });
    }
}
