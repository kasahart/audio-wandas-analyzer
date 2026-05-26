import { buildResultsPreviewHtml, buildSelectionPreviewHtml } from '../../tools/comparisonPreview';

function buildVsCodeApiStub(nonce: string): string {
    return `<script nonce="${nonce}">
window.__uiSmokePostedMessages = [];
window.__uiSmokeDownloads = [];
window.__uiSmokeClipboardWrites = [];
window.__uiSmokeState = {};
window.acquireVsCodeApi = function() {
    return {
        postMessage(message) {
            window.__uiSmokePostedMessages.push(message);
        },
        setState() {},
        getState() { return null; },
    };
};
if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {},
    });
}
navigator.clipboard.writeText = async function(text) {
    window.__uiSmokeClipboardWrites.push(String(text));
};
const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function() {
    window.__uiSmokeDownloads.push({
        download: this.download || '',
        href: this.href || '',
    });
    return originalAnchorClick.call(this);
};
HTMLMediaElement.prototype.play = function() {
    return Promise.resolve();
};
</script>`;
}

function finalizeUiSmokeHtml(html: string): string {
    const nonceMatch = html.match(/<script nonce="([^"]+)">/u);
    if (!nonceMatch) {
        throw new Error('Could not extract webview nonce from rendered HTML');
    }
    const nonce = nonceMatch[1];
    return html.replace('<div id="app"></div>', `<div id="app"></div>\n    ${buildVsCodeApiStub(nonce)}`);
}

export function buildUiSmokeHtml(): string {
    return finalizeUiSmokeHtml(buildResultsPreviewHtml());
}

export function buildUiSmokeSelectionHtml(): string {
    return finalizeUiSmokeHtml(buildSelectionPreviewHtml());
}
