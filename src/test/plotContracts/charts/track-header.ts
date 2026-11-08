import { RT, t, type ChartContract } from '../model';

/** トラックの見出しとツールバーの数（カーソルの時刻、ずらし、ピーク、解析窓） */
export const trackHeader: ChartContract = {
    chart: {
        id: 'track-header', name: 'トラックの見出しとツールバーの数（カーソルの時刻、ずらし、ピーク、解析窓）',
        paintedBy: ['src/webview/runtime/calibrationDecorations.ts:channelMetricSummaryHtml', `${RT}:updateCursorDisplay`],
        requires: ['summary', 'label'],
    },
    rows: [
        {
            id: 'track-header.peak', value: 'summary', what: 'チャンネルのピーク（振幅とレベル）',
            computedIn: ['src/webview/runtime/calibrationDecorations.ts:channelMetricSummaryHtml', 'src/webview/runtime/calibrationDecorations.ts:levelText', 'src/webview/runtime/calibrationDecorations.ts:peakText', 'python-backend/analyzer.py:analyze_from_frame'],
            from: 'full', trace: 'バックエンドが全サンプルのピークと wandas のレベルを返し、webview は計算し直さない。',
            tests: [
                t('src/test/renderScript.integration.test.ts', 'renderScript: channel peak metrics use backend-provided levels without recalculating dB'),
                t('src/test/calibrationContracts.test.ts', 'calibration row helpers draw badges, peak text, requests and the overlay guard'),
            ],
            gap: { severity: 'P2', why: '全データと描いた点が違うデータで確かめるテストがない（今のテストは描いた点でも通る）。' },
        },
        {
            id: 'track-header.meta', value: 'summary', what: 'チャンネル数とサンプリング周波数（kHz）',
            computedIn: ['src/webview/runtime/trackLaneHtml.ts:trackRowHtml'],
            from: 'input', trace: 'ファイルのメタデータ。',
            tests: [],
            gap: { severity: 'P3', why: '「48.0kHz」の書き方が読み値の決まり（plotText.ts）と違い、確かめるテストもない。' },
        },
        {
            id: 'track-header.cursor', value: 'label', what: 'カーソルの時刻、再生の時刻、ループの範囲',
            computedIn: [`${RT}:updateCursorDisplay`, `${RT}:refreshSpectrumViews`, 'src/webview/runtime/playbackDisplay.ts:update', 'src/webview/runtime/waveformInteraction.ts:loopRegionClockText'],
            from: 'input', trace: 'カーソル・再生・ループの位置（利用者の操作）を m:ss.ss で書く。',
            tests: [
                t('src/test/uiSmoke/toolbar.spec.ts', 'the cursor readout is labelled and follows a loop drag to where it was released'),
                t('src/test/playbackDisplay.test.ts', 'createPlaybackDisplay shows the prefixed clock time while playing and hides it when stopped'),
                t('src/test/sharedFormat.test.ts', 'time and channel labels share one implementation'),
            ],
            exception: { rule: 'R7', quote: 'クリックで決めるカーソル（カーソルスペクトルの時刻と解析窓）はこれとは別です。' },
        },
        {
            id: 'track-header.offset', value: 'label', what: 'トラックのずらし（+0.000s）',
            computedIn: [`${RT}:updateOffsetDisplays`],
            from: 'input', trace: '利用者が入れたずらし。',
            tests: [
                t('src/test/renderScript.integration.test.ts', 'renderScript: Enter commits inline offset edit'),
            ],
        },
        {
            id: 'track-header.analysis-window', value: 'label', what: '解析窓の時刻の範囲と長さ（ms）',
            computedIn: [`${RT}:analysisWindowCaption`],
            from: 'whole', trace: 'バックエンドがスライスに付けた窓の始まりと終わり（windowStartNorm / EndNorm）。描くために間引いた形はない。',
            tests: [
                t('src/test/uiSmoke/analysisWindow.spec.ts', 'analysis window band follows the cursor on the waveform only and the header names it'),
            ],
        },
    ],
    knownGaps: {
        'track-header.peak': 'P2',
        'track-header.meta': 'P3',
    },
};
