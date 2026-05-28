export type GuiEntryPointKind =
    | 'welcome-view'
    | 'drag-and-drop'
    | 'explorer-context'
    | 'command'
    | 'status-bar'
    | 'quick-pick'
    | 'selection-toolbar'
    | 'results-toolbar'
    | 'track-control'
    | 'canvas-gesture'
    | 'keyboard'
    | 'dialog';

export type GuiRegressionLayer = 'node:test' | 'ui-smoke' | 'vscode-e2e' | 'planned';

export interface GuiTriggerabilityFeature {
    id: string;
    label: string;
    entryPoints: readonly GuiEntryPointKind[];
    triggers: readonly string[];
    regressionLayers: readonly GuiRegressionLayer[];
}

export const GUI_TRIGGERABILITY_SCOPED_COMMAND_IDS = [
    'audioWandasAnalyzer.analyzeFile',
    'audioWandasAnalyzer.analyzeThisTarget',
    'audioWandasAnalyzer.selectPythonEnvironment',
    'audioWandasAnalyzer.runRecipe',
] as const;

export const GUI_TRIGGERABILITY_EXCLUDED_COMMAND_IDS = [
    'audioWandasAnalyzer.analyzeDebugFile',
] as const;

export const GUI_TRIGGERABILITY_WEBVIEW_ACTION_IDS = [
    'open-file',
    'open-folder',
    'select-python-environment',
    'selection-select-all',
    'selection-clear-all',
    'toggle-directory',
    'content-waveform',
    'content-spectrogram',
    'spectrogram-settings',
    'zoom-out',
    'zoom-in',
    'zoom-reset',
    'spec-zoom-out',
    'spec-zoom-in',
    'spec-zoom-reset',
    'wave-mode-rect-zoom',
    'zoom-to-selection',
    'toggle-follow-cursor',
    'run-recipe',
    'copy-spec',
    'export-png',
    'export-csv',
    'export-wav',
    'export-report',
    'pick-color',
    'toggle-playback',
    'stop-playback',
    'remove-track',
    'offset-up',
    'offset-down',
] as const;

export const GUI_TRIGGERABILITY_SCOPED_SHORTCUTS = [
    'Space',
    '← / →',
    '+ / − / 0',
    'F',
    'L',
    'Wheel',
    'Ctrl+Wheel',
    'Drag (spectrum)',
    'Drag (zoom mode)',
    'Drag',
    'Shift+Drag',
    '?',
    'Esc',
] as const;

export const GUI_TRIGGERABILITY_FEATURES: readonly GuiTriggerabilityFeature[] = [
    {
        id: 'welcome-open-target',
        label: 'Open analysis target from the welcome view',
        entryPoints: ['welcome-view', 'drag-and-drop', 'command'],
        triggers: ['audioWandasAnalyzer.analyzeFile', 'welcome-drop-target'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'explorer-open-target',
        label: 'Open analysis target from the explorer context menu',
        entryPoints: ['explorer-context', 'command'],
        triggers: ['audioWandasAnalyzer.analyzeThisTarget'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'python-environment-selection',
        label: 'Select the Python interpreter from GUI surfaces',
        entryPoints: ['status-bar', 'selection-toolbar', 'results-toolbar', 'quick-pick', 'command'],
        triggers: ['audioWandasAnalyzer.selectPythonEnvironment', 'select-python-environment'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'directory-selection',
        label: 'Select audio files inside directory-selection mode',
        entryPoints: ['selection-toolbar', 'dialog'],
        triggers: ['selection-select-all', 'selection-clear-all', 'toggle-directory', 'analyze-selected-files'],
        regressionLayers: ['node:test', 'vscode-e2e'],
    },
    {
        id: 'open-another-target',
        label: 'Open another file or folder from the comparison panel',
        entryPoints: ['results-toolbar'],
        triggers: ['open-file', 'open-folder'],
        regressionLayers: ['node:test', 'vscode-e2e'],
    },
    {
        id: 'switch-content-view',
        label: 'Switch between waveform and spectrogram views',
        entryPoints: ['results-toolbar'],
        triggers: ['content-waveform', 'content-spectrogram', 'spectrogram-settings'],
        regressionLayers: ['node:test', 'ui-smoke', 'vscode-e2e'],
    },
    {
        id: 'zoom-and-pan',
        label: 'Zoom and pan along the timeline',
        entryPoints: ['results-toolbar', 'canvas-gesture', 'keyboard'],
        triggers: ['zoom-out', 'zoom-in', 'zoom-reset', 'zoom-to-selection', 'toggle-follow-cursor', 'Wheel', 'Ctrl+Wheel', '+ / − / 0', 'F', 'L'],
        regressionLayers: ['node:test', 'vscode-e2e'],
    },
    {
        id: 'spectrogram-zoom',
        label: 'Zoom the spectrogram frequency range',
        entryPoints: ['results-toolbar', 'canvas-gesture'],
        triggers: ['spec-zoom-out', 'spec-zoom-in', 'spec-zoom-reset', 'Drag (spectrum)'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'waveform-mode',
        label: 'Switch waveform interaction mode',
        entryPoints: ['results-toolbar'],
        triggers: ['wave-mode-rect-zoom'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'recipe-runner',
        label: 'Run a wandas recipe from the comparison panel',
        entryPoints: ['results-toolbar', 'command', 'dialog'],
        triggers: ['audioWandasAnalyzer.runRecipe', 'run-recipe'],
        regressionLayers: ['planned'],
    },
    {
        id: 'copy-spec',
        label: 'Copy the analysis spec to the clipboard',
        entryPoints: ['results-toolbar'],
        triggers: ['copy-spec'],
        regressionLayers: ['planned'],
    },
    {
        id: 'export-png',
        label: 'Export the current view as PNG',
        entryPoints: ['results-toolbar'],
        triggers: ['export-png'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'export-csv',
        label: 'Export the current spectrum slice as CSV',
        entryPoints: ['results-toolbar'],
        triggers: ['export-csv'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'export-wav',
        label: 'Export the current loop region as WAV',
        entryPoints: ['results-toolbar', 'dialog'],
        triggers: ['export-wav'],
        regressionLayers: ['planned'],
    },
    {
        id: 'export-report',
        label: 'Export a Markdown or notebook report',
        entryPoints: ['results-toolbar', 'dialog'],
        triggers: ['export-report'],
        regressionLayers: ['planned'],
    },
    {
        id: 'track-visual-controls',
        label: 'Control track color, visibility, and ordering aids',
        entryPoints: ['track-control'],
        triggers: ['pick-color', 'remove-track'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'track-playback',
        label: 'Start and stop per-track playback',
        entryPoints: ['track-control', 'keyboard'],
        triggers: ['toggle-playback', 'stop-playback', 'Space'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'track-offset',
        label: 'Adjust per-track offset with buttons and drag gestures',
        entryPoints: ['track-control', 'canvas-gesture', 'keyboard'],
        triggers: ['offset-up', 'offset-down', 'Drag', 'Shift+Drag', '← / →'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'waveform-canvas-gestures',
        label: 'Create, resize, clear, and reuse loop regions from the waveform canvas',
        entryPoints: ['canvas-gesture', 'keyboard'],
        triggers: ['Drag', 'Drag (zoom mode)', 'Shift+Drag', 'L'],
        regressionLayers: ['node:test', 'planned'],
    },
    {
        id: 'help-overlay',
        label: 'Open and dismiss the keyboard shortcut help overlay',
        entryPoints: ['keyboard', 'dialog'],
        triggers: ['?', 'Esc'],
        regressionLayers: ['ui-smoke'],
    },
] as const;
