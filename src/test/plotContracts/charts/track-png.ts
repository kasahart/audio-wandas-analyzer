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
            from: 'axis', trace: '画面の行の Figure（図のサービスの絵）と時間の目盛りのキャンバスを、ページ上の横の位置のまま写す。行の上に録音とチャンネルの名前を書く。新しく数を作らない（数はそれぞれの行の図のとおり）。',
            tests: [
                t('src/test/exportDownloads.test.ts', 'composeTrackCanvases writes a named row\'s recording and channel on a line above it, and puts the ruler over the rows\' plots as the page has it'),
                t('src/test/uiSmoke/laneCulling.spec.ts', 'the PNG export draws every lane: it asks for the spectrograms of lanes out of view and is saved once they are answered, saying so when rows could not be drawn'),
            ],
        },
    ],
    knownGaps: {},
};
