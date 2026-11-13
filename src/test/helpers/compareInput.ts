/**
 * The comparison's input as the entry screen makes it (entryBase), from answers: the compared file's answer, and the
 * base's one FigureSet built by figureModel (figureUsed of the compared file's identity). Tests take this instead of
 * gathering a base themselves, so a median, n or heading of theirs is of a FigureSet too.
 */
import type { ScanResult } from '../../shared/protocol/backendProtocol';
import { scanAnswer, type ScanAnswer } from '../../webview/runtime/answerStore';
import { buildCompareModel, type CompareInput, type CompareModel, type CompareStrings } from '../../webview/runtime/comparePanes';
import type { EntryModel } from '../../webview/runtime/entryTable';
import { figureUsed, scanIdentity } from '../../webview/runtime/figureModel';

/** A file's answer from a results map: pending without a result (never assumed read). */
export const answerIn = (results: ReadonlyMap<string, ScanResult>) => (path: string): ScanAnswer => scanAnswer(path, results.get(path));

/** The comparison's input: slot 0 (`basePath`), else the given group, else the compared file's condition without it. */
export function compareInputOf(
    model: Pick<EntryModel, 'rows' | 'groups'>,
    results: ReadonlyMap<string, ScanResult>,
    comparePath: string | null,
    basePath: string | null,
    strings: Pick<CompareStrings, 'entryBaseGroup' | 'entryCount'>,
    group?: { paths: readonly string[]; title: string; pending?: readonly string[] },
): CompareInput {
    const answer = answerIn(results);
    const compared = comparePath ? answer(comparePath) : undefined;
    const of = scanIdentity(compared);
    const groupOf = (path: string): string[] => {
        const row = model.rows.find(item => item.filePath === path);
        return (row?.group ? model.groups.get(row.group) ?? [] : []).map(member => member.filePath);
    };
    if (basePath) {
        const slot = answer(basePath);
        const peers = groupOf(basePath).filter(path => path !== basePath && path !== comparePath);
        return { compared, base: { kind: 'file', answer: slot, set: figureUsed(of, [slot]), peers: figureUsed(scanIdentity(slot), peers.map(answer)) } };
    }
    if (!comparePath) return { compared, base: null };
    if (group) {
        const members = [...group.paths.filter(path => path !== comparePath).map(answer), ...(group.pending ?? []).map(path => scanAnswer(path, undefined))];
        return { compared, base: { kind: 'group', set: figureUsed(of, members), title: group.title } };
    }
    const row = model.rows.find(item => item.filePath === comparePath);
    if (!row?.group) return { compared, base: null };
    const set = figureUsed(of, groupOf(comparePath).filter(path => path !== comparePath).map(answer));
    const title = [strings.entryBaseGroup, ...row.conditions, strings.entryCount.replace('{count}', String(set.n))].join(' · ');
    return { compared, base: { kind: 'group', set, title } };
}

/** buildCompareModel of the input above (the old call's arguments, in its order). */
export function compareOf(
    model: Pick<EntryModel, 'rows' | 'groups'>,
    results: ReadonlyMap<string, ScanResult>,
    comparePath: string | null,
    basePath: string | null,
    strings: CompareStrings,
    entryRegionBase = false,
    headlineWithinDb?: number,
    group?: { paths: readonly string[]; title: string; pending?: readonly string[] },
): CompareModel {
    return buildCompareModel(compareInputOf(model, results, comparePath, basePath, strings, group), strings, entryRegionBase, headlineWithinDb);
}
