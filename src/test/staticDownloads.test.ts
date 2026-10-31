import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaticDownloads } from '../webview/runtime/staticDownloads';

function fakeBrowser() {
    const clicked: Array<{ href: string; download: string }> = [];
    const blobs = new Map<string, Blob>();
    const revoked: string[] = [];
    const timers: Array<() => void> = [];
    const downloads = createStaticDownloads({
        document: { createElement: () => { const link = { href: '', download: '', click: () => clicked.push({ href: link.href, download: link.download }) }; return link; } } as unknown as Document,
        URL: { createObjectURL: (blob: Blob) => { const url = `blob:${blobs.size + 1}`; blobs.set(url, blob); return url; }, revokeObjectURL: (url: string) => { revoked.push(url); } },
        setTimeout: ((callback: () => void) => { timers.push(callback); return 0; }) as never,
    });
    return { downloads, clicked, blobs, revoked, timers };
}
const text = async (blob: Blob | undefined): Promise<string> => new TextDecoder().decode(await blob!.arrayBuffer());
const isZip = async (blob: Blob | undefined): Promise<boolean> => new Uint32Array((await blob!.arrayBuffer()).slice(0, 4))[0] === 0x04034b50;

test('a text download names the file, keeps its type and frees the URL a second later', async () => {
    const browser = fakeBrowser();
    browser.downloads.text('# Report', 'report.md', 'text/markdown');
    assert.deepEqual(browser.clicked, [{ href: 'blob:1', download: 'report.md' }]);
    const blob = browser.blobs.get('blob:1');
    assert.equal(blob?.type, 'text/markdown');
    assert.equal(await text(blob), '# Report');
    assert.deepEqual(browser.revoked, []);
    browser.timers.forEach(run => run());
    assert.deepEqual(browser.revoked, ['blob:1']);
});

test('one exported region downloads as its WAV, several as one zip, none as nothing', async () => {
    const limits = { maxEntries: 8, maxBytes: 1024 };
    const none = fakeBrowser();
    assert.equal(none.downloads.wavRegions(limits).complete(), false);
    assert.equal(none.clicked.length, 0);

    const one = fakeBrowser();
    const single = one.downloads.wavRegions(limits);
    single.add('a_region.wav', btoa('RIFF'));
    assert.equal(single.complete(), true);
    assert.deepEqual(one.clicked.map(link => link.download), ['a_region.wav']);
    assert.equal(one.blobs.get('blob:1')?.type, 'audio/wav');
    assert.equal(await text(one.blobs.get('blob:1')), 'RIFF');

    const many = fakeBrowser();
    const both = many.downloads.wavRegions(limits);
    both.add('a.wav', btoa('RIFF'));
    both.add('b.wav', btoa('RIFF'));
    assert.equal(both.complete(), true);
    assert.deepEqual(many.clicked.map(link => link.download), ['selected-regions.zip']);
    assert.equal(many.blobs.get('blob:1')?.type, 'application/zip');
    assert.ok(await isZip(many.blobs.get('blob:1')));
});

test('the zip of regions holds to the session limits', () => {
    const browser = fakeBrowser();
    const regions = browser.downloads.wavRegions({ maxEntries: 1, maxBytes: 1024 });
    regions.add('a.wav', btoa('RIFF'));
    regions.add('b.wav', btoa('RIFF'));
    assert.throws(() => regions.complete(), /ZIP exceeds browser export limits/);
    assert.equal(browser.clicked.length, 0);
});

test('a report folder downloads as a zip named after it', async () => {
    const browser = fakeBrowser();
    browser.downloads.folder('report-2026', [{ name: 'report.md', bytes: new TextEncoder().encode('# r') }]);
    assert.deepEqual(browser.clicked.map(link => link.download), ['report-2026.zip']);
    assert.ok(await isZip(browser.blobs.get('blob:1')));
    assert.throws(() => browser.downloads.folder('big', Array.from({ length: 17 }, (_, index) => ({ name: `${index}.md`, bytes: new Uint8Array(1) }))), /ZIP exceeds/);
});
