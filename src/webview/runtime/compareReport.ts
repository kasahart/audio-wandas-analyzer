/**
 * 「報告に」: the comparison written as a folder. What the comparison is of, in words: which recordings are compared
 * (slots 1–3), against which base (as the entry table defines it), over which region, with which chain, with their
 * conditions and memos. And the comparison's figure as it is on show: its PNG and the table of its lines, both made
 * by the figure service from the answers the screen's picture is of (one data id, written in 定義.json). This module
 * makes no number: it puts what it is handed into files.
 */
import type { UiStrings } from '../../shared/i18n/strings';
import type { RecipeDocument } from '../../shared/recipe/recipeSelection';
import { recipeSteps, withDefaults, withParam, TIME_SLICE } from '../../shared/recipe/recipeSteps';
import { withBaseInput, withChannel } from '../../shared/recipe/channelSelection';
import type { EntryRegion } from '../../shared/analysis/entryScan';
import { baseName } from '../../shared/analysis/entryMetadata';
import { csvFile } from '../../shared/utils/csv';
import { regionCells, type BaseDefinition } from './entryBase';

/** A file of the folder: a CSV's or JSON's text, or a PNG's bytes in base64. */
export type ReportFile = { name: string; text: string } | { name: string; base64: string };

/** The comparison's figure as the screen shows it, exported: one data id for the picture and the table. */
export interface ReportFigure {
    dataId: string;
    /** The PNG's bytes, in base64. */
    png: string;
    /** Every answer of its line lanes, unthinned (null: it has no line lane, time signals or images only). */
    table: { header: string[]; rows: string[][] } | null;
}

export type ReportStrings = Pick<UiStrings,
    | 'entryColFile' | 'entryColCondition' | 'entryBase' | 'entryBaseGroup' | 'reportCsv' | 'reportGroupFiles' | 'reportRegionStart' | 'reportRegionEnd'
    | 'reportDefinitions' | 'reportMemo' | 'reportShownValue' | 'dsCh' | 'reportBaseDefinition' | 'reportFigure'>;

/** A compared recording as the entry table has it. */
export interface ReportRow {
    /** Its name with its channel ("run018 ch2"). */
    label: string;
    /** The value on show in the table (a CSV column's), as text. */
    value: string;
    memo: string;
    /** The channel it is compared as (null: its channels together). */
    channel: number | null;
    /** What it is compared against, and that base's recordings. */
    base: BaseDefinition;
    /** Its cells of the condition columns, in their order. */
    cells: readonly string[];
}

export interface ReportInput {
    /** The slots' recordings: 0 the base (or null for a group), 1–3 the compared. */
    slots: readonly (string | null)[];
    region: EntryRegion | null;
    recipe: RecipeDocument | null;
    recipeName: string;
    now: Date;
    /** The table's condition columns (the CSV's and the folders'). */
    columns: readonly string[];
    row(path: string): ReportRow;
    /** What the table was narrowed to. */
    selection?: { value: string; group: string; filters: string[]; excluded: number };
    /** Cross-channel steps measured against the base slot's recording: written with a `base` input. */
    slotReference?: readonly string[];
    /** The step of the chain the figure shows (its id in the Recipe; the input, or the chain's end, as the bar has it). */
    stage?: string | null;
    /**
     * The events left out of a trigger's, a recording each (picked on the comparison). The Recipe file is one for every
     * recording, so it drops none: the folder says them here, for a reader who runs the Recipe to drop the same.
     */
    excluded?: ReadonlyArray<{ trigger: string; path: string; channel: number | null; ids: readonly number[] }>;
    /** The figure on show (null or absent: none is, and the folder is of words only). */
    figure?: ReportFigure | null;
}

/** A base as one line: the slot-0 recording, or the group, its channel and the filters it was taken within. */
export function baseDefinitionText(definition: BaseDefinition, strings: Pick<UiStrings, 'entryBase' | 'entryBaseGroup'>): string {
    const what = definition.kind === 'file' ? `${strings.entryBase} ${definition.file ?? ''}` : `${strings.entryBaseGroup} ${[definition.group?.column, definition.group?.name].filter(Boolean).join(' ')}`.trim();
    return [what, ...(definition.channel ? [`ch${definition.channel}`] : []), ...definition.filters].join(' · ');
}

