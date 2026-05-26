import {
    buildResultsPreviewHtml,
    buildSelectionPreviewHtml,
} from '../test/uiSmoke/buildHtml';

export type ComparisonPreviewMode = 'results' | 'selection';

export function buildComparisonPreviewHtml(mode: ComparisonPreviewMode): string {
    if (mode === 'results') {
        return buildResultsPreviewHtml();
    }
    return buildSelectionPreviewHtml();
}
