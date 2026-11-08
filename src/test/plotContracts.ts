/**
 * The plot contract table: every chart the webview shows or exports, and for each every value a user reads off it
 * (a readout, an arrow key's step, a Δ, a median, a headline, the overlay's order, an axis's auto range and ticks, the
 * axes' names, an exported number, a count): where it is computed, what data it is computed from, and the tests that
 * hold it to that. docs/plot-contracts.md is rendered from it (renderContractDoc); plotContracts.test.ts holds the
 * table to the code: every chart and every function that writes a number is in it, every test it names exists and
 * checks something, and every row that is not yet held (a gap) is in KNOWN_GAPS, which only shrinks.
 *
 * Rows are recorded against main as it is; a row another branch is changing names that branch (`inFlight`).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export type Severity = 'P1' | 'P2' | 'P3';

/** What a value is computed from. */
export type Source =
    /** Every bin, sample, frame or row of the data (the backend's Frame, or arrays the webview holds whole). */
    | 'full'
    /** What is drawn is every point (bars, every bin, a histogram's bins, each member): nothing was thinned. */
    | 'whole'
    /** Points thinned to be drawn that keep each bucket's lowest and highest: the extremes are the full data's. */
    | 'extremes'
    /** Points thinned to be drawn by averaging (power-averaged cells, a display cut): not the full data's values. */
    | 'thinned'
    /** The axis's range or window on screen, not the data (ticks, a range popover's fields). */
    | 'axis'
    /** A value the user set or the file's metadata (a region, an offset, a threshold, a sample rate). */
    | 'input'
    /** Words: an axis's name. */
    | 'words';

export type ValueKind = 'readout' | 'step' | 'delta' | 'median' | 'headline' | 'order' | 'range' | 'ticks' | 'axis' | 'export' | 'count' | 'summary' | 'label';

export interface TestRef { file: string; name: string }

export interface ContractRow {
    /** `<chart>.<value>`, unique. */
    id: string;
    chart: string;
    value: ValueKind;
    /** What the user reads (Japanese, as docs/display-rules.md). */
    what: string;
    /** Where it is computed: `src/…ts:function` (a webview or shared function) or `python-backend/…py:function`. */
    computedIn: readonly string[];
    from: Source;
    /** How it gets there, traced through the code. */
    trace: string;
    tests: readonly TestRef[];
    /** An axis's name: whether it says the quantity, its unit, and for dB its reference. */
    names?: { quantity: boolean; unit: boolean; reference?: boolean };
    /** Not yet held: why, and how a strict reviewer would rate it. KNOWN_GAPS lists every one. */
    gap?: { severity: Severity; why: string };
    /** Another branch is changing this row. */
    inFlight?: string;
}

export interface Chart {
    id: string;
    name: string;
    /** The functions that draw or write it (`src/…ts:function`): every call of the plot component is in one chart. */
    paintedBy: readonly string[];
    /** Canvases plotRegistry.ts lists (PLOTS_PENDING) that are this chart's. */
    registry?: readonly string[];
    /** The kinds of value the chart must have rows for. */
    requires: readonly ValueKind[];
}

const t = (file: string, name: string): TestRef => ({ file, name });
const SP = 'src/webview/runtime/stagePanes.ts';
const RT = 'src/webview/runtime/comparisonRuntime.ts';

/** The tests of the shared readout and ← / → (stagePanes.ts stageHover / stageStep over fullRead.ts). */
const SHARED_READ = [
    t('src/test/fullRead.test.ts', 'every line and image a plot draws says where its full data is read; bars are whole (R7)'),
    t('src/test/stagePanes.test.ts', 'the pointer reads the point nearest it within a few pixels, so a narrow peak beside it is read at its top (R7)'),
];
const SHARED_STEP = [
    t('src/test/plotHoverLayer.test.ts', 'an arrow key reads the next point of the line read, as the pointer on it would; with none read, the plot\'s left edge (R7)'),
    t('src/test/fullRead.test.ts', 'an arrow key crosses silent points past one fetched window to the next point with a value (R7)'),
];
const SHARED_ORDER = [
    t('src/test/stagePanes.test.ts', 'every plot draws its overlaid lines loudest first and the quietest last on top, whatever order the caller gives them (R6)'),
    t('src/test/stagePanes.test.ts', 'the order comes from every value before thinning, never from the points drawn (R2, R6)'),
    t('src/test/uiSmoke/plotContract.spec.ts', 'every ui-smoke test fails on a plot on screen that drew a louder compared line over a quieter one (R6)'),
];
const TICKS = [
    t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1'),
    t('src/test/laneAxes.test.ts', 'the lanes take the ticks and their text from the rules every plot uses'),
];
const STAGE_TICKS = [`${SP}:paintPlot`, `${SP}:valueAxisTicks`, `${SP}:valueTickTexts`, `${SP}:alongAxisTicks`, `${SP}:rowAxisTicks`, `${SP}:tickText`, `${SP}:levelTick`, `${SP}:paintRightAxis`];

export const CHARTS: readonly Chart[] = [
    { id: 'compare-overlay', name: '比較台の重ね図（トリガーのイベント図を含む）', paintedBy: ['src/webview/runtime/trackStagePainter.ts:paintStageOverlay', 'src/webview/runtime/trackStagePainter.ts:paintNoPicture'], requires: ['readout', 'step', 'order', 'range', 'ticks', 'axis', 'median'] },
    { id: 'compare-delta', name: '比較台の Δ 欄', paintedBy: ['src/webview/runtime/trackStagePainter.ts:paintStageOverlay'], requires: ['readout', 'step', 'delta', 'headline', 'range', 'ticks', 'axis'] },
    { id: 'compare-lanes', name: '比較台の横並びのレーン', paintedBy: ['src/webview/runtime/trackStagePainter.ts:paintStageLanes', 'src/webview/runtime/trackStagePainter.ts:paintNoStage'], requires: ['readout', 'step', 'range', 'ticks', 'axis'] },
    { id: 'trigger-lanes', name: 'トリガーのイベント図の下のレーン', paintedBy: ['src/webview/runtime/triggerLanes.ts:paintTriggerLanes'], requires: ['readout', 'step', 'range', 'ticks', 'axis', 'count'] },
    { id: 'track-waveform', name: 'トラックの波形レーン', paintedBy: [`${RT}:drawTrackWaveform`], requires: ['readout', 'step', 'range', 'ticks', 'axis'] },
    { id: 'track-spectrogram', name: 'トラックのスペクトログラムのレーン', paintedBy: ['src/webview/runtime/trackCanvasPainter.ts:paintTrackSpectrogram', `${RT}:drawSpectrogram`], requires: ['readout', 'step', 'range', 'ticks', 'axis'] },
    { id: 'track-axes', name: 'トラックのレーンの軸（振幅・周波数の軸、上の時間の目盛り）', paintedBy: [`${RT}:renderRuler`, `${SP}:paintSideAxis`], registry: ['.track-axis-canvas:not(.track-spec-axis)', '.track-spec-axis', '#ruler-canvas'], requires: ['ticks', 'axis'] },
    { id: 'track-header', name: 'トラックの見出しとツールバーの数（カーソルの時刻、ずらし、ピーク、解析窓）', paintedBy: ['src/webview/runtime/calibrationDecorations.ts:channelMetricSummaryHtml', `${RT}:updateCursorDisplay`], requires: ['summary', 'label'] },
    { id: 'track-png', name: 'トラック表示の PNG 書き出し', paintedBy: ['src/webview/runtime/exportDownloads.ts:composeTrackCanvases'], requires: ['export'] },
    { id: 'cursor-spectrum', name: 'カーソルスペクトル', paintedBy: ['src/webview/runtime/overlaySpectrumPainter.ts:paintOverlaySpectrum', `${RT}:renderOverlaySpectrum`], requires: ['readout', 'step', 'order', 'range', 'ticks', 'axis'] },
    { id: 'spectrum-csv', name: 'カーソルスペクトルの CSV 書き出し', paintedBy: ['src/webview/runtime/runtimeExports.ts:buildSpectrumCsv'], requires: ['export'] },
    { id: 'pair-view', name: 'ペアの図（利得・位相・γ²）', paintedBy: ['src/webview/runtime/pairSpectrumPanel.ts:render'], requires: ['readout', 'step', 'order', 'range', 'ticks', 'axis', 'summary'] },
    { id: 'colour-bar', name: 'カラーバー（比較台の熱図、スペクトログラムのレーン、入口の概観帯）', paintedBy: [`${SP}:paintColourBar`], requires: ['ticks', 'axis'] },
    { id: 'entry-held', name: '入口の保持図（スロットの Δ、手順の有無の Δ、平均スペクトル）', paintedBy: ['src/webview/runtime/entryHeldPlot.ts:paintView'], requires: ['readout', 'step', 'delta', 'range', 'ticks', 'axis'] },
    { id: 'entry-overview', name: '入口の概観帯', paintedBy: ['src/webview/runtime/entryPlots.ts:paintOverview'], requires: ['readout', 'step', 'range', 'ticks', 'axis'] },
    { id: 'entry-distribution', name: '入口の分布図（群ごとの行と下の値の軸）', paintedBy: ['src/webview/runtime/entryDistributionPane.ts:paint'], requires: ['readout', 'step', 'count', 'median', 'range', 'ticks', 'axis'] },
    { id: 'entry-table', name: '入口の表（値の列、Δ、見出しの数、D の差、表の CSV）', paintedBy: ['src/webview/runtime/entryTableHtml.ts:datasetRowsHtml', 'src/webview/runtime/entryTable.ts:entryCsv'], requires: ['summary', 'delta', 'count', 'export'] },
    { id: 'report-overlay', name: 'レポートの重ね図（比較 n.png、要約.png の上段）', paintedBy: ['src/webview/runtime/compareReport.ts:paintOverlayFigure'], requires: ['headline', 'order', 'range', 'ticks', 'axis'] },
    { id: 'report-delta', name: 'レポートの Δ 図（差 n.png、要約.png の下段）', paintedBy: ['src/webview/runtime/compareReport.ts:paintDeltaFigure'], requires: ['headline', 'range', 'ticks', 'axis'] },
    { id: 'report-files', name: 'レポートの 要約.png の頭書き・報告.csv・定義.json', paintedBy: ['src/webview/runtime/compareReport.ts:summaryPng', 'src/webview/runtime/compareReport.ts:reportCsv'], requires: ['export', 'label'] },
    { id: 'analysis-report', name: '解析レポート（Markdown）', paintedBy: ['src/shared/report/analysisReport.ts:buildMarkdownReport'], requires: ['export'] },
];

