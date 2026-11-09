import { RT, tt, type ChartContract } from '../model';

/** カーソルスペクトルの CSV 書き出し */
export const spectrumCsv: ChartContract = {
    chart: {
        id: 'spectrum-csv', name: 'カーソルスペクトルの CSV 書き出し',
        paintedBy: ['src/webview/runtime/runtimeExports.ts:buildSpectrumCsv'],
        requires: ['export'],
    },
    rows: [
        {
            id: 'spectrum-csv.export', value: 'export', what: 'CSV の周波数とレベル',
            computedIn: ['src/webview/runtime/runtimeExports.ts:buildSpectrumCsv', `${RT}:writeCsvWhenDetailed`, 'src/webview/runtime/figureModel.ts:frequencyTitle', 'src/webview/runtime/figureModel.ts:titleOf'],
            from: 'full', trace: 'トラックの中では、バックエンドの全ビンの行だけを書く。表示用に切った行は待つか、書かずにそう言う。',
            tests: [
                tt('src/test/renderScript.integration.test.ts', 'renderScript: export-csv replaces a cursor spectrum cut for display with every FFT bin'),
                tt('src/test/runtimeExports.test.ts', 'spectrum CSV writes every FFT bin of a whole row at fs / n_fft spacing'),
            ],
        },
    ],
    knownGaps: {},
};
