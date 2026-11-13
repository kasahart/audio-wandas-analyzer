import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHARTS, GAP_CEILING, ROWS } from './index';
import type { Source, ValueKind } from './model';

/** The table as a section of docs/plot-contracts.md: the charts, then each one's rows, then the gaps by severity. */
export function renderContractDoc(): string {
    const fromText: Record<Source, string> = { full: '全データ', whole: '描く点が全部（間引かない）', extremes: '間引いた点（区間の最小・最大）', thinned: '間引いた点（平均・切り出し）', axis: '軸の範囲・窓', input: '利用者の値・メタデータ', words: '文字' };
    const kindText: Record<ValueKind, string> = { readout: '読み値', step: '← / →', delta: 'Δ', median: '中央値', headline: '見出し・最大', order: '重ねる順', range: '自動の範囲', ticks: '目盛り', axis: '軸の名前', export: '書き出し', count: '数', summary: '要約の値', label: '入力・設定の表示', identity: 'どのデータか', pending: '届くまでの表示', click: 'クリックが選ぶもの' };
    const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const code = (items: readonly string[]): string => items.map(item => `\`${item.replace(/^src\/|^python-backend\//, '')}\``).join('<br>');
    const lines = [
        '# グラフの数の契約表',
        '',
        'グラフに出る数とグラフから書き出す数の一覧です。どのグラフでも、読み値、← / → の行き先、Δ、中央値、見出しや最大、重ねる順、軸の自動の範囲と目盛り、書き出す数、数や統計は全データから求め、間引いた点は描くためだけに使います（[表示の規則](display-rules.md) R1、R2、R6、R7）。この表は、それぞれの数をどこで計算し、何から求め、どのテストが確かめているかを書きます。',
        '',
        'この文書は `src/test/plotContracts/`（グラフごとに 1 ファイルの `charts/`）から作ります（手で書き換えません）。表を変えたら `npm run compile && node dist/test/plotContracts/render.js` で書き直します。`src/test/plotContracts.test.ts` は次を確かめます。',
        '',
        '- 部品（`paintOverlay`、`paintStage`、`paintSideAxis`）を呼ぶすべての場所と `plotRegistry.ts` の一覧が、どれかのグラフに入っていること。`charts/` のファイルがすべて `index.ts` にあること。',
        '- 表に書いたテストが実在し、飛ばされず、何かを確かめていること。表に書いた関数が実在すること。',
        '- webview と shared の中で数を文字にする関数（`toFixed`、`toPrecision`、`toExponential`、`toLocaleString`、小数の桁に丸める算術（10 の累乗を掛けた値の `Math.round`・`trunc`・`floor`・`ceil`）、それをする関数と、`VALUE_HELPERS` の関数を呼ぶもの）が、表のどれかの行か、`VALUE_HELPERS`、`NOT_CHART_VALUES`（理由つき）にあること。これは数を書く関数の一覧を保つための検査で、プロパティに入れてから後で書く文字までは追いません。グラフの数が間引いた点でないことは、次の型が保証します。',
        '- 間引いた配列（StageView の values・matrix・waveform・events、スライスとスペクトログラムの値、波形の包絡、走査の 192 点のスペクトル）は、webview では型 `Drawn`（`src/shared/provenance.ts`。どの配列かは `protocol_schema.py` の `x-drawn` に一度だけ書く）で、計算・比較・文字にすることをコンパイラが拒みます。読み値・見出し・書き出しが受け取るのは全データの値の型 `Whole` だけです。コンパイラに言えないこと（`Whole` を作れる場所、`Drawn` を数に戻せる場所、キャストや型の絞り込みによる抜け道）は `src/test/provenanceBoundary.test.ts` が型とシンボルで調べ、わざと違反させたコードが必ず失敗することも確かめます。バックエンドは型がないので、`scripts/check_decimation_flow.py` が間引いた値をデータの流れで追い、間引く関数と、間引いた点で計算する関数の使い方（描くだけ／数にする）を `python-backend/drawn_points_contract.json` に書きます。',
        '- 処理部のプロトコル（`protocol_schema.py` から作る `backendProtocolSchema.ts`）の結果の数のフィールドが、すべて表の行か、画面に出ない理由（`schema.ts`）に対応していること。',
        '- 出どころが全データの行は、全データと描いた点が違うデータで確かめるテスト（表の ◆）を挙げること。挙げていない行は穴です。',
        '- 規則が認める例外（`exception`）は、`display-rules.md` のその規則にその文がそのまま書いてあること。',
        '- テストのない行、間引いた点から求める行、軸の名前に量・単位・基準が欠ける行、全データと描いた点を区別するテストのない行は「穴」（gap）で、グラフごとの `knownGaps` と一致し、どの穴もこれらのどれかで止まっていること。穴の数は `GAP_CEILING` 以下で、減らす方向にだけ変えます。',
        '',
        '重さ：P1 は間引いた点から求めた数がそのまま出るもの、P2 は確かめていないか近似のもの、P3 は見た目や書き方だけのものです。「作業中」は、その行を変えているほかのブランチです（この表は main の今を書いています）。',
        '',
        '## グラフ',
        '',
        '| グラフ | 描く・書き出す関数 | 行の数 | 穴 |',
        '| --- | --- | --- | --- |',
        ...CHARTS.map(chart => {
            const rows = ROWS.filter(row => row.chart === chart.id);
            return `| ${cell(chart.name)} (\`${chart.id}\`) | ${code([...chart.paintedBy, ...(chart.registry ?? [])])} | ${rows.length} | ${rows.filter(row => row.gap).length} |`;
        }),
        '',
    ];
    for (const chart of CHARTS) {
        lines.push(`## ${chart.name}`, '', '| 値 | 何の数か | 計算する場所 | 出どころ | テスト | 穴 |', '| --- | --- | --- | --- | --- | --- |');
        for (const row of ROWS.filter(item => item.chart === chart.id)) {
            const tests = row.tests.length ? row.tests.map(test => `${test.tells ? '◆ ' : ''}\`${test.file.replace(/^src\/test\/|^python-backend\//, '')}\` › ${cell(test.name)}`).join('<br>') : 'なし';
            const gap = row.gap ? `**${row.gap.severity}** ${cell(row.gap.why)}` : '';
            const exception = row.exception ? `例外（${row.exception.rule}）：${cell(row.exception.quote)}<br>` : '';
            const breaks = row.breaks ? `守っていない（${row.breaks.rule}）：${cell(row.breaks.quote)}<br>` : '';
            const flight = row.inFlight ? `<br>作業中：\`${row.inFlight}\`` : '';
            lines.push(`| ${kindText[row.value]} | ${cell(row.what)} | ${code(row.computedIn)} | ${fromText[row.from]}：${cell(row.trace)} | ${tests} | ${exception}${breaks}${gap}${flight} |`);
        }
        lines.push('');
    }
    lines.push('## 穴の一覧', '');
    for (const severity of ['P1', 'P2', 'P3'] as const) {
        const gaps = ROWS.filter(row => row.gap?.severity === severity);
        lines.push(`### ${severity}（${gaps.length}、上限 ${GAP_CEILING[severity]}）`, '', ...gaps.map(row => `- \`${row.id}\`：${row.gap?.why ?? ''}${row.inFlight ? `（作業中：\`${row.inFlight}\`）` : ''}`), '');
    }
    return lines.join('\n');
}

export const CONTRACT_DOC = path.join('docs', 'plot-contracts.md');

if (require.main === module) {
    writeFileSync(path.resolve(__dirname, '..', '..', '..', CONTRACT_DOC), renderContractDoc());
}