export const ROWS: readonly ContractRow[] = [
    // ── 比較台の重ね図 ──
    {
        id: 'compare-overlay.readout', chart: 'compare-overlay', value: 'readout', what: '線の読み値（位置と値）',
        computedIn: [`${SP}:stageHover`, `${SP}:lineRead`, `${SP}:atValue`, `${SP}:atText`, `${SP}:timeText`, 'src/webview/runtime/trackStagePainter.ts:overlayLayers', 'python-backend/full_read.py:read_line'],
        from: 'full', trace: '各層の full は stageReader.of（compare-combine の read）。バックエンドが保持した段の全ビン・全サンプルからマウスのまわりの窓を返す（full_read.py）。描いた間引きの線は読まない。',
        tests: [...SHARED_READ, t('src/test/uiSmoke/narrowFeatures.spec.ts', 'a hover and the arrow keys on the thinned whole spectrum read its real bins from the backend, one bin per key, each at its exact value (R7)'), t('python-backend/test_full_read.py', 'test_a_recordings_spectrum_is_read_at_its_own_bins_not_its_picture'), t('python-backend/test_full_read.py', 'test_a_signals_samples_are_read_one_by_one')],
    },
    {
        id: 'compare-overlay.readout-image', chart: 'compare-overlay', value: 'readout', what: '熱図（スペクトログラム、ラフネス、ケプストログラム）の読み値',
        computedIn: [`${SP}:imageHover`, `${SP}:cellRead`, 'python-backend/full_read.py:read_cells'],
        from: 'full', trace: '熱図の層の full は stageReader.of の cells。バックエンドが本当のマス（1 フレーム・1 ビン）を返す。描くための平均したマスは読まない。',
        tests: [t('src/test/fullRead.test.ts', 'a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7)'), t('python-backend/test_full_read.py', 'test_an_images_cells_are_its_own_around_the_place_read')],
    },
    {
        id: 'compare-overlay.readout-bands', chart: 'compare-overlay', value: 'readout', what: '1/3 オクターブ帯（棒）の読み値',
        computedIn: [`${SP}:lineRead`, 'python-backend/stage_view.py:_noct_view'],
        from: 'whole', trace: '帯は間引かない（NOctFrame の全帯）。棒は描いた値がそのまま全部の値で、full がなくても描いた値を読む。',
        tests: [SHARED_READ[0], t('src/test/uiSmoke/trackCompare.spec.ts', 'the comparison shows a step\'s bands as bars, and hides the lanes\' own controls')],
    },
    {
        id: 'compare-overlay.readout-events', chart: 'compare-overlay', value: 'readout', what: 'トリガーのイベントごとの線の読み値（#n @ 時刻）',
        computedIn: [`${SP}:eventLayers`, 'src/webview/runtime/stageReader.ts:createStageReader'],
        from: 'full', trace: 'eventLayers がイベントごとに layer.full.event(id) を付け、stageReader が read に event を入れて頼む。バックエンドはそのイベントの全サンプルを返す。',
        tests: [],
        gap: { severity: 'P2', why: 'イベントの線の読み値と ← / → がそのイベントの全サンプルから来ることを確かめるテストがない（ジェスチャのテストは数字の出どころを見ない）。' },
    },
    {
        id: 'compare-overlay.step', chart: 'compare-overlay', value: 'step', what: '← / → で進む先（次のビン・サンプル・フレーム）',
        computedIn: [`${SP}:stageStep`, `${SP}:imageStep`, `${SP}:stageNeighbour`, 'src/webview/runtime/fullRead.ts:fetchedSource'],
        from: 'full', trace: 'full のある層は、読んだ点の先 256 点（STEP_AHEAD）を全データから取り寄せ、次の本当の点を読む。棒は描いた次の値。',
        tests: [...SHARED_STEP, t('src/test/uiSmoke/narrowFeatures.spec.ts', 'a hover and the arrow keys on the thinned whole spectrum read its real bins from the backend, one bin per key, each at its exact value (R7)')],
        inFlight: 'claude/contract-step-click',
    },
    {
        id: 'compare-overlay.median', chart: 'compare-overlay', value: 'median', what: '基準の群の中央値の線（とその読み値）',
        computedIn: ['python-backend/stage_combine.py:combine', 'src/webview/runtime/stageReader.ts:createStageReader'],
        from: 'full', trace: 'バックエンドが群の各録音の全ビン・全サンプルから中央値をとり、そのあとで描くために間引く。読み値は combined(…, \'base\') で中央値の全データを読む。',
        tests: [t('python-backend/test_stage_combine.py', 'test_a_groups_median_is_taken_bin_by_bin_before_it_is_drawn'), t('python-backend/test_full_read.py', 'test_a_medians_read_stops_where_its_picture_was_aligned_with_the_compared_one')],
    },
    {
        id: 'compare-overlay.order', chart: 'compare-overlay', value: 'order', what: '重ねる順（静かな線が上）',
        computedIn: [`${SP}:overlayOrder`, `${SP}:byLevel`, `${SP}:drawnLevelsText`, `${SP}:paintPlot`, 'python-backend/stage_combine.py:level_bins'],
        from: 'full', trace: '各線の levelBins（軸を 256 区間に分けた各区間のパワーと数）をバックエンドが間引く前の全ビン・全サンプルから作り、部品が画面に見えている区間で比べる。',
        tests: [...SHARED_ORDER, t('python-backend/test_stage_combine.py', 'test_every_compared_level_line_carries_level_bins_whole_zoomed_and_as_a_median'), t('python-backend/test_stage_combine.py', 'test_a_spectrums_level_bins_are_every_bins_power_not_the_drawn_points')],
        inFlight: 'claude/level-order-exact',
    },
    {
        id: 'compare-overlay.range', chart: 'compare-overlay', value: 'range', what: '線の値の軸の自動の範囲',
        computedIn: [`${SP}:stageRange`, `${SP}:roundEdge`, 'src/webview/runtime/trackStagePainter.ts:paintStageOverlay', 'src/webview/plot/waveformLayer.ts:waveformRange'],
        from: 'extremes', trace: 'stageRange は粗い絵（coarsePlots：各区間の最小と最大に間引いた線）の値の端から決める。最小・最大は全データと同じだが、時間信号以外では全データから求めていない（時間信号は absolutePeak）。',
        tests: [t('src/test/stagePanes.test.ts', 'levels share a range of four round steps; coherence keeps 0 to 1')],
        gap: { severity: 'P2', why: '範囲の端を間引いた線から求めている。間引きが端を残すので同じ値のはずだが、範囲が全データの端と一致することを確かめるテストがない。' },
    },
    {
        id: 'compare-overlay.range-image', chart: 'compare-overlay', value: 'range', what: '熱図の色の自動の範囲（カラーバーの両端の数）',
        computedIn: [`${SP}:stageRange`, `${SP}:robustEdge`, 'python-backend/stage_view.py:_spectrogram_view'],
        from: 'thinned', trace: '熱図の matrix は時間のブロックごとにパワー平均したマス（_spectrogram_view、_roughness_view、_cepstrogram_view）。stageRange（ケプストログラムは robustEdge の 99 パーセント点）はその平均したマスから求め、カラーバーの両端に数として出る。',
        tests: [],
        gap: { severity: 'P1', why: 'カラーバーの両端の数が、描くために平均したマスから来る。短く強いマスは平均で下がり、範囲の外に出る。' },
    },
    { id: 'compare-overlay.ticks', chart: 'compare-overlay', value: 'ticks', what: '両軸の目盛りの値', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲（または窓）から部品が決める。データには触れない。', tests: TICKS },
    {
        id: 'compare-overlay.axis', chart: 'compare-overlay', value: 'axis', what: '両軸の名前（レベル・振幅・周波数・時間・帯・ラグ・ケフレンシー）',
        computedIn: [`${SP}:stageAxes`, `${SP}:amplitudeAxisTitle`, 'src/webview/runtime/comparePanes.ts:paneAxes'],
        from: 'words', trace: 'stageAxes が Frame の種類と単位と校正から名前を作る。dB は wandas のレベル基準で書く。',
        tests: [t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files'), t('src/test/comparePanes.test.ts', 'the level axis is named by wandas\' level reference, and says uncalibrated from the calibration status, not the unit'), t('src/test/stagePanes.test.ts', 'a cross-channel picture names its pair on the value axis: the channel over its reference')],
        names: { quantity: true, unit: true, reference: true },
        inFlight: 'claude/axis-quantity-unit',
    },
    {
        id: 'compare-overlay.axis-metric', chart: 'compare-overlay', value: 'axis', what: '単位で名前の決まらない指標の値の軸（「値 [unit]」）',
        computedIn: [`${SP}:stageAxes`, `${SP}:metricName`],
        from: 'words', trace: 'metricName は sone・acum・asper・dB 以外の単位を「値」とだけ書く。単位がなければ「値」だけになる。',
        tests: [t('src/test/stagePanes.test.ts', 'a metric over time names what it measures on its value axis, from its unit')],
        names: { quantity: false, unit: true },
        gap: { severity: 'P2', why: '量の名前がない（「値」）。単位もない指標では量も単位も書かれない。' },
        inFlight: 'claude/axis-quantity-unit',
    },
    {
        id: 'compare-overlay.axis-cepstrum', chart: 'compare-overlay', value: 'axis', what: 'ケプストラムの値の軸（「実ケプストラム」）',
        computedIn: [`${SP}:stageAxes`],
        from: 'words', trace: 'axisCepstrum は量だけで単位を書かない（無次元）。',
        tests: [t('src/test/stagePanes.test.ts', 'a cepstrum is drawn on a quefrency axis, symmetric about zero without its zero-quefrency coefficient')],
        names: { quantity: true, unit: false },
        gap: { severity: 'P3', why: '無次元の量に単位の表記がない（「[-]」などがない）。' },
    },
    {
        id: 'compare-overlay.headline', chart: 'compare-overlay', value: 'headline', what: '上の行の注記（トリガーのイベント数、区間）',
        computedIn: ['src/webview/runtime/trackStagePainter.ts:stageModeHeadline', `${SP}:stageEventCounts`],
        from: 'full', trace: 'イベント数はバックエンドが切り出した全イベント（view.events）の数。区間は利用者が決めた値。差は書かない。',
        tests: [t('src/test/trackStagePainter.test.ts', 'the headline names no difference (the row holds the pointer\'s readout): the steps bypassed and the region; nothing while computing'), t('src/test/uiSmoke/trackCompare.spec.ts', 'a trigger added from ＋ fires at half the tracks\' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events')],
    },
    {
        id: 'compare-overlay.region', chart: 'compare-overlay', value: 'label', what: '区間の印と名札（「区間 a–b s」）',
        computedIn: ['src/webview/runtime/trackStageMode.ts:paintNow', `${SP}:paintRegion`],
        from: 'input', trace: '区間のチップで決めた値を書く。',
        tests: [t('src/test/uiSmoke/trackCompare.spec.ts', 'a region set with its chip compares only that part of the files, shows on the plots, and holding a step shows the comparison without it')],
    },
    // ── 比較台の Δ 欄 ──
    {
        id: 'compare-delta.delta', chart: 'compare-delta', value: 'delta', what: 'Δ（比較 − 基準）の値そのもの',
        computedIn: ['python-backend/stage_combine.py:combine'],
        from: 'full', trace: 'バックエンドが全ビン・全サンプルで引いてから描くために間引く。単位や校正やサンプリング周波数が違えば出さない。',
        tests: [t('python-backend/test_stage_combine.py', 'test_a_narrow_difference_is_taken_bin_by_bin_and_kept_when_drawn'), t('python-backend/test_stage_combine.py', 'test_a_time_signals_difference_is_compare_minus_base_sample_by_sample'), t('python-backend/test_stage_combine.py', 'test_values_in_other_units_have_no_difference_whatever_the_frame')],
    },
    {
        id: 'compare-delta.readout', chart: 'compare-delta', value: 'readout', what: 'Δ の読み値',
        computedIn: [`${SP}:lineRead`, `${SP}:cellRead`, 'src/webview/runtime/stageReader.ts:createStageReader', 'python-backend/full_read.py:read_line'],
        from: 'full', trace: 'Δ の層の full は stageReader.combined(base, compare, \'diff\')。バックエンドが全データの Δ からマウスのまわりを返す。',
        tests: [t('python-backend/test_full_read.py', 'test_a_difference_is_read_bin_by_bin'), SHARED_READ[0]],
    },
    { id: 'compare-delta.step', chart: 'compare-delta', value: 'step', what: 'Δ の ← / → で進む先', computedIn: [`${SP}:stageStep`], from: 'full', trace: '読み値と同じ全データの Δ の次の点。', tests: [...SHARED_STEP, t('python-backend/test_full_read.py', 'test_a_difference_is_read_bin_by_bin')], inFlight: 'claude/contract-step-click' },
    {
        id: 'compare-delta.headline', chart: 'compare-delta', value: 'headline', what: 'Δ の見出し（差が最大の位置と値）',
        computedIn: [`${SP}:stageHeadline`, 'src/webview/runtime/trackStagePainter.ts:paintStageOverlay'],
        from: 'thinned', trace: 'stageHeadline は描く Δ の絵（plots.diff：間引いた線、熱図はブロックごとに平均したマス）の中で |Δ| が最大の点を探す。線は区間の最小・最大を残すので値は同じことが多いが、位置はその区間の点で、熱図では平均した値になる。',
        tests: [t('src/test/stagePanes.test.ts', 'the Δ pane\'s headline names where the difference drawn is largest')],
        gap: { severity: 'P1', why: '見出しの最大値と位置を描いた（間引いた）Δ から求めている。今のテストは「描いた Δ の最大」を確かめていて、全データの最大とは比べていない。' },
        inFlight: 'claude/maxdelta-full',
    },
    {
        id: 'compare-delta.range', chart: 'compare-delta', value: 'range', what: 'Δ の軸の自動の範囲（線）',
        computedIn: [`${SP}:stageDiffRange`, `${SP}:roundEdge`],
        from: 'extremes', trace: 'stageDiffRange は粗い Δ の絵（各区間の最小と最大）の端から ± を決める。',
        tests: [],
        gap: { severity: 'P2', why: '範囲を間引いた Δ から求めている。全データの Δ の端と一致することを確かめるテストがない。' },
    },
    {
        id: 'compare-delta.range-image', chart: 'compare-delta', value: 'range', what: 'Δ の熱図の色の範囲（カラーバーの両端）',
        computedIn: [`${SP}:stageDiffRange`],
        from: 'thinned', trace: 'Δ の熱図の matrix はブロックごとに平均したマスで、その端を両端の数にする。',
        tests: [],
        gap: { severity: 'P1', why: 'カラーバーの両端の数を、描くために平均した Δ のマスから求めている。' },
    },
    { id: 'compare-delta.ticks', chart: 'compare-delta', value: 'ticks', what: 'Δ の軸の目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める。', tests: TICKS },
    {
        id: 'compare-delta.axis', chart: 'compare-delta', value: 'axis', what: 'Δ の軸の名前（「Δ [dB]」）',
        computedIn: [`${SP}:stageAxes`],
        from: 'words', trace: 'dB の Δ は axisDelta（「Δ [dB]」）。何の Δ か（量）と基準を書かない。dB でない量は「Δ 量 [単位]」。',
        tests: [t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files')],
        names: { quantity: false, unit: true, reference: false },
        gap: { severity: 'P2', why: '「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。' },
        inFlight: 'claude/axis-quantity-unit',
    },
    {
        id: 'compare-delta.no-delta', chart: 'compare-delta', value: 'label', what: 'Δ が出せない理由（見出しと図）',
        computedIn: ['src/webview/runtime/combineSource.ts:noDeltaNote'],
        from: 'input', trace: 'サンプリング周波数・単位・データの大きさの違いを理由として書く。数は出さない。',
        tests: [t('src/test/trackStagePainter.test.ts', 'with no difference, the Δ headline says the same reason as its plot: other rates, other units, too much data')],
    },
    // ── 比較台の横並びのレーン ──
    {
        id: 'compare-lanes.readout', chart: 'compare-lanes', value: 'readout', what: '各レーンの読み値',
        computedIn: [`${SP}:stageHover`, `${SP}:lineRead`, `${SP}:cellRead`, 'src/webview/runtime/trackStagePainter.ts:paintStageLanes'],
        from: 'full', trace: '重ね図と同じ fullOf（stageReader.of）を各レーンの層に付ける。',
        tests: [...SHARED_READ, t('src/test/trackStagePainter.test.ts', 'side by side, every lane draws its own picture and says it shows the step; the base measured against says so')],
    },
    { id: 'compare-lanes.step', chart: 'compare-lanes', value: 'step', what: '各レーンの ← / →', computedIn: [`${SP}:stageStep`], from: 'full', trace: '重ね図と同じ。', tests: SHARED_STEP, inFlight: 'claude/contract-step-click' },
    {
        id: 'compare-lanes.range', chart: 'compare-lanes', value: 'range', what: 'レーンが共有する値の軸の範囲（線）',
        computedIn: [`${SP}:stageRange`, 'src/webview/runtime/trackStagePainter.ts:paintStageLanes'],
        from: 'extremes', trace: '全レーンの粗い絵（各区間の最小と最大）から 1 つの範囲を決める。',
        tests: [],
        gap: { severity: 'P2', why: '範囲を間引いた線から求めている。全データの端と一致することを確かめるテストがない。' },
    },
    {
        id: 'compare-lanes.range-image', chart: 'compare-lanes', value: 'range', what: '熱図のレーンの色の範囲（カラーバーの両端）',
        computedIn: [`${SP}:stageRange`],
        from: 'thinned', trace: '重ね図の熱図と同じく、ブロックごとに平均したマスから求める。',
        tests: [],
        gap: { severity: 'P1', why: 'カラーバーの両端の数を、描くために平均したマスから求めている。' },
    },
    { id: 'compare-lanes.ticks', chart: 'compare-lanes', value: 'ticks', what: '各レーンの目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める。', tests: TICKS },
    { id: 'compare-lanes.axis', chart: 'compare-lanes', value: 'axis', what: '各レーンの両軸の名前', computedIn: [`${SP}:stageAxes`], from: 'words', trace: '重ね図と同じ stageAxes。', tests: [t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files')], names: { quantity: true, unit: true, reference: true }, inFlight: 'claude/axis-quantity-unit' },
    // ── トリガーの下のレーン ──
    {
        id: 'trigger-lanes.readout', chart: 'trigger-lanes', value: 'readout', what: 'イベント図の下のレーン（録音の時間信号）の読み値',
        computedIn: [`${SP}:lineRead`, 'src/webview/runtime/triggerLanes.ts:paintTriggerLanes'],
        from: 'full', trace: 'frame.fullOf（stageReader.of）で録音の全サンプルを読む。',
        tests: [t('src/test/uiSmoke/plotContract.spec.ts', 'a trigger\'s events plot and the lanes under it answer the same gestures as every plot (R13)'), t('python-backend/test_full_read.py', 'test_a_signals_samples_are_read_one_by_one')],
    },
    { id: 'trigger-lanes.step', chart: 'trigger-lanes', value: 'step', what: 'レーンの ← / →', computedIn: [`${SP}:stageStep`], from: 'full', trace: '全サンプルの次の点。', tests: SHARED_STEP, inFlight: 'claude/contract-step-click' },
    {
        id: 'trigger-lanes.range', chart: 'trigger-lanes', value: 'range', what: 'レーンの振幅の範囲（しきい値を含む）',
        computedIn: ['src/webview/runtime/triggerLanes.ts:paintTriggerLanes', `${SP}:stageRange`, 'src/webview/plot/waveformLayer.ts:waveformRange'],
        from: 'full', trace: '時間信号は absolutePeak（全サンプルの絶対値の最大）の ±1.05 倍に、しきい値が入るよう広げる。',
        tests: [],
        gap: { severity: 'P2', why: 'レーンの範囲が全サンプルのピークとしきい値を含むことを確かめるテストがない。' },
    },
    { id: 'trigger-lanes.ticks', chart: 'trigger-lanes', value: 'ticks', what: 'レーンの目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める。', tests: TICKS },
    { id: 'trigger-lanes.axis', chart: 'trigger-lanes', value: 'axis', what: 'レーンの両軸の名前', computedIn: [`${SP}:stageAxes`, `${SP}:amplitudeAxisTitle`], from: 'words', trace: '振幅（単位、未校正）と時間。', tests: [t('src/test/uiSmoke/plotContract.spec.ts', 'a trigger\'s events plot and the lanes under it answer the same gestures as every plot (R13)')], names: { quantity: true, unit: true } },
    {
        id: 'trigger-lanes.count', chart: 'trigger-lanes', value: 'count', what: '使ったイベントの数と全体の数（角の表示）、しきい値の名札',
        computedIn: ['src/webview/runtime/triggerLanes.ts:paintTriggerLanes'],
        from: 'full', trace: '数はバックエンドが切り出した全イベントと除いたものの数。しきい値は利用者の値。',
        tests: [t('src/test/uiSmoke/trackCompare.spec.ts', 'a trigger added from ＋ fires at half the tracks\' peak, draws each event of each recording over the time from its trigger, and is followed only by what takes events')],
    },
    // ── トラックの波形レーン ──
    {
        id: 'track-waveform.readout', chart: 'track-waveform', value: 'readout', what: '波形レーンの読み値（名前・時刻・振幅）',
        computedIn: ['src/webview/runtime/trackLaneHover.ts:laneReadoutText', `${SP}:lineRead`, 'src/webview/runtime/laneReads.ts:createLaneReads', 'python-backend/analysis_service.py:waveform_range'],
        from: 'full', trace: 'laneReads.waveform がファイルの全サンプルからマウスのまわりを取り寄せる。描いた包絡は読まない。',
        tests: [t('src/test/trackLaneHover.test.ts', 'the pointer on a track lane reads the file\'s own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)'), t('src/test/fullRead.test.ts', 'a dense waveform is read at its real samples: a sample not drawn, and every sample by the arrow keys (R7)'), t('python-backend/test_full_read.py', 'test_a_lane_reads_its_files_own_samples_and_stft_cells')],
    },
    { id: 'track-waveform.step', chart: 'track-waveform', value: 'step', what: '波形レーンの ← / →（1 サンプルずつ）', computedIn: [`${SP}:stageStep`], from: 'full', trace: '全サンプルの次の点。', tests: [t('src/test/trackLaneHover.test.ts', 'the pointer on a track lane reads the file\'s own sample nearest it, not the envelope drawn, and ← / → every sample in turn (R7)'), t('src/test/trackPointerEvents.test.ts', 'a lane with the keyboard focus keeps ← / → for its time cursor, even with the pointer on it; the pointer on another lane steps that one\'s readout (R7)')], inFlight: 'claude/contract-step-click' },
    {
        id: 'track-waveform.range', chart: 'track-waveform', value: 'range', what: '振幅の軸の範囲',
        computedIn: [`${RT}:laneAmplitudeAxis`, `${RT}:amplitudeScaleFor`, 'src/webview/runtime/laneAxes.ts:laneAmplitudeRange', 'python-backend/decimator.py:decimated_waveform'],
        from: 'full', trace: 'absolutePeak（全サンプルの絶対値の最大、間引く前に求める）か、つないだ録音で共有するピークから決める。',
        tests: [t('python-backend/test_decimator.py', 'test_absolute_peak'), t('src/test/laneAxes.test.ts', 'a waveform lane\'s amplitude ticks sit where the waveform draws their values, zoomed or not')],
    },
    { id: 'track-waveform.ticks', chart: 'track-waveform', value: 'ticks', what: '振幅の目盛り', computedIn: ['src/webview/runtime/laneAxes.ts:laneAmplitudeTicks', `${SP}:valueAxisTicks`], from: 'axis', trace: '範囲から、どのグラフとも同じ規則で決める。', tests: [t('src/test/laneAxes.test.ts', 'a waveform lane\'s amplitude ticks sit where the waveform draws their values, zoomed or not'), TICKS[1]] },
    { id: 'track-waveform.axis', chart: 'track-waveform', value: 'axis', what: '振幅の軸の名前', computedIn: [`${SP}:amplitudeAxisTitle`, `${RT}:laneAmplitudeAxis`], from: 'words', trace: '量・単位・校正を比較台の波形と同じく書く。', tests: [t('src/test/laneAxes.test.ts', 'a lane axis names its quantity, unit and calibration as Compare\'s waveform axis does')], names: { quantity: true, unit: true } },
    {
        id: 'track-waveform.range-popover', chart: 'track-waveform', value: 'range', what: '軸のダブルクリックで開く範囲の欄の値（振幅・スペクトログラムの周波数と色）',
        computedIn: [`${RT}:field`],
        from: 'axis', trace: '今描いている範囲を有効数字 4 桁で書く。',
        tests: [t('src/test/uiSmoke/waveformAmplitudeRange.spec.ts', 'double-clicking the waveform amplitude axis sets the vertical range from a popover')],
    },
    // ── トラックのスペクトログラムのレーン ──
    {
        id: 'track-spectrogram.readout', chart: 'track-spectrogram', value: 'readout', what: 'スペクトログラムのレーンの読み値（時刻・周波数・レベル）',
        computedIn: ['src/webview/runtime/trackLaneHover.ts:spectrogramReadoutText', `${SP}:cellRead`, 'src/webview/runtime/laneReads.ts:createLaneReads'],
        from: 'full', trace: 'laneReads.spectrogram が本当の STFT のマスを取り寄せる。描くための平均したマスは読まない。',
        tests: [t('src/test/trackLaneHover.test.ts', 'the pointer on a spectrogram lane reads the real STFT cell under it, not the cell averaged to draw it, and ← / → the next frame (R7)'), t('src/test/uiSmoke/spectrogramZoom.spec.ts', 'a spectrogram lane boxed to a narrow band asks for that band\'s own bins and draws and reads them, not the whole range\'s rows stretched (R3)')],
    },
    { id: 'track-spectrogram.step', chart: 'track-spectrogram', value: 'step', what: 'スペクトログラムの ← / →（次のフレーム）', computedIn: [`${SP}:imageStep`], from: 'full', trace: '本当のマスの次の列。', tests: [t('src/test/fullRead.test.ts', 'a spectrogram is read at its real cells, never the cells averaged to draw it, and stepped a frame at a time (R7)')], inFlight: 'claude/contract-step-click' },
    {
        id: 'track-spectrogram.range', chart: 'track-spectrogram', value: 'range', what: '色の自動の範囲（カラーバーの両端の数）',
        computedIn: ['src/webview/runtime/spectrogramRaster.ts:spectrogramDisplayBounds', 'python-backend/analyzer.py:_build_spectrogram'],
        from: 'thinned', trace: 'spec.minDb / maxDb は _build_spectrogram が時間と周波数をパワー平均して表示用に縮めたマス（_resample_time_bins、resample_frequency_bins）の最小と最大。niceRange で丸めてカラーバーの両端に出す。',
        tests: [t('src/test/uiSmoke/colourRangeRounding.spec.ts', 'the auto colour scale opens with round dB ends, and typed ends are kept as typed')],
        gap: { severity: 'P1', why: 'カラーバーの両端の数が、表示用に平均したマスから来る。テストは丸めだけを見ていて、全 STFT の最小・最大と比べていない。' },
    },
    { id: 'track-spectrogram.ticks', chart: 'track-spectrogram', value: 'ticks', what: '周波数の目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '周波数の範囲（ナイキストか入れた範囲）から部品が決める。', tests: TICKS },
    { id: 'track-spectrogram.axis', chart: 'track-spectrogram', value: 'axis', what: '周波数の軸と色の名前', computedIn: ['src/webview/runtime/trackCanvasPainter.ts:paintTrackSpectrogram'], from: 'words', trace: '周波数 [Hz]、色はレベルの名前と基準。', tests: [t('src/test/trackCanvasPainter.test.ts', 'a spectrogram lane is drawn by the plot component over its whole width, with the colour bar every coloured picture draws in its top right (R13)'), t('src/test/uiSmoke/plotContract.spec.ts', 'the track view\'s waveform and spectrogram lanes answer the same gestures as every plot: readout in the toolbar above them (R13)')], names: { quantity: true, unit: true, reference: true } },
    // ── トラックのレーンの軸 ──
    { id: 'track-axes.ticks', chart: 'track-axes', value: 'ticks', what: '時間の目盛り（上の定規）と横の軸のキャンバスの目盛り', computedIn: [`${RT}:renderRuler`, 'src/webview/runtime/laneAxes.ts:laneTimeTicks', `${SP}:paintSideAxis`], from: 'axis', trace: '見えている時間の窓から、比較台と同じ規則で決める。', tests: [TICKS[1]] },
    { id: 'track-axes.axis', chart: 'track-axes', value: 'axis', what: '時間の軸の名前（定規の右端）', computedIn: [`${RT}:renderRuler`], from: 'words', trace: '「時間 [s]」。', tests: [t('src/test/laneAxes.test.ts', 'a lane axis names its quantity, unit and calibration as Compare\'s waveform axis does')], names: { quantity: true, unit: true } },
    // ── トラックの見出しとツールバー ──
    { id: 'track-header.peak', chart: 'track-header', value: 'summary', what: 'チャンネルのピーク（振幅とレベル）', computedIn: ['src/webview/runtime/calibrationDecorations.ts:channelMetricSummaryHtml', 'src/webview/runtime/calibrationDecorations.ts:levelText', 'src/webview/runtime/calibrationDecorations.ts:peakText', 'python-backend/analyzer.py:analyze_from_frame'], from: 'full', trace: 'バックエンドが全サンプルのピークと wandas のレベルを返し、webview は計算し直さない。', tests: [t('src/test/renderScript.integration.test.ts', 'renderScript: channel peak metrics use backend-provided levels without recalculating dB'), t('src/test/calibrationContracts.test.ts', 'calibration row helpers draw badges, peak text, requests and the overlay guard')] },
    { id: 'track-header.meta', chart: 'track-header', value: 'summary', what: 'チャンネル数とサンプリング周波数（kHz）', computedIn: ['src/webview/runtime/trackLaneHtml.ts:trackRowHtml'], from: 'input', trace: 'ファイルのメタデータ。', tests: [], gap: { severity: 'P3', why: '「48.0kHz」の書き方が読み値の決まり（plotText.ts）と違い、確かめるテストもない。' } },
    { id: 'track-header.cursor', chart: 'track-header', value: 'label', what: 'カーソルの時刻、再生の時刻、ループの範囲', computedIn: [`${RT}:updateCursorDisplay`, `${RT}:refreshSpectrumViews`, 'src/webview/runtime/playbackDisplay.ts:update', 'src/webview/runtime/waveformInteraction.ts:loopRegionClockText'], from: 'input', trace: 'カーソル・再生・ループの位置（利用者の操作）を m:ss.ss で書く。', tests: [t('src/test/uiSmoke/toolbar.spec.ts', 'the cursor readout is labelled and follows a loop drag to where it was released'), t('src/test/playbackDisplay.test.ts', 'createPlaybackDisplay shows the prefixed clock time while playing and hides it when stopped'), t('src/test/sharedFormat.test.ts', 'time and channel labels share one implementation')] },
    { id: 'track-header.offset', chart: 'track-header', value: 'label', what: 'トラックのずらし（+0.000s）', computedIn: [`${RT}:updateOffsetDisplays`], from: 'input', trace: '利用者が入れたずらし。', tests: [t('src/test/renderScript.integration.test.ts', 'renderScript: Enter commits inline offset edit')] },
    { id: 'track-header.analysis-window', chart: 'track-header', value: 'label', what: '解析窓の時刻の範囲と長さ（ms）', computedIn: [`${RT}:analysisWindowCaption`], from: 'full', trace: 'バックエンドがスライスに付けた窓の始まりと終わり（windowStartNorm / EndNorm）。', tests: [t('src/test/uiSmoke/analysisWindow.spec.ts', 'analysis window band follows the cursor on the waveform only and the header names it')] },
    // ── トラックの PNG ──
    { id: 'track-png.export', chart: 'track-png', value: 'export', what: 'PNG に写るレーンの絵と軸の数', computedIn: ['src/webview/runtime/exportDownloads.ts:composeTrackCanvases'], from: 'axis', trace: '画面のレーンと軸のキャンバスを写す。新しく数を作らない（数はそれぞれのレーンの行のとおり）。', tests: [t('src/test/uiSmoke/laneCulling.spec.ts', 'the PNG export draws every lane: it asks for the spectrograms of lanes out of view and is saved once they are answered')] },
    // ── カーソルスペクトル ──
    {
        id: 'cursor-spectrum.readout', chart: 'cursor-spectrum', value: 'readout', what: '読み値（周波数・レベル）',
        computedIn: ['src/webview/runtime/spectrumRuntime.ts:spectrumReadoutValues', 'src/webview/runtime/spectrumRuntime.ts:spectrumReadoutText', 'src/webview/runtime/overlaySpectrumPainter.ts:readout', 'src/webview/runtime/overlaySpectrumPainter.ts:spectrumLayer', `${RT}:renderOverlaySpectrum`, 'src/webview/runtime/laneReads.ts:createLaneReads'],
        from: 'full', trace: '表示用に切ったスライスは laneReads.slice で全ビンの行を読み直し、全ビンの行はその場で読む（localLine）。帯は全帯。',
        tests: [t('src/test/overlaySpectrumPainter.test.ts', 'a slice too dense to draw whole is read at its real bins: a bin thinned out of the line, and every bin by the arrow keys (R7)'), t('src/test/fullRead.test.ts', 'a cursor spectrum read at its real bins writes its frequency to the digits those bins need, not the drawn points\' (R7)'), t('python-backend/test_known_answers.py', 'test_the_cursor_spectrums_cut_row_and_every_bin_row_read_the_same_peaks')],
    },
    { id: 'cursor-spectrum.step', chart: 'cursor-spectrum', value: 'step', what: '← / → で進む先（次のビン）', computedIn: [`${SP}:stageStep`], from: 'full', trace: '全ビンの行の次のビン。', tests: [t('src/test/overlaySpectrumPainter.test.ts', 'an arrow key reads the next bin the cursor spectrum drew, from the one the pointer read (R7)'), t('src/test/overlaySpectrumPainter.test.ts', 'a slice too dense to draw whole is read at its real bins: a bin thinned out of the line, and every bin by the arrow keys (R7)')], inFlight: 'claude/contract-step-click' },
    {
        id: 'cursor-spectrum.order', chart: 'cursor-spectrum', value: 'order', what: '重ねる順（静かな線が上）',
        computedIn: ['src/webview/runtime/overlaySpectrumPainter.ts:spectrumLayer', `${SP}:levelBinsOf`, `${SP}:overlayOrder`],
        from: 'thinned', trace: 'spectrumLayer は手元の xs / values から levelBins を作る。表示用に切ったスライス（frequenciesHz があるもの：バックエンドが各区間の最小・最大のビンだけを残した行）では、それは描く点で、全ビンのパワーではない。',
        tests: [t('src/test/stagePanes.test.ts', 'a cursor spectrum on a linear axis counts its 0 Hz bin in its level (R6)')],
        gap: { severity: 'P1', why: '表示用に切ったスライスの順を、間引いた点のパワーで決めている（全ビンのパワーではない）。' },
        inFlight: 'claude/level-order-exact',
    },
    {
        id: 'cursor-spectrum.range', chart: 'cursor-spectrum', value: 'range', what: 'レベルの軸の自動の範囲（左右の軸）',
        computedIn: ['src/webview/runtime/spectrumRuntime.ts:spectrumSeriesRange', 'src/webview/runtime/spectrumRuntime.ts:overlayLevelAxes', `${RT}:applySpectrumDisplaySettings`, 'python-backend/analysis_service.py:spectrum_slice'],
        from: 'extremes', trace: 'slice.minDb / maxDb はバックエンドが min_max_spectrum で切った行（各区間の最小・最大のビン）の最小と最大。端は全ビンと同じ。niceRange で丸める。',
        tests: [t('src/test/renderScript.integration.test.ts', 'renderScript: lazy spectrum slices apply display range settings')],
        gap: { severity: 'P2', why: '範囲を切った行から求めている。全ビンの最小・最大と一致することを確かめるテストがない。' },
    },
    { id: 'cursor-spectrum.ticks', chart: 'cursor-spectrum', value: 'ticks', what: '周波数とレベルの目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める。', tests: [t('src/test/overlaySpectrumPainter.test.ts', 'zoomed between two log ticks, the frequency axis still labels where it is')] },
    { id: 'cursor-spectrum.axis', chart: 'cursor-spectrum', value: 'axis', what: '周波数とレベルの軸の名前、凡例の頭のレベルの名前', computedIn: ['src/webview/runtime/overlaySpectrumPainter.ts:paintOverlaySpectrum', 'src/webview/runtime/overlaySpectrumPainter.ts:renderSpectrumAxisLegend'], from: 'words', trace: 'レベルは比較台と同じ名前（基準・未校正）、周波数 [Hz]。', tests: [t('src/test/uiSmoke/spectrumOctaveBands.spec.ts', 'the cursor spectrum names its level axis as Compare does, uncalibrated, and its lines in a legend'), t('src/test/overlaySpectrumPainter.test.ts', 'paintOverlaySpectrum names the frequency axis at the right end of its ticks, as the comparison does')], names: { quantity: true, unit: true, reference: true } },
    // ── カーソルスペクトルの CSV ──
    { id: 'spectrum-csv.export', chart: 'spectrum-csv', value: 'export', what: 'CSV の周波数とレベル', computedIn: ['src/webview/runtime/runtimeExports.ts:buildSpectrumCsv', `${RT}:writeCsvWhenDetailed`], from: 'full', trace: 'トラックの中では、バックエンドの全ビンの行だけを書く。表示用に切った行は待つか、書かずにそう言う。', tests: [t('src/test/renderScript.integration.test.ts', 'renderScript: export-csv replaces a cursor spectrum cut for display with every FFT bin'), t('src/test/runtimeExports.test.ts', 'spectrum CSV writes every FFT bin of a whole row at fs / n_fft spacing')] },
    // ── ペアの図 ──
    {
        id: 'pair-view.readout', chart: 'pair-view', value: 'readout', what: '利得・位相・γ² の読み値',
        computedIn: ['src/webview/runtime/pairSpectrum.ts:pairLanes', `${SP}:lineRead`, 'python-backend/analysis_service.py:pair_spectrum'],
        from: 'whole', trace: 'バックエンドが全ビンをそれぞれの周波数で返し、図はその全部をつなぐ（full: \'drawn\'）。',
        tests: [t('src/test/pairSpectrum.test.ts', 'the plot under the pointer reads its nearest line in the row above, in its unit, and the others follow its frequency (R7, R8)'), t('python-backend/test_analysis_service.py', 'test_pair_spectrum_keeps_every_bin_at_its_own_frequency_so_a_narrow_notch_stays')],
    },
    { id: 'pair-view.step', chart: 'pair-view', value: 'step', what: '← / → で進む先', computedIn: [`${SP}:stageStep`, `${SP}:stageNeighbour`], from: 'whole', trace: '描いた次のビン（全ビン）。', tests: [t('src/test/uiSmoke/plotContract.spec.ts', 'the pair view\'s gain, phase and γ² plots answer the same gestures as every plot (R13)')], inFlight: 'claude/contract-step-click' },
    {
        id: 'pair-view.order', chart: 'pair-view', value: 'order', what: '利得の線の重ねる順',
        computedIn: ['src/webview/runtime/pairSpectrum.ts:lines', `${SP}:levelBinsOf`],
        from: 'full', trace: '利得の levelBins を見えている周波数の全ビンから作る。',
        tests: [],
        gap: { severity: 'P2', why: 'ペアの利得の levelBins が全ビンから作られ、静かな応答が上に来ることを確かめるテストがない（部品の一般のテストだけ）。' },
    },
    {
        id: 'pair-view.range', chart: 'pair-view', value: 'range', what: '利得の軸の自動の範囲',
        computedIn: ['src/webview/runtime/pairSpectrum.ts:gainRange'],
        from: 'full', trace: '見えている周波数の全ビンの利得の最小・最大の中心から ±（幅の 1.1 倍の半分、少なくとも 3 dB）。端を切りのよい値に広げない。',
        tests: [],
        gap: { severity: 'P2', why: '範囲を確かめるテストがなく、R9（自動の範囲は切りのよい値）を守っていない。' },
    },
    { id: 'pair-view.ticks', chart: 'pair-view', value: 'ticks', what: '目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める（位相は ±180°、γ² は 0〜1）。', tests: TICKS },
    { id: 'pair-view.axis', chart: 'pair-view', value: 'axis', what: '周波数・利得・位相の軸の名前', computedIn: ['src/webview/runtime/pairSpectrum.ts:pairLanes'], from: 'words', trace: '利得はバックエンドの axisLabel、位相 [°]、周波数 [Hz]。', tests: [t('src/test/pairSpectrum.test.ts', 'the pair view is three plots on one frequency axis, each named with its quantity and unit, drawing ok responses only')], names: { quantity: true, unit: true } },
    { id: 'pair-view.axis-coherence', chart: 'pair-view', value: 'axis', what: 'コヒーレンスの軸の名前（「γ²」）', computedIn: ['src/webview/runtime/pairSpectrum.ts:pairLanes'], from: 'words', trace: 'pairCoherenceLabel は記号だけで、量の名前と単位（無次元）を書かない。', tests: [t('src/test/pairSpectrum.test.ts', 'the pair view is three plots on one frequency axis, each named with its quantity and unit, drawing ok responses only')], names: { quantity: false, unit: false }, gap: { severity: 'P3', why: '記号「γ²」だけで、量（コヒーレンス）の名前と無次元の表記がない。' } },
    { id: 'pair-view.summary', chart: 'pair-view', value: 'summary', what: '見出し（H1・平均回数・時間の範囲）', computedIn: ['src/webview/runtime/pairSpectrum.ts:pairHeader', 'src/webview/runtime/pairSpectrum.ts:formatSeconds'], from: 'full', trace: 'バックエンドが返した各応答の平均回数（最少）と範囲。', tests: [t('src/test/pairSpectrum.test.ts', 'the header shows the fewest averages and the whole averaged range, warning below 8')] },
    // ── カラーバー ──
    { id: 'colour-bar.ticks', chart: 'colour-bar', value: 'ticks', what: 'カラーバーの両端の数の書き方', computedIn: [`${SP}:paintPlot`, `${SP}:endText`, `${SP}:levelTick`], from: 'axis', trace: '呼ぶ側の範囲の両端を書く（範囲の出どころは各熱図の range の行）。', tests: [t('src/test/stagePanes.test.ts', 'a colour or value range not in dB is widened to round ends, as a dB range is')] },
    { id: 'colour-bar.axis', chart: 'colour-bar', value: 'axis', what: 'カラーバーの名前（量・単位・基準）', computedIn: [`${SP}:paintColourBar`, `${SP}:stageAxes`], from: 'words', trace: '熱図の色が表す量・単位・基準。狭いと単位だけにし、それも入らなければ書かない。', tests: [t('src/test/stagePanes.test.ts', 'a heatmap names what its colour measures, with its unit and reference, for its colour bar'), t('src/test/stagePanes.test.ts', 'a colour bar stays inside a narrow plot: its name shrinks to the unit, then is left out')], names: { quantity: true, unit: true, reference: true } },
    // ── 入口の保持図 ──
    {
        id: 'entry-held.readout', chart: 'entry-held', value: 'readout', what: '保持図の読み値',
        computedIn: [`${SP}:lineRead`, 'src/webview/runtime/entryHeldPlot.ts:paintStep', 'src/webview/runtime/entryHeldPlot.ts:paintDelta'],
        from: 'full', trace: '手順の絵は reader.of、手順の有無の Δ は reader.combined、スロットの Δ は全ビンの Δ を localLine で読む。全ビンがないときの帯の Δ は棒（全帯）。',
        tests: [t('src/test/uiSmoke/heldDelta.spec.ts', 'a held slot draws its own channel\'s Δ against its base from every bin the hold asks for (R1, R3, R11)'), t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s held plot answers the same gestures as every plot (R13)')],
    },
    { id: 'entry-held.step', chart: 'entry-held', value: 'step', what: '保持図の ← / →', computedIn: [`${SP}:stageStep`], from: 'full', trace: '読み値と同じ全データの次の点。', tests: [t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s held plot answers the same gestures as every plot (R13)')], inFlight: 'claude/contract-step-click' },
    {
        id: 'entry-held.delta', chart: 'entry-held', value: 'delta', what: 'スロットの Δ（全ビン）と手順の有無の Δ',
        computedIn: ['src/webview/runtime/comparePanes.ts:binsOf', 'src/webview/runtime/comparePanes.ts:fileSide', 'src/webview/runtime/comparePanes.ts:deltaViews', 'src/webview/runtime/combineSource.ts:createCombineSource'],
        from: 'full', trace: 'スロットは押したときに録音と基準の全ビンを取り寄せ、ビンごとに引く（0.01 dB に丸める）。手順の有無はバックエンドが全データで引く。',
        tests: [t('src/test/entryHeldPlot.test.ts', 'a held slot asks once for every bin of its file and its base, then draws its Δ from them (R1, R3)'), t('src/test/comparePanes.test.ts', 'the held Δ zoomed in is drawn again from every bin between its ends, not the whole Δ decimated and stretched (R1, R3)'), t('src/test/comparePanes.test.ts', 'the median and Δ are taken bin by bin from every bin, and only drawing decimates them')],
    },
    {
        id: 'entry-held.range', chart: 'entry-held', value: 'range', what: '保持図の値の軸の範囲',
        computedIn: ['src/webview/runtime/entryHeldPlot.ts:paintStep', 'src/webview/runtime/entryHeldPlot.ts:paintDelta', `${SP}:stageRange`, `${SP}:stageDiffRange`],
        from: 'extremes', trace: '手順の絵は粗い絵（stageRange）、スロットの Δ は binsView で間引いた Δ（stageDiffRange）、手順の有無の Δ は全体の Δ の絵から決める。どれも各区間の最小・最大を残した点。',
        tests: [],
        gap: { severity: 'P2', why: '範囲を間引いた点から求めている。全データの端と一致することを確かめるテストがない。' },
    },
    { id: 'entry-held.ticks', chart: 'entry-held', value: 'ticks', what: '保持図の目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める。', tests: TICKS },
    { id: 'entry-held.axis', chart: 'entry-held', value: 'axis', what: '保持図の軸の名前（Δ は「Δ [dB]」）', computedIn: [`${SP}:stageAxes`], from: 'words', trace: '比較台と同じ stageAxes。Δ は何の差かと基準を書かない。', tests: [t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s held plot answers the same gestures as every plot (R13)')], names: { quantity: false, unit: true, reference: false }, gap: { severity: 'P2', why: '「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。' }, inFlight: 'claude/axis-quantity-unit' },
    // ── 入口の概観帯 ──
    {
        id: 'entry-overview.readout', chart: 'entry-overview', value: 'readout', what: '概観帯の読み値（録音・帯・レベル）',
        computedIn: ['src/webview/runtime/entryPlots.ts:overviewCells', `${SP}:cellRead`],
        from: 'full', trace: '描く絵は行が多いと画素の行ごとに一番大きい帯のレベルにするが、読み値は表の本当の行（overviewCells）を読む。',
        tests: [t('src/test/uiSmoke/entry.spec.ts', 'the overview strip has a row per channel, as the table does: its readout names the channel of a recording of several'), t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s overview strip answers the same gestures as every plot (R13)')],
    },
    { id: 'entry-overview.step', chart: 'entry-overview', value: 'step', what: '概観帯の ← / →（次の帯）', computedIn: [`${SP}:imageStep`], from: 'full', trace: '表の本当の行の次の帯。', tests: [t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s overview strip answers the same gestures as every plot (R13)')], inFlight: 'claude/contract-step-click' },
    {
        id: 'entry-overview.range', chart: 'entry-overview', value: 'range', what: '色の範囲（カラーバーの両端）',
        computedIn: ['src/webview/runtime/entryPlots.ts:overviewPicture'],
        from: 'full', trace: '表のすべての行のすべての帯のレベルの最小と最大を 1 dB に切り下げ・切り上げる（niceRange ではない）。',
        tests: [],
        gap: { severity: 'P2', why: '範囲を確かめるテストがない。端の丸めも R9 の切りのよい値（niceRange）ではない。' },
    },
    { id: 'entry-overview.ticks', chart: 'entry-overview', value: 'ticks', what: '帯と行の目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '行は表の上からの番号（yTickText）。', tests: [t('src/test/entrySidePlots.test.ts', 'the strip is a heatmap of the table: a row per table row counted down from the top, the loudest per line when they outnumber its lines')] },
    { id: 'entry-overview.axis', chart: 'entry-overview', value: 'axis', what: '帯・行・色の名前', computedIn: ['src/webview/runtime/entryPlots.ts:paintOverview'], from: 'words', trace: '帯域中心 [Hz]、行（表の順）、色はレベルと共有の基準。', tests: [t('src/test/entrySidePlots.test.ts', 'the overview colour scale and the dataset table name the recordings\' shared level reference, plain dB once they differ')], names: { quantity: true, unit: true, reference: true } },
    // ── 入口の分布図 ──
    {
        id: 'entry-distribution.readout', chart: 'entry-distribution', value: 'readout', what: '分布図の読み値（ビンの範囲と数、点の録音と値、スロット、基準の中央値）',
        computedIn: ['src/webview/runtime/entryDistribution.ts:distributionRows', 'src/webview/runtime/entryTableHtml.ts:plotValueText', 'src/webview/runtime/entryRuntime.ts:format'],
        from: 'whole', trace: 'ビン・点・目盛りのしるしは間引かず全部描く（full: \'drawn\'）。値は表の値（スキャンの全データの値）。',
        tests: [t('src/test/plotText.test.ts', 'the distribution reads a value as a plot does, not as the table column writes it (R7)'), t('src/test/plotText.test.ts', 'neighbouring distribution bins never read the same: the bins\' width adds the digits it needs (R7)'), t('src/test/entryDistributionPane.test.ts', 'each group is a row of the plot component: its dots, its slots and the base on it')],
    },
    { id: 'entry-distribution.step', chart: 'entry-distribution', value: 'step', what: '分布図の ← / →', computedIn: [`${SP}:stageStep`], from: 'whole', trace: '描いた次のビン・点。', tests: [t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s distribution answers the same gestures as every plot: each group\'s row, on the value axis below them (R13)')], inFlight: 'claude/contract-step-click' },
    { id: 'entry-distribution.count', chart: 'entry-distribution', value: 'count', what: 'ビンの数、群の数、「最大 n」、選んだ行の数', computedIn: ['src/webview/runtime/entryDistribution.ts:distributionRows', 'src/shared/dataset/distribution.ts:binCounts', 'src/webview/runtime/entryDistributionPane.ts:paint', 'src/webview/runtime/entryRuntime.ts:pick'], from: 'full', trace: '群のすべての行を数える。', tests: [t('src/test/distribution.test.ts', 'bins line up across groups; the range marks what it takes'), t('src/test/distribution.test.ts', 'a CSV value counts each recording once per group; a computed one counts channels and says how many are not computed')] },
    { id: 'entry-distribution.median', chart: 'entry-distribution', value: 'median', what: '基準の群の中央値の線', computedIn: ['src/webview/runtime/entryDistribution.ts:distributionRows', 'src/shared/dataset/distribution.ts:median'], from: 'full', trace: '群のすべての値の中央値。', tests: [t('src/test/distribution.test.ts', 'groups sort by number when numeric, as text otherwise, the blank last; the median of an even count is the mean of the middle two')] },
    { id: 'entry-distribution.range', chart: 'entry-distribution', value: 'range', what: '値の軸の範囲', computedIn: ['src/shared/dataset/distribution.ts:distribution'], from: 'full', trace: 'すべての値の端を niceRange で広げる。', tests: [t('src/test/distribution.test.ts', 'the distribution\'s value axis opens at round ends, as every automatic range does (R9)'), t('src/test/distribution.test.ts', 'a range far narrower than its values keeps ends that hold every value, never rounded inward past them (R9)')] },
    { id: 'entry-distribution.ticks', chart: 'entry-distribution', value: 'ticks', what: '値の軸の目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める。', tests: [t('src/test/distribution.test.ts', 'ticks fall on round values without floating-point drift')] },
    { id: 'entry-distribution.axis', chart: 'entry-distribution', value: 'axis', what: '値の軸と縦の名前', computedIn: ['src/webview/runtime/entryDistributionPane.ts:paint'], from: 'words', trace: '値の名前（「Leq A特性 [基準]」など）と「縦：{単位}数（群ごと）」。', tests: [t('src/test/uiSmoke/plotContract.spec.ts', 'the entry\'s distribution answers the same gestures as every plot: each group\'s row, on the value axis below them (R13)')], names: { quantity: true, unit: true, reference: true } },
    { id: 'entry-distribution.axis-csv', chart: 'entry-distribution', value: 'axis', what: 'CSV の列の値の軸（「{列}（CSV の列）」）', computedIn: ['src/webview/runtime/entryDistributionPane.ts:paint'], from: 'words', trace: 'CSV の列は単位がわからず、列の名前だけを書く。', tests: [], names: { quantity: true, unit: false }, gap: { severity: 'P3', why: 'CSV の列の値の軸に単位がない（列の名前に単位がなければ量だけ）。' } },
    // ── 入口の表 ──
    { id: 'entry-table.cells', chart: 'entry-table', value: 'summary', what: '表の値の列（Leq、ピーク周波数、波高率、帯）と凡例の値', computedIn: ['src/webview/runtime/entryTableHtml.ts:formatValue', 'src/webview/runtime/entryTableHtml.ts:datasetRowsHtml', 'src/webview/runtime/entryRuntime.ts:formatColumn', 'src/webview/runtime/entryTable.ts:fileValues', 'src/webview/runtime/entryTable.ts:bandLevels', 'python-backend/scan_service.py:measure'], from: 'full', trace: 'スキャンが Frame の全サンプル・全ビンから求めた値（ピークは Welch の全ビン、帯は noct_spectrum）。チャンネルはパワー平均。', tests: [t('python-backend/test_scan_service.py', 'test_scan_measures_the_analysis_spec_metrics'), t('src/test/entryTable.test.ts', 'unreadable files and files of another shape show no numbers')] },
    { id: 'entry-table.delta', chart: 'entry-table', value: 'delta', what: '表の Δ（条件の他のファイルの中央値に対して）と最大の帯', computedIn: ['src/webview/runtime/entryTable.ts:buildEntryModel', 'src/webview/runtime/entryTable.ts:maxBandDelta', 'src/webview/runtime/entryTable.ts:mostTellingBand'], from: 'full', trace: 'スキャンの全データの値と、その中央値。', tests: [t('src/test/entryTable.test.ts', 'rows get Δ from the median of their condition\'s other files, never an outlier mark'), t('src/test/entryTable.test.ts', 'on the scanned entry100 fixture the three resonances stand 10 dB above their groups at 3.15 kHz, one ✕ and one ≠')] },
    { id: 'entry-table.derived', chart: 'entry-table', value: 'delta', what: 'D で固定した差（行の下の「└ Δ」）', computedIn: ['src/webview/runtime/entryRuntime.ts:derivedItems'], from: 'full', trace: '固定したスキャンの Leq・帯（全データ）とその基準の差。', tests: [t('src/test/entryTable.test.ts', 'a derived row sits under its parent with the parent\'s condition and Δ against its own base, and counts toward no group')] },
    { id: 'entry-table.count', chart: 'entry-table', value: 'count', what: '見出し・フィルタ・チェックの一覧の数', computedIn: ['src/webview/runtime/entryTableHtml.ts:datasetHeadHtml', 'src/webview/runtime/entryTableHtml.ts:trackHeadHtml', 'src/webview/runtime/entryTableHtml.ts:filterChipsHtml', 'src/webview/runtime/entryTableHtml.ts:checkListHtml', 'src/webview/runtime/entryTableHtml.ts:say'], from: 'full', trace: '表のすべての行を数える。', tests: [], gap: { severity: 'P2', why: '見出しやフィルタの数がすべての行を数えていることを確かめるテストがない。' } },
    { id: 'entry-table.mismatch', chart: 'entry-table', value: 'label', what: '比べられない理由（≠ の kHz など）と区間の名札', computedIn: ['src/webview/runtime/entryTable.ts:mismatchLabel', 'src/webview/runtime/entryTable.ts:regionLabel'], from: 'input', trace: 'ファイルのメタデータと利用者の区間。', tests: [t('src/test/entryTable.test.ts', 'on the scanned entry100 fixture the three resonances stand 10 dB above their groups at 3.15 kHz, one ✕ and one ≠')] },
    { id: 'entry-table.csv', chart: 'entry-table', value: 'export', what: '表の CSV', computedIn: ['src/webview/runtime/entryTable.ts:entryCsv', 'src/webview/runtime/entryTable.ts:csvCell', 'src/webview/runtime/entryTable.ts:dB', 'src/webview/runtime/entryTable.ts:regionCells'], from: 'full', trace: '表と同じ全データの値を決まった桁で書く。', tests: [t('src/test/entryTable.test.ts', 'the CSV has the agreed columns, a BOM, and the same bytes every time')] },
    // ── レポートの重ね図 ──
    { id: 'report-overlay.headline', chart: 'report-overlay', value: 'headline', what: '図の題（見出しの帯と Leq の両方のレベル）', computedIn: ['src/webview/runtime/comparePanes.ts:levelsHeadline', 'src/webview/runtime/comparePanes.ts:pair', 'src/webview/runtime/comparePanes.ts:buildCompareModel', 'src/webview/runtime/comparePanes.ts:medianSide', 'src/webview/runtime/comparePanes.ts:spreadOf', 'src/webview/runtime/compareReport.ts:reportFiles'], from: 'full', trace: '帯と Leq はスキャンの全データの値（群は帯ごとの中央値）。', tests: [t('src/test/comparePanes.test.ts', 'the headline gives both levels, and a band far below the loudest does not head it however large its Δ'), t('src/test/comparePanes.test.ts', 'a tone that leaks into the neighbouring bands heads the list alone: only peaks of |Δ| across bands count')] },
    { id: 'report-overlay.order', chart: 'report-overlay', value: 'order', what: '基準と比較の重ねる順', computedIn: ['src/webview/runtime/comparePanes.ts:binsView', 'src/webview/runtime/comparePanes.ts:sideView'], from: 'full', trace: 'binsView は全ビンから levelBins を作り、描く線だけを間引く。帯は全帯。', tests: [], gap: { severity: 'P2', why: 'レポートの図の順が全ビンのパワーで決まることを確かめるテストがない。' } },
    { id: 'report-overlay.range', chart: 'report-overlay', value: 'range', what: 'レベルの軸の範囲', computedIn: ['src/webview/runtime/compareReport.ts:paintOverlayFigure', `${SP}:stageRange`], from: 'extremes', trace: 'binsView で 640 区間の最小・最大に間引いた線から stageRange で決める。', tests: [], gap: { severity: 'P2', why: '範囲を間引いた線から求めている。全ビンの端と一致することを確かめるテストがない。' } },
    { id: 'report-overlay.ticks', chart: 'report-overlay', value: 'ticks', what: '目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める。', tests: TICKS },
    { id: 'report-overlay.axis', chart: 'report-overlay', value: 'axis', what: '軸の名前', computedIn: ['src/webview/runtime/comparePanes.ts:paneAxes'], from: 'words', trace: 'レベル（基準・未校正）と周波数。', tests: [t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files')], names: { quantity: true, unit: true, reference: true } },
    // ── レポートの Δ 図 ──
    { id: 'report-delta.headline', chart: 'report-delta', value: 'headline', what: '図の題（見出しの帯の Δ と Leq の Δ）', computedIn: ['src/webview/runtime/comparePanes.ts:diffHeadline', 'src/webview/runtime/comparePanes.ts:buildCompareModel', 'src/webview/runtime/compareReport.ts:reportFiles'], from: 'full', trace: '帯の Δ = round(比較, 0.1) − round(基準, 0.1)、スキャンの全データの帯から。', tests: [t('src/test/comparePanes.test.ts', 'a tone that leaks into the neighbouring bands heads the list alone: only peaks of |Δ| across bands count'), t('src/test/comparePanes.test.ts', 'against one base file, a band within the chance spread of its condition is not headline material')] },
    { id: 'report-delta.range', chart: 'report-delta', value: 'range', what: 'Δ の軸の範囲', computedIn: ['src/webview/runtime/compareReport.ts:deltaFigure', `${SP}:stageDiffRange`], from: 'extremes', trace: '全ビンの Δ を binsView で間引いた線と帯の Δ から決める。帯だけのときは全帯。', tests: [t('src/test/comparePanes.test.ts', 'the report\'s Δ figure without bins draws the 1/3-octave Δ, its range holding every band (R1)')], gap: { severity: 'P2', why: '全ビンがあるときの範囲を間引いた線から求めている。テストは帯だけの場合しか見ていない。' } },
    { id: 'report-delta.ticks', chart: 'report-delta', value: 'ticks', what: '目盛り', computedIn: STAGE_TICKS, from: 'axis', trace: '範囲から部品が決める。', tests: TICKS },
    { id: 'report-delta.axis', chart: 'report-delta', value: 'axis', what: 'Δ の軸の名前（「Δ [dB]」）', computedIn: ['src/webview/runtime/comparePanes.ts:paneAxes'], from: 'words', trace: 'paneAxes の delta は「Δ [dB]」。', tests: [t('src/test/comparePanes.test.ts', 'every pane names its axes: level and frequency, Δ with its legend, in the language and calibration of the files')], names: { quantity: false, unit: true, reference: false }, gap: { severity: 'P2', why: '「Δ [dB]」は何の差か（レベルの差）を書かず、dB の基準もない。' }, inFlight: 'claude/axis-quantity-unit' },
    // ── レポートのファイル ──
    { id: 'report-files.csv', chart: 'report-files', value: 'export', what: '報告.csv（最大の帯、Leq、基準の Leq、帯ごとの Δ、群の数、D の行）', computedIn: ['src/webview/runtime/compareReport.ts:reportCsv', 'src/webview/runtime/compareReport.ts:maxBandCells', 'src/webview/runtime/compareReport.ts:dB', 'src/webview/runtime/compareReport.ts:bandLevel'], from: 'full', trace: 'スキャンの全データの帯と Leq（群は中央値）、dB は 0.1 まで。', tests: [t('src/test/benchReport.test.ts', '報告.csv has one row per slot in the agreed columns: dB to one decimal, Hz whole, missing values empty'), t('src/test/benchReport.test.ts', 'the report says what the comparison was taken from: the value, the filters, each base with its channel, the memo, and the D rows')] },
    { id: 'report-files.region', chart: 'report-files', value: 'label', what: '要約.png の頭書きと図の題の区間', computedIn: ['src/webview/runtime/compareReport.ts:summaryPng', 'src/webview/runtime/compareReport.ts:regionText'], from: 'input', trace: '利用者の区間（測った区間はファイルの端の 0.15 s を除く）。', tests: [t('src/test/benchReport.test.ts', 'the report Recipe carries the region as its time slice and still loads in wandas')] },
    // ── 解析レポート ──
    { id: 'analysis-report.export', chart: 'analysis-report', value: 'export', what: 'Markdown のレポートの数（長さ、ピーク、レベル）', computedIn: ['src/shared/report/analysisReport.ts:buildMarkdownReport', 'src/shared/report/analysisReport.ts:formatReportDb', 'src/shared/report/analysisReport.ts:reportLevel'], from: 'full', trace: 'バックエンドの全サンプルのピークとレベル、ファイルの長さ。', tests: [t('src/test/analysisReport.test.ts', 'markdown report is a pure function of tracks, loop region and time'), t('src/test/renderScript.integration.test.ts', 'renderScript: multichannel report lists peak metrics for every channel')] },
];

/**
 * Every gap the table records, with its severity: the gap rows are exactly these. The list only shrinks: a row comes
 * off it once a test holds it (and its source is full data), never by losing its `gap` alone.
 */
export const KNOWN_GAPS: Readonly<Record<string, Severity>> = {
    'compare-overlay.readout-events': 'P2',
    'compare-overlay.range': 'P2',
    'compare-overlay.range-image': 'P1',
    'compare-overlay.axis-metric': 'P2',
    'compare-overlay.axis-cepstrum': 'P3',
    'compare-delta.headline': 'P1',
    'compare-delta.range': 'P2',
    'compare-delta.range-image': 'P1',
    'compare-delta.axis': 'P2',
    'compare-lanes.range': 'P2',
    'compare-lanes.range-image': 'P1',
    'trigger-lanes.range': 'P2',
    'track-header.meta': 'P3',
    'track-spectrogram.range': 'P1',
    'cursor-spectrum.order': 'P1',
    'cursor-spectrum.range': 'P2',
    'pair-view.order': 'P2',
    'pair-view.range': 'P2',
    'pair-view.axis-coherence': 'P3',
    'entry-held.range': 'P2',
    'entry-held.axis': 'P2',
    'entry-overview.range': 'P2',
    'entry-distribution.axis-csv': 'P3',
    'entry-table.count': 'P2',
    'report-overlay.order': 'P2',
    'report-overlay.range': 'P2',
    'report-delta.range': 'P2',
    'report-delta.axis': 'P2',
};

/**
 * The functions that only turn a number into text, or compute a range, an order or a statistic for the functions that
 * show it (`src/…ts:function`): their callers are what the table registers. A call of one of these (or of a number
 * primitive: toFixed, toPrecision, toExponential, toLocaleString) is a value-producing path.
 */
export const VALUE_HELPERS: readonly string[] = [
    ...['withMinus', 'frequencyText', 'secondsText', 'amountText', 'quefrencyText', 'lagText', 'barkText', 'levelText', 'signedNumberText', 'signedText', 'significant'].map(name => `src/webview/plot/plotText.ts:${name}`),
    ...['formatMeasurementNumber', 'formatMeasuredLevel', 'formatClockTime', 'formatReportDuration'].map(name => `src/shared/utils/format.ts:${name}`),
    ...['niceStep', 'niceTicks', 'niceRange', 'widened', 'round'].map(name => `src/shared/utils/ticks.ts:${name}`),
    'src/shared/utils/levels.ts:powerMeanDb', 'src/shared/utils/levels.ts:powerMeanOrNull',
    'src/shared/dataset/distribution.ts:median', 'src/shared/dataset/distribution.ts:binCounts',
    'src/webview/runtime/entryTable.ts:csvNumber', 'src/webview/runtime/entryTable.ts:quantile',
    'src/webview/runtime/entryTableHtml.ts:plotValueText', 'src/webview/runtime/entryTableHtml.ts:formatValue',
    'src/webview/runtime/comparePanes.ts:minMaxLine', 'src/webview/runtime/comparePanes.ts:signed', 'src/webview/runtime/comparePanes.ts:level', 'src/webview/runtime/comparePanes.ts:medianOfSome', 'src/webview/runtime/comparePanes.ts:bandsAt',
    'src/webview/runtime/compareReport.ts:dB',
    'src/webview/runtime/spectrumRuntime.ts:spectrumReadoutValues',
    'src/webview/plot/waveformLayer.ts:waveformRange',
    'src/webview/draw/canvasDrawers.ts:formatHz', 'src/webview/draw/canvasDrawers.ts:formatDbLevel',
    ...['laneAmplitudeRange', 'laneAmplitudeTicks', 'laneTimeTicks'].map(name => `src/webview/runtime/laneAxes.ts:${name}`),
    ...['valueTickTexts', 'valueAxisTicks', 'rowAxisTicks', 'alongAxisTicks', 'tickText', 'levelTick', 'ticks', 'stageRange', 'stageDiffRange', 'roundEdge', 'robustEdge', 'overlayOrder', 'byLevel', 'levelBinsOf', 'timeText', 'atValue', 'atText', 'drawnLevelsText', 'readoutOf'].map(name => `${SP}:${name}`),
];

/** Functions that write a number nobody reads as a value of a chart, each with why. */
export const NOT_CHART_VALUES: Readonly<Record<string, string>> = {
    'src/shared/analysis/calibrationModel.ts:validateCalibrationFactorInput': 'the calibration form\'s own error message about the factor typed',
    'src/webview/draw/canvasDrawers.ts:frequencyAxisTicks': 'the old frequency ticks, used only by the test snapshot (testSnapshot.ts)',
    'src/webview/runtime/testSnapshot.ts:spectrogramAxisLabelTexts': 'a test hook\'s snapshot of the axis texts',
    'src/webview/runtime/testSnapshot.ts:spectrumAxisLabelTexts': 'a test hook\'s snapshot of the axis texts',
    'src/webview/runtime/laneAxes.ts:markLanePlot': 'the lane\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/plotInteraction.ts:setWindow': 'a plot\'s data-plot-window attribute for the plot contract test, not shown',
    'src/webview/runtime/entrySidePlots.ts:paint': 'the side plots\' data-window attribute for tests, not shown',
    'src/webview/runtime/trackStageMode.ts:span': 'a zoom window in a data attribute and a request key, not shown',
    'src/webview/runtime/stageDetail.ts:detailSpec': 'a detail request\'s key, not shown',
    'src/webview/runtime/pairSpectrumPanel.ts:applySplit': 'the pair pane\'s CSS height, not a value',
    'src/webview/runtime/stepBarModel.ts:startValues': 'a new step\'s starting parameter (the trigger level, two figures of the tracks\' peak), a setting the user edits',
    'src/webview/runtime/stepForm.ts:field': 'a step parameter\'s field, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:fieldNumber': 'a step chip\'s parameter, the user\'s own setting',
    'src/webview/runtime/stepLabels.ts:stepLabel': 'a step chip\'s parameter, the user\'s own setting',
};

/** The table as a section of docs/plot-contracts.md: the charts, then each one's rows, then the gaps by severity. */
export function renderContractDoc(): string {
    const fromText: Record<Source, string> = { full: '全データ', whole: '描く点が全部（間引かない）', extremes: '間引いた点（区間の最小・最大）', thinned: '間引いた点（平均・切り出し）', axis: '軸の範囲・窓', input: '利用者の値・メタデータ', words: '文字' };
    const kindText: Record<ValueKind, string> = { readout: '読み値', step: '← / →', delta: 'Δ', median: '中央値', headline: '見出し・最大', order: '重ねる順', range: '自動の範囲', ticks: '目盛り', axis: '軸の名前', export: '書き出し', count: '数', summary: '要約の値', label: '入力・設定の表示' };
    const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const code = (items: readonly string[]): string => items.map(item => `\`${item.replace(/^src\/|^python-backend\//, '')}\``).join('<br>');
    const lines = [
        '# グラフの数の契約表',
        '',
        'グラフに出る数とグラフから書き出す数の一覧です。どのグラフでも、読み値、← / → の行き先、Δ、中央値、見出しや最大、重ねる順、軸の自動の範囲と目盛り、書き出す数、数や統計は全データから求め、間引いた点は描くためだけに使います（[表示の規則](display-rules.md) R1、R2、R6、R7）。この表は、それぞれの数をどこで計算し、何から求め、どのテストが確かめているかを書きます。',
        '',
        'この文書は `src/test/plotContracts.ts` から作ります（手で書き換えません）。表を変えたら `npm run compile && node dist/test/plotContracts.js` で書き直します。`src/test/plotContracts.test.ts` は次を確かめます。',
        '',
        '- 部品（`paintOverlay`）を呼ぶすべての場所と `plotRegistry.ts` の一覧が、どれかのグラフに入っていること。',
        '- 表に書いたテストが実在し、飛ばされず、何かを確かめていること。表に書いた関数が実在すること。',
        '- webview と shared の中で数を文字にする関数（`toFixed`、`toPrecision`、`toExponential`、`toLocaleString` と、`VALUE_HELPERS` の書き方・範囲・順・統計の関数を呼ぶもの）が、表のどれかの行か、`VALUE_HELPERS`、`NOT_CHART_VALUES`（理由つき）にあること。もう数を書かない関数が残っていても失敗します。',
        '- テストのない行、間引いた点から求める行、軸の名前に量・単位・基準が欠ける行は「穴」（gap）で、`KNOWN_GAPS` と一致すること。穴は減らす方向にだけ変えます。穴の印を消すには、テストを足し、出どころを全データにします。',
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
            const tests = row.tests.length ? row.tests.map(test => `\`${test.file.replace(/^src\/test\/|^python-backend\//, '')}\` › ${cell(test.name)}`).join('<br>') : 'なし';
            const gap = row.gap ? `**${row.gap.severity}** ${cell(row.gap.why)}` : '';
            const flight = row.inFlight ? `<br>作業中：\`${row.inFlight}\`` : '';
            lines.push(`| ${kindText[row.value]} | ${cell(row.what)} | ${code(row.computedIn)} | ${fromText[row.from]}：${cell(row.trace)} | ${tests} | ${gap}${flight} |`);
        }
        lines.push('');
    }
    lines.push('## 穴の一覧', '');
    for (const severity of ['P1', 'P2', 'P3'] as const) {
        const gaps = ROWS.filter(row => row.gap?.severity === severity);
        lines.push(`### ${severity}（${gaps.length}）`, '', ...gaps.map(row => `- \`${row.id}\`：${row.gap?.why ?? ''}${row.inFlight ? `（作業中：\`${row.inFlight}\`）` : ''}`), '');
    }
    return lines.join('\n');
}

export const CONTRACT_DOC = path.join('docs', 'plot-contracts.md');

if (require.main === module) {
    writeFileSync(path.resolve(__dirname, '..', '..', CONTRACT_DOC), renderContractDoc());
}
