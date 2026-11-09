/**
 * The ui-smoke tests wait for what the page does, never for a fixed time (canvasAudit.ts settled(), expect.poll,
 * Playwright's own retrying expects): a fixed wait passes on a fast machine and fails on a loaded one, which reads the
 * page before it has answered. A fixed wait is kept only where the time itself is what is tested (a key held longer
 * than a tap, a pause that ends a swipe, playback counted over a span); each is listed in TIMED with why. The list
 * only shrinks: an entry that no longer matches a wait fails too.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(__dirname, '..', '..');
const UI_SMOKE = 'src/test/uiSmoke';

/** Fixed waits that test a time, by file and the line's text (trimmed). */
const TIMED: ReadonlyArray<{ file: string; line: string; why: string }> = [
    { file: 'laneCulling.spec.ts', line: 'await page.waitForTimeout(5600);', why: 'past the answer store\'s 5 s pause, after which a passing failure would be asked again' },
    { file: 'laneCulling.spec.ts', line: 'await page.waitForTimeout(2000);', why: 'a range asked for and never answered stops counting as on its way after a while' },
    { file: 'liveSpectrumExtensionHost.spec.ts', line: 'if (holdRate) await page.waitForTimeout(3000);', why: 'AWA_PERF=1: the response rate is measured over 3 s of playback' },
    { file: 'playbackCursor.spec.ts', line: 'await page.waitForTimeout(400);', why: 'draws counted over a span of playback' },
    { file: 'plotContract.spec.ts', line: 'await plot.page().waitForTimeout(100);', why: 'the interval of a bounded poll for the point read' },
    { file: 'plotContract.spec.ts', line: 'for (let tries = 0; tries < 50 && await plot.getAttribute(\'data-plot-read\') === \'pending\'; tries++) await page.waitForTimeout(100);', why: 'the interval of a bounded poll for a read waiting for its full data' },
    { file: 'plotContract.spec.ts', line: 'if (!keptOut) await page.waitForTimeout(100);', why: 'the interval of a bounded poll for the point kept' },
    { file: 'realBackend.ts', line: 'await new Promise(resolve => setTimeout(resolve, 30));', why: 'the interval at which the bridge to the real backend looks for requests the page posted (settled() waits for their answers)' },
    { file: 'trackCompare.spec.ts', line: 'await page.waitForTimeout(300);', why: 'a slot key held longer than a tap' },
    { file: 'trackSwipe.spec.ts', line: 'await page.waitForTimeout(300);', why: 'a pause between swipes, which starts a new one' },
];

/** Every fixed wait in the ui-smoke sources: Playwright's waitForTimeout, or a promise resolved by a timer. */
function fixedWaits(): Array<{ file: string; line: string }> {
    const found: Array<{ file: string; line: string }> = [];
    for (const file of readdirSync(path.join(repoRoot, UI_SMOKE)).sort()) {
        if (!file.endsWith('.ts')) continue;
        for (const line of readFileSync(path.join(repoRoot, UI_SMOKE, file), 'utf8').split('\n')) {
            if (/\bwaitForTimeout\(|new Promise\([^)]*\)?\s*=>\s*\{?\s*setTimeout\(\s*resolve\b/u.test(line)) found.push({ file, line: line.trim() });
        }
    }
    return found;
}

test('ui-smoke tests wait for the page, not for a fixed time, but where the time is what they test', () => {
    const waits = fixedWaits();
    const listed = (wait: { file: string; line: string }): boolean => TIMED.some(entry => entry.file === wait.file && entry.line === wait.line);
    assert.deepEqual(waits.filter(wait => !listed(wait)).map(wait => `${wait.file}: ${wait.line}`), [],
        'wait for what the page does instead (settled(page) from canvasAudit.ts, expect.poll, a retrying expect), or list a wait that tests a time in TIMED with why');
    assert.deepEqual(TIMED.filter(entry => !waits.some(wait => wait.file === entry.file && wait.line === entry.line)).map(entry => `${entry.file}: ${entry.line}`), [],
        'no longer a fixed wait: take it off TIMED');
});
