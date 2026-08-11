import type { HostInboundMessage, HostMessenger } from './hostMessaging';
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

    setTreeFilterFlush(handler: () => void): void {
        this.browserWindow.__treeFilterFlush = handler;
    }

    publish(renderedUi: Record<string, unknown>, actionId?: string): void {
        this.messenger.post({ type: 'comparison-panel-test-snapshot', actionId, renderedUi });
    }
}
