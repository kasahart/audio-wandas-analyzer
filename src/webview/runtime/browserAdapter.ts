import type { UiStrings } from '../../shared/i18n/strings';
import type {
    ComparisonBootstrap,
    ComparisonState,
    RuntimeWindow,
    WebviewHostApi,
} from './types';

export interface ComparisonWindow extends RuntimeWindow {
    __APP_STATE__?: ComparisonState;
    __APP_STRINGS__?: UiStrings;
    __APP_VERSION__?: string;
    __AWA_HOST__?: WebviewHostApi;
    /**
     * The optional Python packages the host's runtime cannot import, as its Worker reports them when it
     * boots (the Web version); unset where the analyzer installs them all (VS Code).
     */
    __AWA_RUNTIME_LACKS__?: readonly string[];
    acquireVsCodeApi?: () => WebviewHostApi;
}

export function readComparisonBootstrap(browserWindow: ComparisonWindow): ComparisonBootstrap {
    const state = browserWindow.__APP_STATE__;
    const strings = browserWindow.__APP_STRINGS__;
    const acquireHost = browserWindow.acquireVsCodeApi;
    const appVersion = browserWindow.__APP_VERSION__;
    if (!state || !strings || appVersion === undefined || !acquireHost && !browserWindow.__AWA_HOST__) {
        throw new Error('Comparison Webview bootstrap data is unavailable');
    }
    return {
        state,
        strings,
        appVersion,
        host: browserWindow.__AWA_HOST__ ?? acquireHost!(),
        window: browserWindow,
        document: browserWindow.document,
    };
}
