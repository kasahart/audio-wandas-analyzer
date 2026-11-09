/**
 * The plot contract table gathered from its charts' files (charts/<id>.ts, one per chart so branches changing
 * different charts do not collide). docs/plot-contracts.md is rendered from it (render.ts); src/test/plotContracts.test.ts
 * holds it to the code.
 */
import { compareOverlay } from './charts/compare-overlay';
import { compareDelta } from './charts/compare-delta';
import { compareLanes } from './charts/compare-lanes';
import { triggerLanes } from './charts/trigger-lanes';
import { trackWaveform } from './charts/track-waveform';
import { trackSpectrogram } from './charts/track-spectrogram';
import { trackAxes } from './charts/track-axes';
import { trackHeader } from './charts/track-header';
import { trackPng } from './charts/track-png';
import { cursorSpectrum } from './charts/cursor-spectrum';
import { spectrumCsv } from './charts/spectrum-csv';
import { pairView } from './charts/pair-view';
import { colourBar } from './charts/colour-bar';
import { entryHeld } from './charts/entry-held';
import { entryOverview } from './charts/entry-overview';
import { entryDistribution } from './charts/entry-distribution';
import { entryTable } from './charts/entry-table';
import { reportOverlay } from './charts/report-overlay';
import { reportDelta } from './charts/report-delta';
import { reportFiles } from './charts/report-files';
import { analysisReport } from './charts/analysis-report';
import type { Chart, ChartContract, ContractRow, Severity } from './model';

/** Every chart's file, in the order the doc lists them. A file in charts/ not listed here fails the test. */
export const CONTRACTS: readonly ChartContract[] = [compareOverlay, compareDelta, compareLanes, triggerLanes, trackWaveform, trackSpectrogram, trackAxes, trackHeader, trackPng, cursorSpectrum, spectrumCsv, pairView, colourBar, entryHeld, entryOverview, entryDistribution, entryTable, reportOverlay, reportDelta, reportFiles, analysisReport];

export const CHARTS: readonly Chart[] = CONTRACTS.map(contract => contract.chart);
export const ROWS: readonly ContractRow[] = CONTRACTS.flatMap(contract => contract.rows.map(row => ({ ...row, chart: contract.chart.id })));
export const KNOWN_GAPS: Readonly<Record<string, Severity>> = Object.assign({}, ...CONTRACTS.map(contract => contract.knownGaps)) as Record<string, Severity>;

/**
 * How many gaps the table may hold, by severity. A change may only lower these: one that closes a gap lowers its
 * count here; one that finds a new gap is a change review should stop (or it closes another of the same severity).
 */
export const GAP_CEILING: Readonly<Record<Severity, number>> = { P1: 3, P2: 12, P3: 0 };
