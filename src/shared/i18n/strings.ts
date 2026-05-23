/**
 * UI 文字列の英日辞書と locale 選択ロジック。
 *
 * 設計:
 * - VS Code 拡張側 (extension/index.ts, ComparisonPanel.ts) も Webview JS 側も
 *   同じ辞書を共有する。Webview には ComparisonPanel.renderHtml() が生成する
 *   inline `<script>` で `__APP_STRINGS__` (および locale 値の `__APP_LOCALE__`)
 *   としてグローバル注入される。renderScript IIFE 冒頭で `STR` に alias される。
 * - locale は VS Code の `vscode.env.language` (e.g. 'ja', 'en-US') から決定。
 *   'ja' で始まる場合のみ日本語、それ以外は英語。
 * - キーは英語半角の短いスラッグ。階層なし (フラット) で 1 ファイルに集約。
 */

export type SupportedLocale = 'en' | 'ja';

export interface UiStrings {
    panelTitle: string;
    panelTitlePrefix: string;
    panelComparePrefix: string;
    emptyAllExcluded: string;
    emptyNoTracks: string;
    selectionHeader: string;
    btnOpenFile: string;
    btnOpenAnotherFolder: string;
    btnOpenFolder: string;
    btnSelectAll: string;
    btnClear: string;
    selectionCountLabel: string;
    selectionNoSupported: string;
    spectrumSectionTitle: string;
    toolbarMain: string;
    toolbarTrackLabel: string;
    btnWaveform: string;
    btnSpectrogram: string;
    btnSpectrogramSettingsTitle: string;
    toolbarZoomLabel: string;
    btnZoomReset: string;
    btnRunRecipe: string;
    chartSpecNoResults: string;
    chartSpecScalarLabelHeader: string;
    chartSpecScalarValueHeader: string;
    chartSpecScalarUnitHeader: string;
    cursorDisplayHint: string;
    loopBadge: string;
    trackPlayTitle: string;
    trackStopTitle: string;
    trackOffsetResetHint: string;
    trackSpectrumTitle: string;
    analysisFailed: string;
    cursorHelpKeys: string;
    tooltipLoopResize: string;
    tooltipLoopClear: string;
    tooltipLoopOrShift: string;
    canvasOutOfRange: string;
    spectrumNoData: string;
    settingsApplyHint: string;
    reanalyzingStft: string;
    reanalyzingDefault: string;
    reanalyzingFiles: string;
    configurePython: string;
    helpTitle: string;
    helpClose: string;
    helpRowSpace: string;
    helpRowArrow: string;
    helpRowWheel: string;
    helpRowCtrlWheel: string;
    helpRowDrag: string;
    helpRowShiftDrag: string;
    helpRowQuestion: string;
    helpRowEsc: string;
    helpRowMuteSolo: string;
    helpRowZoomKeys: string;
    playbackTimePrefix: string;
    playbackDisplayTitle: string;
    clipBadgeTitle: string;
    loopTimeDisplayTitle: string;
    btnFollowCursor: string;
    btnFollowCursorTitle: string;
}

