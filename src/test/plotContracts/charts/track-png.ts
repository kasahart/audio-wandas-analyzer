import { t, type ChartContract } from '../model';

/** トラック表示の PNG 書き出し */
export const trackPng: ChartContract = {
    chart: {
        id: 'track-png', name: 'トラック表示の PNG 書き出し',
        paintedBy: ['src/webview/runtime/exportDownloads.ts:composeTrackCanvases'],
        requires: ['export'],
    },
    rows: [
        {
            id: 'track-png.export', value: 'export', what: 'PNG に写るレーンの絵と軸の数',
            computedIn: ['src/webview/runtime/exportDownloads.ts:composeTrackCanvases'],
            from: 'axis', trace: '画面のレーンと軸のキャンバスを写す。新しく数を作らない（数はそれぞれのレーンの行のとおり）。',
            tests: [
                t('src/test/uiSmoke/laneCulling.spec.ts', 'the PNG export draws every lane: it asks for the spectrograms of lanes out of view and is saved once they are answered'),
            ],
        },
    ],
    knownGaps: {},
};
