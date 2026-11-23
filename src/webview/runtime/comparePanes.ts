/**
 * The comparison's model and panes: the base (a condition's median or one file), the compared
 * file and their difference, each as a region-average spectrum on one frequency axis. Pure apart
 * from `paintPane`, which only draws.
 */
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import type { UiStrings } from '../../shared/i18n/strings';
import type { ChannelSummary } from '../../shared/analysis/analysisTypes';
import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { uncalibratedUnits } from '../../shared/utils/format';
import { noNegativeZero, withMinus } from '../shell/numberText';
import { levelKeyOf, medianInputOf } from './figureModel';

/**
 * What levels are in (display-rules R1, R4): the unit, the reference value and the level reference's label, the one
 * definition the backend keeps too (python-backend/frames/level_identity.py; both held to
 * src/test/fixtures/levelIdentityCases.json). Calibration status is not part of it: a gain-corrected file in FS and a
 * raw one are both in dBFS and compare; each line still says its own status where it is read.
 */
export function levelIdentityOf(input: Pick<LevelInput, 'unit' | 'ref' | 'levelReferenceLabel'>): string {
    return JSON.stringify([input.unit ?? '', Number(input.ref ?? 1), input.levelReferenceLabel ?? '']);
}
const level = (value: number): string => noNegativeZero(withMinus(value.toFixed(1)));

/** One entry of the overlay's legend: a line in its colour and dash, a name, its Leq, and ▶ for one file. */
export interface LegendItem {
    color: string;
    label: string;
    value?: string;
    /** ▶ plays this file. */
    path?: string;
    active?: boolean;
    held?: boolean;
    /** The file's memo: ✎, with the memo as its hint. */
    memo?: string;
    /** The file's role chip (roleChip.ts), before its line. */
    chipHtml?: string;
    /** Its ▶ shows ■ while it plays. */
    playing?: boolean;
    /** Said in the hint footer over its label. */
    hint?: string;
    /** Markup of the caller's own at the item's end (the base group's ▾); interpolated values in it are escaped by the caller. */
    trailingHtml?: string;
}

export function legendHtml(items: readonly LegendItem[], strings: Pick<UiStrings, 'comparePlay'>): string {
    return items.map(item => {
        const mark = `<svg width="18" height="10" aria-hidden="true"><line x1="0" y1="5" x2="18" y2="5" stroke="${item.color}" stroke-width="${item.active ? 3 : 2}"/></svg>`;
        const play = item.path ? `<button type="button" class="compare-play" data-action="compare-play" data-path="${escapeHtml(item.path)}" aria-label="${escapeHtml(strings.comparePlay + ': ' + item.label)}" aria-pressed="${item.playing ? 'true' : 'false'}">${item.playing ? '■' : '▶'}</button>` : '';
        const value = item.value ? ` <span class="compare-value">${escapeHtml(item.value)}</span>` : '';
        const memo = item.memo ? ` <span class="compare-memo" data-memo title="${escapeHtml(item.memo)}" data-hint="${escapeHtml(item.memo)}">✎</span>` : '';
        return `<span class="compare-legend-item${item.active ? ' is-active' : ''}${item.held ? ' is-held' : ''}">${item.chipHtml ?? ''}${mark}<span class="compare-legend-label"${item.hint ? ` title="${escapeHtml(item.hint)}" data-hint="${escapeHtml(item.hint)}"` : ''}>${escapeHtml(item.label)}</span>${value}${memo}${play}${item.trailingHtml ?? ''}</span>`;
    }).join('');
}

export interface PaneRange { min: number; max: number }

/** The plot's left edge: room for the tick numbers and the level axis' name written up the side. */
export { PANE_LEFT } from './paneLayout';

/** A scanned file's level reference as wandas gave it: its unit, reference value and name, its calibration status, and whether its source has a full scale. */
export type LevelInput = Pick<NonNullable<ScanResult['input']>, 'unit' | 'ref' | 'levelReferenceLabel' | 'calibrationStatus' | 'fullScale'>;

/** Uncalibrated levels as wandas names them: relative to full scale (audio), or to 1 input unit (a CSV, which has none). */
export function uncalibratedLevelInput(fullScale: boolean): LevelInput {
    return { unit: fullScale ? 'FS' : '', ref: 1, levelReferenceLabel: uncalibratedUnits(fullScale).level, calibrationStatus: 'uncalibrated', fullScale };
}

/**
 * A track's level reference for the steps view: as the entry table scanned it, else from the track's own analysis
 * (a file opened on its own, or a folder not rescanned yet): its channels' reference when they share one, as the scan
 * judges it (calibrated only if every channel is: a gain correction in FS shares dBFS with an uncalibrated channel),
 * else plain dB (channels calibrated apart share no reference).
 */
export function trackLevelInput(channels: ReadonlyArray<ChannelSummary | null | undefined>, scanned: (LevelInput & { channelCalibration?: ReadonlyArray<LevelInput['calibrationStatus']> }) | undefined, channel: number | null = null): LevelInput {
    // A channel read on its own names that channel's calibration (a file calibrated channel by channel), R4.
    const own = channel ? scanned?.channelCalibration?.[channel - 1] : undefined;
    if (scanned) return { unit: scanned.unit, ref: scanned.ref, levelReferenceLabel: scanned.levelReferenceLabel, calibrationStatus: own ?? scanned.calibrationStatus, fullScale: scanned.fullScale };
    const fullScale = channels.every(channel => !channel || channel.fullScale);
    const measured = channels.map(channel => channel?.measurement);
    const first = measured[0];
    // One level identity (figureModel.levelKeyOf: unit, reference value, level reference name) across the channels.
    const keyOf = (measurement: typeof first): string | null => (measurement ? levelKeyOf({ unit: measurement.referenceUnit, ref: measurement.referenceValue, levelReferenceLabel: measurement.levelReferenceLabel }) : null);
    const shared = !!first && measured.every(measurement => keyOf(measurement) === keyOf(first));
    if (first && shared) {
        const calibrationStatus = medianInputOf(measured)?.calibrationStatus === 'calibrated' ? 'calibrated' : 'uncalibrated';
        return { unit: first.referenceUnit, ref: first.referenceValue, levelReferenceLabel: first.levelReferenceLabel, calibrationStatus, fullScale };
    }
    // Channels of other references read together: named by the first one's, never a bare "dB" (C1). (A picture is
    // of one channel: its caller passes that one.)
    const calibrated = measured.find(measurement => measurement?.calibrationStatus === 'calibrated');
    return calibrated
        ? { unit: calibrated.referenceUnit, ref: calibrated.referenceValue, levelReferenceLabel: calibrated.levelReferenceLabel, calibrationStatus: calibrated.calibrationStatus, fullScale }
        : uncalibratedLevelInput(fullScale);
}

export { level as levelDb };
