import { t, type ChartContract } from '../model';

/**
 * ペアの図の見出し。図そのもの（利得・位相・γ² の線、読み値、範囲、目盛り、軸の名前）は新しい図の経路にあり、この表の行では
 * ない（docs/figure-list.md）。画面が自分で書くのは見出しの数だけ。
 */
export const pairView: ChartContract = {
    chart: {
        id: 'pair-view', name: 'ペアの図の見出し',
        paintedBy: ['src/webview/runtime/pairSpectrumPanel.ts:writeHeader'],
        requires: ['summary'],
    },
    rows: [
        {
            id: 'pair-view.summary', value: 'summary', what: '見出し（H1・平均回数・時間の範囲）',
            computedIn: ['src/webview/runtime/pairSpectrum.ts:pairHeader', 'src/webview/shell/numberText.ts:secondsSpanText'],
            from: 'whole', trace: 'バックエンドが返した各応答の平均回数（最少）と範囲。（描くために間引いた形はない）',
            tests: [
                t('src/test/pairSpectrum.test.ts', 'the header shows the fewest averages and the whole averaged range, warning below 8'),
            ],
        },
    ],
    knownGaps: {},
};