export function reportFolderName(recipeName: string, now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    return `${recipeName}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** The chain with the region compared as its time slice and every default written out, so wandas replays it as asked. */
export function reportRecipe(recipe: RecipeDocument, region: EntryRegion | null): RecipeDocument {
    const full = withDefaults(recipe);
    const slice = recipeSteps(full).find(step => step.operation === TIME_SLICE);
    if (!slice || !region) return full;
    return withParam(withParam(full, slice.id, { name: 'start', kind: 'float' }, region.start), slice.id, { name: 'end', kind: 'float' }, region.end);
}

const compared = (input: ReportInput): Array<{ slot: number; path: string }> => [1, 2, 3].flatMap(slot => { const path = input.slots[slot]; return path ? [{ slot, path }] : []; });

/**
 * 報告.csv: one row per slot 1–3. Text only (no analysis value): the recording, its conditions, the region compared,
 * its base's recordings, its channel, the table's value on show, its memo and its base in words. UTF-8 with a BOM.
 */
export function reportCsv(input: ReportInput, strings: ReportStrings): string {
    const header = [
        strings.entryColFile, ...input.columns.map((column, index) => column || strings.entryColCondition.replace('{n}', String(index + 1))),
        strings.reportRegionStart, strings.reportRegionEnd, strings.reportGroupFiles,
        strings.dsCh, ...(input.selection ? [strings.reportShownValue.replace('{value}', () => input.selection?.value ?? '')] : []), strings.reportMemo, strings.reportBaseDefinition,
    ];
    const lines = compared(input).map(({ path }) => {
        const row = input.row(path);
        return [
            row.label || baseName(path), ...input.columns.map((_, index) => row.cells[index] ?? ''), ...regionCells(input.region),
            row.base.files.join(';'), row.channel ? String(row.channel) : '', ...(input.selection ? [row.value] : []), row.memo, baseDefinitionText(row.base, strings),
        ];
    });
    return csvFile(header, lines);
}

/** 定義.json: what the comparison was of, in words and decimals (the Recipe file's own floats are hex). */
export function reportDefinitions(input: ReportInput, figureFiles: readonly string[] = [], recipeFiles: readonly string[] = [`${input.recipeName}.recipe.json`]): Record<string, unknown> {
    return {
        // The answers the figure's files are of: the id the screen's picture had when they were written.
        ...(input.figure ? { figure: { dataId: input.figure.dataId, files: figureFiles } } : {}),
        region: input.region ? { startS: input.region.start, endS: input.region.end } : null,
        // The Recipe files of this folder (one a channel when the slots compare different channels).
        recipes: Object.fromEntries(recipeFiles.map(name => [name, 'the chain the comparison runs, with the region compared as its time slice'])),
        // Which step's result the comparison showed (the figure is of it): the chain's steps after it were not run for it.
        ...(input.stage !== undefined ? { shownStep: input.stage } : {}),
        steps: input.recipe ? recipeSteps(reportRecipe(input.recipe, input.region)).map(step => ({ operation: step.operation, params: step.params })) : [],
        ...(input.selection ? { selection: input.selection } : {}),
        // Events picked out on the comparison: the figure is without them, the Recipe file (one for all recordings) is not.
        ...(input.excluded?.length ? { excludedEvents: input.excluded.map(item => ({ step: item.trigger, file: baseName(item.path), path: item.path, channel: item.channel, eventIds: [...item.ids] })) } : {}),
        comparisons: compared(input).map(({ slot, path }) => { const row = input.row(path); return { slot, file: row.label, channel: row.channel, base: row.base }; }),
    };
}

/** Every file of the report folder, in the order they are listed. */
export function reportFiles(input: ReportInput, strings: ReportStrings): { folder: string; files: ReportFile[] } {
    const files: ReportFile[] = [{ name: `${strings.reportCsv}.csv`, text: reportCsv(input, strings) }];
    if (input.recipe) {
        // A compared channel row is that channel in wandas too: a channel step at the Recipe's head; slots of
        // different channels get one Recipe each (".ch2"), the channels together none.
        const channels = [...new Set(compared(input).map(({ path }) => input.row(path).channel))];
        // A chain that compares two channels names its own (withChannel leaves it as it is): one Recipe. One that
        // measures against the base slot takes a channel of each recording, the slots' rows'.
        const slotted = input.slotReference ?? [];
        const ownPair = !slotted.length && withChannel(input.recipe, 1) === input.recipe;
        const variants = ownPair ? [{ suffix: '', ch: null }] : channels.length > 1 ? channels.map(ch => ({ suffix: ch ? `.ch${ch}` : '', ch })) : [{ suffix: '', ch: channels[0] ?? null }];
        const baseChannel = input.slots[0] ? input.row(input.slots[0]).channel : null;
        for (const { suffix, ch } of variants) {
            const recipe = ch ? withChannel(input.recipe, ch, slotted.length > 0) : input.recipe;
            const written = slotted.reduce((paired, id) => withBaseInput(paired, id, { channel: baseChannel }), reportRecipe(recipe, input.region));
            files.push({ name: `${input.recipeName}${suffix}.recipe.json`, text: JSON.stringify(written, null, 2) + '\n' });
        }
    }
    const figureFiles: ReportFile[] = input.figure
        ? [
            { name: `${strings.reportFigure}.png`, base64: input.figure.png },
            ...(input.figure.table ? [{ name: `${strings.reportFigure}.csv`, text: csvFile(input.figure.table.header, input.figure.table.rows) }] : []),
        ]
        : [];
    files.push({ name: `${strings.reportDefinitions}.json`, text: JSON.stringify(reportDefinitions(input, figureFiles.map(file => file.name), files.filter(file => file.name.endsWith('.recipe.json')).map(file => file.name)), null, 2) + '\n' });
    files.push(...figureFiles);
    return { folder: reportFolderName(input.recipeName, input.now), files };
}
