import { middleEllipsis } from '../../shared/dataset/datasetTable';
import type { UiStrings } from '../../shared/i18n/strings';

/** A row's two lines for answers that failed: the summary in the sentence, then the backend's text, both shortened. */
export function spectrogramFailureText(strings: Pick<UiStrings, 'spectrogramFailed'>, reason: string): string {
    const [summary = '', ...detail] = reason.split('\n');
    const first = strings.spectrogramFailed.replace('{reason}', () => middleEllipsis(summary, 120));
    return detail.length ? `${first}\n${middleEllipsis(detail.join(' '), 120)}` : first;
}

