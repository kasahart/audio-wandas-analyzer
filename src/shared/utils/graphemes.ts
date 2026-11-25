/**
 * A text's characters as seen (grapheme clusters), so a cut between them never splits a surrogate pair (an emoji)
 * or a base from its combining mark (a macOS file name in NFD: カ + ゙). Every place that shortens a file name by
 * cutting it counts in these: the folder table, the track header, the PNG export's row labels and legend.
 */
export function graphemes(text: string): string[] {
    const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string }> } }).Segmenter;
    if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
    // Without Intl.Segmenter: code points, each combining mark (and emoji modifier / joiner run) kept with the character before it.
    const out: string[] = [];
    let join = false;
    for (const point of text) {
        if (out.length && (join || /[\p{M}\u{1F3FB}-\u{1F3FF}‍]/u.test(point))) out[out.length - 1] += point; else out.push(point);
        join = point === '‍';
    }
    return out;
}
