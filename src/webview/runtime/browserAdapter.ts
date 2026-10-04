import type { UiStrings } from '../../shared/i18n/strings';
import type {
    ComparisonBootstrap,
    ComparisonState,
    RuntimeDocument,
    RuntimeWindow,
    WebviewHostApi,
} from './types';

export interface ComparisonWindow extends RuntimeWindow {
    __APP_STATE__?: ComparisonState;
    __APP_STRINGS__?: UiStrings;
    __AWA_HOST__?: WebviewHostApi;
    acquireVsCodeApi?: () => WebviewHostApi;
}

export function readComparisonBootstrap(browserWindow: ComparisonWindow): ComparisonBootstrap {
    const state = browserWindow.__APP_STATE__;
    const strings = browserWindow.__APP_STRINGS__;
    const acquireHost = browserWindow.acquireVsCodeApi;
    if (!state || !strings || !acquireHost && !browserWindow.__AWA_HOST__) {
        throw new Error('Comparison Webview bootstrap data is unavailable');
    }
    return {
        state,
        strings,
        host: browserWindow.__AWA_HOST__ ?? acquireHost!(),
        window: browserWindow,
        document: browserWindow.document as RuntimeDocument,
    };
}
