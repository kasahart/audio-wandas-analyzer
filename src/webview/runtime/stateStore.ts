import type { UiStrings } from '../../shared/i18n/strings';
import type { SpectrogramSettings } from '../../shared/analysis/analysisTypes';
import type {
    ComparisonState,
    ComparisonTrackState,
    PersistedWebviewState,
    PythonEnvironmentState,
    WebviewHostApi,
} from './types';

export interface RuntimeState {
    mode: ComparisonState['mode'];
    results: ComparisonTrackState[];
    spectrogramSettings: SpectrogramSettings;
    rootPath: string;
    allFilePaths: string[];
    selectedFilePaths: string[];
    pythonEnvironmentState: PythonEnvironmentState;
}

export function normalizeRuntimeState(state: ComparisonState): RuntimeState {
    const selection = state.mode === 'directory-selection' ? state : undefined;
    return {
        mode: state.mode,
        results: state.results,
        spectrogramSettings: state.spectrogramSettings,
        rootPath: selection?.rootPath ?? '',
        allFilePaths: selection?.allFilePaths ?? [],
        selectedFilePaths: selection?.selectedFilePaths ?? [],
        pythonEnvironmentState: selection?.pythonEnvironmentState ?? {
            pythonCommand: 'python3',
            status: 'normal',
            tooltip: 'Click to select Python environment',
        },
    };
}

export class PersistedStateStore {
    private state: PersistedWebviewState;

    constructor(private readonly host: WebviewHostApi) {
        this.state = host.getState() ?? {};
    }

    get snapshot(): PersistedWebviewState {
        return this.state;
    }

    update(patch: Partial<PersistedWebviewState>): void {
        this.state = { ...this.state, ...patch };
        this.host.setState(this.state);
    }
}

export interface RuntimeResources {
    state: RuntimeState;
    strings: UiStrings;
    persisted: PersistedStateStore;
}

export function reorderInPlace(order: number[], fromStateIndex: number, toStateIndex: number): number[] {
    const fromPosition = order.indexOf(fromStateIndex);
    const toPosition = order.indexOf(toStateIndex);
    if (fromPosition === -1 || toPosition === -1) {
        return order;
    }
    order.splice(fromPosition, 1);
    order.splice(toPosition, 0, fromStateIndex);
    return order;
}
