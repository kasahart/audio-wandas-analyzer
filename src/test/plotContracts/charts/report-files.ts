import { t, tt, type ChartContract } from '../model';

/**
 * レポートのフォルダ。報告.csv・定義.json は言葉だけを書く（どの録音を、どの基準と、どの区間で比べたか）。図（図.png、
 * 図.csv）は、比較台に出ている図を図のサービスが書き出したもので、このモジュールは数を作らない
 *。
 */
export const reportFiles: ChartContract = {
    chart: {
        id: 'report-files', name: 'レポートのフォルダ（報告.csv・定義.json は言葉だけ。図は比較台の図の書き出し）',
        paintedBy: ['src/webview/runtime/compareReport.ts:reportCsv'],
        requires: ['export'],
    },
    rows: [
        {
            id: 'report-files.csv', value: 'export', what: '報告.csv（録音、条件、区間、基準の録音、チャンネル、表に出している値、メモ、基準の定義）',
            computedIn: ['src/webview/runtime/compareReport.ts:reportCsv', 'src/webview/runtime/entryBase.ts:regionCells'],
            from: 'input', trace: '入口の表の言葉（録音の名前、CSV のセル、メモ、基準の定義）と利用者の区間。区間は秒で、端が同じ字にならない桁まで書く。解析の値は書かない。',
            tests: [
                t('src/test/benchReport.test.ts', '報告.csv has one row per compared slot, in words only: the recording, its conditions, the region, its base and its memo'),
                t('src/test/benchReport.test.ts', 'with no figure on show a report is of words only: its files are 報告.csv, the Recipe and 定義.json'),
                t('src/test/entryBase.test.ts', 'a region is written as two cells in seconds, finer where its ends would read alike; the whole file as two empty cells'),
            ],
        },
        {
            id: 'report-files.figure', value: 'export', what: '図.png と 図.csv（比較台に出ている図。線の段のすべての答え）と、定義.json のデータの id',
            computedIn: ['src/webview/runtime/compareReport.ts:reportFiles', 'python-backend/figures/service.py:export'],
            from: 'full', trace: '図のサービスが、画面の絵と同じデータの id の答えから、間引かない表を返す。PNG は同じ図の宣言を決まった大きさで描いたもの。webview は受け取った字とバイトをファイルにするだけ。',
            tests: [
                t('src/test/benchReport.test.ts', 'the figure on show goes into the report as it was handed over: its PNG, the table of its lines, and its data id in 定義.json'),
                t('src/test/benchReport.test.ts', 'the module that writes a report makes no number: it reaches no answer, no figure and no canvas'),
                tt('python-backend/test_figures_service.py', 'test_export_has_the_draws_data_id_and_every_point_unthinned_and_refuses_another_id'),
            ],
        },
    ],
    knownGaps: {},
};