const STRINGS: Record<SupportedLocale, UiStrings> = {
    en: {
        panelTitle: 'Comparison Panel',
        panelTitlePrefix: 'Audio Analyzer: ',
        panelComparePrefix: 'Audio Compare: ',
        emptyAllExcluded: 'All tracks are excluded',
        emptyNoTracks: 'Files checked in the left tree appear here as tracks',
        selectionHeader: 'Select files to analyze',
        btnOpenFile: 'Open File',
        btnOpenAnotherFolder: 'Open another folder',
        btnOpenFolder: 'Open Folder',
        btnSelectAll: 'Select all',
        btnClear: 'Clear',
        selectionCountLabel: 'selected',
        selectionNoSupported: 'No supported audio files found.',
        spectrumSectionTitle: 'Power spectrum at cursor (all tracks overlaid)',
        toolbarMain: '⚡ Main',
        toolbarTrackLabel: 'Track:',
        btnWaveform: 'Waveform',
        btnSpectrogram: 'Spectrogram',
        btnSpectrogramSettingsTitle: 'Spectrogram settings',
        toolbarZoomLabel: 'Zoom:',
        btnZoomReset: 'Reset',
        btnRunRecipe: 'Run recipe',
        chartSpecNoResults: 'Recipe returned no charts.',
        chartSpecScalarLabelHeader: 'Label',
        chartSpecScalarValueHeader: 'Value',
        chartSpecScalarUnitHeader: 'Unit',
        cursorDisplayHint: 'Fine-tune with ← →',
        loopBadge: '🔁 Looping',
        trackPlayTitle: 'Play / pause',
        trackStopTitle: 'Stop',
        trackOffsetResetHint: 'Double-click to reset',
        trackSpectrumTitle: 'Power spectrum at main cursor',
        analysisFailed: 'Analysis failed: ',
        cursorHelpKeys: '← →: move cursor   Shift+←→: 100 ms step   Space: play/pause',
        tooltipLoopResize: 'Drag to resize loop region',
        tooltipLoopClear: 'Click to clear loop',
        tooltipLoopOrShift: 'Drag: set loop region\\nShift+Drag: shift track in time',
        canvasOutOfRange: 'Out of range',
        spectrumNoData: 'No track has data at the cursor position',
        settingsApplyHint: 'Click Apply to commit changes',
        reanalyzingStft: 'Recomputing STFT…',
        reanalyzingDefault: 'Recomputing…',
        reanalyzingFiles: 'Recomputing STFT… ({count} files)',
        configurePython: 'Configure Python environment',
        helpTitle: 'Keyboard Shortcuts',
        helpClose: 'Close (Esc / ?)',
        helpRowSpace: 'play / pause',
        helpRowArrow: 'move cursor  (Shift: fast)',
        helpRowWheel: 'zoom  (Shift: scroll)',
        helpRowCtrlWheel: 'zoom (alternative)',
        helpRowDrag: 'create / resize loop',
        helpRowShiftDrag: 'adjust track offset',
        helpRowQuestion: 'toggle this help',
        helpRowEsc: 'close popover / help',
        helpRowMuteSolo: 'mute / solo active track (focused, last played, or first)',
        helpRowZoomKeys: 'zoom in / out / reset',
        playbackTimePrefix: '▶',
        playbackDisplayTitle: 'Playback position',
        clipBadgeTitle: 'Peak ≥ 0.99 — possible clipping',
        loopTimeDisplayTitle: 'Click to copy loop range',
        btnFollowCursor: 'Follow',
        btnFollowCursorTitle: 'Auto-scroll to keep cursor centered during playback',
    },
    ja: {
        panelTitle: '比較パネル',
        panelTitlePrefix: 'Audio Analyzer: ',
        panelComparePrefix: 'Audio Compare: ',
        emptyAllExcluded: 'すべてのトラックが除外されています',
        emptyNoTracks: '左のツリーでチェックしたファイルがここにトラックとして表示されます',
        selectionHeader: '選択して解析',
        btnOpenFile: 'ファイルを開く',
        btnOpenAnotherFolder: '別のフォルダを開く',
        btnOpenFolder: 'フォルダを開く',
        btnSelectAll: 'すべて選択',
        btnClear: 'クリア',
        selectionCountLabel: '件を選択中',
        selectionNoSupported: '対応する音声ファイルは見つかりませんでした。',
        spectrumSectionTitle: 'カーソル時刻のパワースペクトル（全トラック重ね合わせ）',
        toolbarMain: '⚡ メイン',
        toolbarTrackLabel: 'トラック:',
        btnWaveform: '波形',
        btnSpectrogram: 'スペクトログラム',
        btnSpectrogramSettingsTitle: 'スペクトログラム設定',
        toolbarZoomLabel: 'ズーム:',
        btnZoomReset: 'リセット',
        btnRunRecipe: 'レシピ実行',
        chartSpecNoResults: 'レシピは何もチャートを返しませんでした。',
        chartSpecScalarLabelHeader: '項目',
        chartSpecScalarValueHeader: '値',
        chartSpecScalarUnitHeader: '単位',
        cursorDisplayHint: '← →キーで微調整できます',
        loopBadge: '🔁 ループ再生中',
        trackPlayTitle: '再生 / 一時停止',
        trackStopTitle: '停止',
        trackOffsetResetHint: 'ダブルクリックでリセット',
        trackSpectrumTitle: 'メインカーソル時刻のパワースペクトル',
        analysisFailed: '解析失敗: ',
        cursorHelpKeys: '← →: カーソル移動　Shift+←→: 100ms移動　Space: 再生/停止',
        tooltipLoopResize: 'ドラッグでループ区間をリサイズ',
        tooltipLoopClear: 'クリックでループ解除',
        tooltipLoopOrShift: 'ドラッグ: ループ区間を設定\\nShift+ドラッグ: トラックの時間をずらす',
        canvasOutOfRange: '範囲外',
        spectrumNoData: 'カーソル位置にデータがあるトラックがありません',
        settingsApplyHint: '変更は「適用」で反映',
        reanalyzingStft: 'STFT を再計算中…',
        reanalyzingDefault: '再計算中…',
        reanalyzingFiles: 'STFT を再計算中… ({count} ファイル)',
        configurePython: 'Python 環境を設定する',
        helpTitle: 'キーボードショートカット',
        helpClose: '閉じる (Esc / ?)',
        helpRowSpace: '再生 / 停止',
        helpRowArrow: 'カーソル移動 (Shift: 高速)',
        helpRowWheel: 'ズーム (Shift: 横スクロール)',
        helpRowCtrlWheel: 'ズーム (代替)',
        helpRowDrag: 'ループ作成 / リサイズ',
        helpRowShiftDrag: 'トラックのオフセット調整',
        helpRowQuestion: 'このヘルプを開閉',
        helpRowEsc: 'ポップオーバー / ヘルプを閉じる',
        helpRowMuteSolo: 'アクティブなトラックをミュート / ソロ（フォーカス中・最後に再生・先頭）',
        helpRowZoomKeys: 'ズームイン / アウト / リセット',
        playbackTimePrefix: '▶',
        playbackDisplayTitle: '再生位置',
        clipBadgeTitle: 'ピーク ≥ 0.99 — クリッピングの可能性',
        loopTimeDisplayTitle: 'クリックでループ範囲をコピー',
        btnFollowCursor: '追従',
        btnFollowCursorTitle: '再生中にカーソルを中央に保つ',
    },
};

/**
 * VS Code の言語 (例: 'ja', 'en-US') から SupportedLocale を選ぶ。
 * 'ja' で始まる場合のみ日本語、それ以外は英語フォールバック。
 */
export function pickLocale(language: string | undefined): SupportedLocale {
    if (typeof language !== 'string') { return 'en'; }
    return language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function getStrings(language: string | undefined): UiStrings {
    return STRINGS[pickLocale(language)];
}

/** テストや拡張ホスト側で必要なときのために辞書全体を露出する。 */
export function getAllStrings(): Record<SupportedLocale, UiStrings> {
    return STRINGS;
}
