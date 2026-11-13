import { t, tt, type ChartContract } from '../model';

/** 解析レポート（Markdown） */
export const analysisReport: ChartContract = {
    chart: {
        id: 'analysis-report', name: '解析レポート（Markdown）',
        paintedBy: ['src/shared/report/analysisReport.ts:buildMarkdownReport'],
        requires: ['export'],
    },
    rows: [
        {
            id: 'analysis-report.export', value: 'export', what: 'Markdown のレポートの数（長さ、ピーク、レベル）',
            computedIn: ['src/shared/report/analysisReport.ts:buildMarkdownReport', 'src/shared/report/analysisReport.ts:formatReportDb', 'src/shared/report/analysisReport.ts:reportLevel'],
            from: 'full', trace: 'バックエンドの全サンプルのピークとレベル、ファイルの長さ。',
            tests: [
                tt('src/test/analysisReport.test.ts', 'the markdown report writes every sample\'s peak and level and the file\'s own length, never the envelope thinned to draw it'),
                t('src/test/analysisReport.test.ts', 'markdown report is a pure function of tracks, loop region and time'),
                t('src/test/renderScript.integration.test.ts', 'renderScript: multichannel report lists peak metrics for every channel'),
            ],
        },
    ],
    knownGaps: {},
};
