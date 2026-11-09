import { t, type ChartContract } from '../model';

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
                t('src/test/analysisReport.test.ts', 'markdown report is a pure function of tracks, loop region and time'),
                t('src/test/renderScript.integration.test.ts', 'renderScript: multichannel report lists peak metrics for every channel'),
            ],
            gap: { severity: 'P2', why: '全データと描いた点が違うデータで確かめるテストがない（今のテストは描いた点でも通る）。' },
        },
    ],
    knownGaps: {
        'analysis-report.export': 'P2',
    },
};
