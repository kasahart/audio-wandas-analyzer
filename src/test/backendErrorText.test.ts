import assert from 'node:assert/strict';
import test from 'node:test';
import { getStrings } from '../shared/i18n/strings';
import {
    BACKEND_ERROR_KINDS, BackendRequestError, settleBackendRequest, userErrorText,
    type BackendErrorKind, type PendingBackendRequest,
} from '../shared/protocol/backendProtocol';
import { ComparisonSessionController, type ComparisonSessionPorts, type SessionPublication } from '../shared/session/comparisonSessionController';
import { spectrogramFailureText } from '../webview/runtime/spectrogramRaster';
import { LoadFailures } from '../webview/runtime/staticSources';

const SCIPY = 'recipe error: Recipe operation failed\nCause: Parameter n must be >= ceil(m_num/2) = 32!';
const en = getStrings('en');
const ja = getStrings('ja');

/** The error a host's request rejects with when the backend answers `payload`. */
function rejectedWith(payload: unknown): Error {
    let rejected: Error | undefined;
    const pending = new Map<string, PendingBackendRequest<unknown>>([['r1', { command: 'track-detail', complete: () => undefined, reject: (error) => { rejected = error; } }]]);
    settleBackendRequest(pending, 'r1', { error: payload }, payload);
    assert.ok(rejected);
    return rejected;
}

test('a backend error reads as the summary of its kind in the UI language, then the backend text', () => {
    const error = rejectedWith({ code: 'input-error', kind: 'analysis-settings', message: SCIPY });

    assert.equal(userErrorText(error, en), `These analysis settings don't fit this file. Choose a smaller FFT size, or a longer file or region.\n${SCIPY}`);
    assert.equal(userErrorText(error, ja), `この解析設定はこのファイルに合いません。FFT サイズを小さくするか、より長いファイルや区間を選んでください。\n${SCIPY}`);
});

test('every error kind has its own summary in English and Japanese', () => {
    const summaries = (strings: typeof en) => BACKEND_ERROR_KINDS.map((kind: BackendErrorKind) =>
        userErrorText(new BackendRequestError('internal-error', kind, 'detail'), strings).split('\n'));
    for (const strings of [en, ja]) {
        const lines = summaries(strings);
        assert.ok(lines.every(([summary, detail]) => summary && detail === 'detail'));
        assert.equal(new Set(lines.map(([summary]) => summary)).size, BACKEND_ERROR_KINDS.length);
    }
    assert.ok(summaries(ja).every(([summary], index) => summary !== summaries(en)[index][0]), 'Japanese is not the English text');
});

test('the summary comes from the backend error in the cause chain; other errors keep their own message', () => {
    const backend = new BackendRequestError('internal-error', 'out-of-memory', 'Unable to allocate 8.00 GiB');
    const wrapped = new Error('analysis failed', { cause: backend });

    assert.equal(userErrorText(wrapped, ja), `${ja.errorOutOfMemory}\nUnable to allocate 8.00 GiB`);
    assert.equal(userErrorText(new Error('Python backend exited'), ja), 'Python backend exited');
    assert.equal(userErrorText('plain', en), 'plain');
});

test('a failed spectrogram request reaches the lane as the localized summary with the backend text as detail', async () => {
    const published: SessionPublication[] = [];
    const announced: string[] = [];
    const ports = {
        strings: ja,
        scope: () => ({ isCurrent: () => true, canPublish: () => true }),
        publish: (message: SessionPublication) => { published.push(message); },
        stftOptions: () => undefined,
        lazyContext: () => ({ analysisRevision: 0 }),
        lazyFailed: (_request: unknown, reason: string) => { announced.push(reason); },
        client: {
            requestTrackDetail: () => Promise.reject(rejectedWith({ code: 'input-error', kind: 'analysis-settings', message: SCIPY })),
        },
    } as unknown as ComparisonSessionPorts;

    await new ComparisonSessionController(ports).handle({
        type: 'request-track-detail', requestId: 'd1', analysisId: 'a', settingsSignature: 's', trackIndex: 0, filePath: '/short.wav',
    });

    const expected = `${ja.errorAnalysisSettings}\n${SCIPY}`;
    assert.deepEqual(announced, [expected]);
    assert.equal(published.length, 1);
    assert.deepEqual(published[0], {
        type: 'track-detail-error', requestId: 'd1', analysisId: 'a', settingsSignature: 's', trackIndex: 0, filePath: '/short.wav', error: expected,
    });
});

test('the spectrogram lane draws the summary on the first line and the backend text on the second', () => {
    const reason = userErrorText(new BackendRequestError('input-error', 'analysis-settings', 'Parameter n must be >= ceil(m_num/2) = 32!'), en);

    assert.equal(spectrogramFailureText(en, reason),
        `Spectrogram failed: ${en.errorAnalysisSettings}\nParameter n must be >= ceil(m_num/2) = 32!`);
    assert.equal(spectrogramFailureText(ja, userErrorText(new BackendRequestError('input-error', 'analysis-settings', 'x'), ja)),
        `スペクトログラムを計算できませんでした: ${ja.errorAnalysisSettings}\nx`);
    assert.equal(spectrogramFailureText(en, 'no host'), 'Spectrogram failed: no host');
});

test('a browser load failure is announced with the localized summary and the Worker text', () => {
    const failures = new LoadFailures();
    failures.add('a.wav', new BackendRequestError('input-error', 'unreadable-file', 'Unable to read audio: invalid or unsupported data'));

    assert.equal(failures.announcement(ja, 'a.wav', 0), ja.browserFileFailed.replace('{file}', 'a.wav')
        .replace('{error}', `${ja.errorUnreadableFile}\nUnable to read audio: invalid or unsupported data`));
});
