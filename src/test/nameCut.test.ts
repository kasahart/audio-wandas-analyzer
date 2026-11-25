import assert from 'node:assert/strict';
import test from 'node:test';
import { middleEllipsis } from '../shared/dataset/datasetTable';
import { graphemes } from '../shared/utils/graphemes';
import { nameHtml } from '../webview/runtime/entryTableHtml';

// Rule (#845): a shortened or split name is cut between characters as seen (graphemes), never inside one: not inside a
// surrogate pair (an emoji, shown as two �), not between a base and its combining mark (a macOS name in NFD: カ + ゙
// would draw ゙ alone). If this fails, count with `graphemes()` (src/shared/utils/graphemes.ts), not `.length`/`.slice`.
const NAMES = [
    '20261025_計測_前方マイク_ガギグゲゴ_パピプペポ_0042.wav'.normalize('NFD'),
    'L1_900rpm_microphone_front_🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵🎵_run001.wav',
    'L1_900rpm_microphone_front_👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽👍🏽_run001.wav',
    'L1_900rpm_microphone_front_👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧_run001.wav',
];
const cutInside = (before: string, after: string): boolean =>
    /[\uD800-\uDBFF]$/.test(before) || /^[\uDC00-\uDFFF]/.test(after) || /^[\p{M}\u{1F3FB}-\u{1F3FF}‍]/u.test(after) || /‍$/.test(before);

test('the folder table\'s shortened name cuts between characters as seen (#845)', () => {
    for (const name of NAMES) {
        for (const max of [12, 18, 24, 34, 48]) {
            const short = middleEllipsis(name, max);
            assert.equal(graphemes(short).length, Math.min(max, graphemes(name).length), `${name} @${max}`);
            const [head, tail] = short.split('…');
            assert.ok(!cutInside(head, tail ?? ''), `${name} @${max}: ${head} | ${tail}`);
            assert.ok(name.startsWith(head) && name.endsWith(tail ?? ''), `${name} @${max}`);
        }
    }
    // ASCII names are cut as before.
    assert.equal(middleEllipsis('20261025_motorA_L2_1500rpm_0042.wav', 24), '20261025_…00rpm_0042.wav');
});

test('the folder table\'s split name keeps its two halves whole characters, and the whole name for screen readers (#845)', () => {
    for (const name of [...NAMES, 'L1_900rpm_ガ12345678.wav'.normalize('NFD'), 'L1_900rpm_🎵12345678.wav']) {
        const html = nameHtml(name, '/m/x');
        const parts = /<span class="entry-nm-head" aria-hidden="true">(.*?)<\/span><span class="entry-nm-tail" aria-hidden="true">(.*?)<\/span>/u.exec(html);
        assert.ok(parts, name);
        assert.ok(!cutInside(parts[1], parts[2]), `${name}: ${parts[1]} | ${parts[2]}`);
        assert.equal(graphemes(parts[2]).length, 10, name);
        assert.ok(html.includes(`<span class="entry-nm-full">${name}</span>`), name);
    }
    assert.equal(nameHtml('Rec_0012.wav', '/m/Rec_0012.wav'), '<span class="entry-nm" title="/m/Rec_0012.wav">Rec_0012.wav</span>');
});

test('graphemes keep marks, skin tones and joined emoji with their base, with or without Intl.Segmenter', () => {
    const expected = ['ガ'.normalize('NFD'), '👍🏽', '👨‍👩‍👧', 'a'];
    assert.deepEqual(graphemes(expected.join('')), expected);
    const saved = (Intl as { Segmenter?: unknown }).Segmenter;
    try {
        (Intl as { Segmenter?: unknown }).Segmenter = undefined;
        assert.deepEqual(graphemes(expected.join('')), expected);
    } finally {
        (Intl as { Segmenter?: unknown }).Segmenter = saved;
    }
});
