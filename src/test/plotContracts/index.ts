/**
 * The plot contract table gathered from its charts' files (charts/<id>.ts, one per chart so branches changing
 * different charts do not collide). docs/plot-contracts.md is rendered from it (render.ts); src/test/plotContracts.test.ts
 * holds it to the code.
 *
 * The comparison's figures (the overlay, its Δ, a lane a recording, the lanes under a trigger), the Tracks screen's
 * rows (a channel's waveform and spectrogram, their axes and colour bar; only the time ruler over them is the
 * screen's own, charts/time-ruler.ts) and its two bottom figures (the cursor
 * spectrum, the pair figure) are on the new figure path and are no charts of this table: their contract is the figure service's and the Figure's own tests
 * (docs/figure-list.md lists which figure is on which path).
 */
import { trackHeader } from './charts/track-header';
import { trackPng } from './charts/track-png';
import { timeRuler } from './charts/time-ruler';
import { pairView } from './charts/pair-view';
import { entryTable } from './charts/entry-table';
import { reportFiles } from './charts/report-files';
import { analysisReport } from './charts/analysis-report';
import type { Chart, ChartContract, ContractRow, Severity } from './model';

/** Every chart's file, in the order the doc lists them. A file in charts/ not listed here fails the test. */
export const CONTRACTS: readonly ChartContract[] = [trackHeader, timeRuler, trackPng, pairView, entryTable, reportFiles, analysisReport];

export const CHARTS: readonly Chart[] = CONTRACTS.map(contract => contract.chart);
export const ROWS: readonly ContractRow[] = CONTRACTS.flatMap(contract => contract.rows.map(row => ({ ...row, chart: contract.chart.id })));
export const KNOWN_GAPS: Readonly<Record<string, Severity>> = Object.assign({}, ...CONTRACTS.map(contract => contract.knownGaps)) as Record<string, Severity>;

/**
 * How many gaps the table may hold, by severity. A change may only lower these: one that closes a gap lowers its
 * count here; one that finds a new gap is a change review should stop (or it closes another of the same severity).
 */
export const GAP_CEILING: Readonly<Record<Severity, number>> = { P1: 0, P2: 0, P3: 0 };
