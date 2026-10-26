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
    entry: boolean;
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
        entry: selection?.entry === true,
        pythonEnvironmentState: selection?.pythonEnvironmentState ?? {
            pythonCommand: 'python3',
            status: 'normal',
            tooltip: 'Click to select Python environment',
        },
    };
}

/** The view state as it was saved, each field kept only when it still has its type (a newer or older build's is dropped). */
export function sanitizePersistedState(saved: unknown): PersistedWebviewState {
    const raw = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
    const csv = raw['entryCsv'] as { name?: unknown; text?: unknown } | undefined;
    const slots = raw['entrySlots'];
    return {
        ...(raw['contentType'] === 'waveform' || raw['contentType'] === 'spectrogram' ? { contentType: raw['contentType'] } : {}),
        ...(raw['spectrumBandsPerOctave'] === 0 || raw['spectrumBandsPerOctave'] === 1 || raw['spectrumBandsPerOctave'] === 3 ? { spectrumBandsPerOctave: raw['spectrumBandsPerOctave'] } : {}),
        ...(typeof raw['sidebarCollapsed'] === 'boolean' ? { sidebarCollapsed: raw['sidebarCollapsed'] } : {}),
        ...(typeof raw['spectrumCollapsed'] === 'boolean' ? { spectrumCollapsed: raw['spectrumCollapsed'] } : {}),
        ...(Array.isArray(slots) && slots.every(slot => slot === null || typeof slot === 'string') ? { entrySlots: slots as (string | null)[] } : {}),
        ...(Array.isArray(raw['entryDerived']) ? { entryDerived: raw['entryDerived'] as PersistedWebviewState['entryDerived'] } : {}),
        ...(raw['entryRecipe'] !== undefined && raw['entryRecipe'] !== null ? { entryRecipe: raw['entryRecipe'] } : {}),
        ...(csv && typeof csv.name === 'string' && typeof csv.text === 'string' ? { entryCsv: { name: csv.name, text: csv.text } } : {}),
    };
}

export class PersistedStateStore {
    private state: PersistedWebviewState;

    constructor(private readonly host: WebviewHostApi) {
        this.state = sanitizePersistedState(host.getState());
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
