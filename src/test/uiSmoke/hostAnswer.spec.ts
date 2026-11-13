import { expect, settled, test } from './canvasAudit';
import { postLastAnswer } from './realBackend';

/**
 * settled() waits for a request the page posted to the host until the page has read its answer, not until the answer
 * is sent (realBackend.ts postLastAnswer; the tracker counts the answer's message until it is delivered). The answer
 * is a window message, delivered in a task after the one that posts it; counted as done when it is sent, the page
 * looked quiet with the answer still on its way, and a test
 * read the page as it was before it (an empty readout while the read's full data was pending), more often the more
 * loaded the machine. Checked within the very task that posts the answer, so the outcome never depends on timing.
 */
test('settled() counts a host request as answered only once the page has read the answer, not when it is sent', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body><p id="read"></p><script>
        window.__uiSmokePostedMessages = [];
        window.addEventListener('message', event => { if (event.data && event.data.type === 'read-result') document.getElementById('read').textContent = String(event.data.value); });
    </script></body></html>`);
    await page.addScriptTag({ content: `window.__postLastAnswer = ${postLastAnswer.toString()};` });
    const inTheTaskThatAnswers = await page.evaluate(() => {
        type Settle = { busy(): number; awaitHost(types: readonly string[]): void };
        const win = window as unknown as { __settle: Settle; __uiSmokePostedMessages: unknown[]; __postLastAnswer(answer: unknown): void };
        win.__settle.awaitHost(['read']);
        win.__uiSmokePostedMessages.push({ type: 'read', requestId: 'r1' });
        const asked = win.__settle.busy();
        win.__postLastAnswer({ data: { type: 'read-result', requestId: 'r1', value: 42 }, requestId: 'r1' });
        return { asked, sent: win.__settle.busy(), shown: document.getElementById('read')!.textContent };
    });
    expect(inTheTaskThatAnswers.asked, 'the request posted is one the page waits for').toBeGreaterThan(0);
    expect(inTheTaskThatAnswers.shown, 'the answer is not read yet in the task that sends it').toBe('');
    expect(inTheTaskThatAnswers.sent, 'settled() must still wait: the answer is sent but the page has not read it, so what it shows is from before it').toBeGreaterThan(0);
    expect(await settled(page)).toBe(true);
    await expect(page.locator('#read')).toHaveText('42');
    expect(await page.evaluate(() => (window as unknown as { __settle: { busy(): number } }).__settle.busy())).toBe(0);
});

/**
 * settled() waits for a message the page posts to itself (window.postMessage) until the page has read it. The ui-smoke
 * stand-in host answers a request from a short timer that posts the answer (buildHtml.ts: a readout's read, a
 * 'compare-combine', a cursor spectrum's slice), and a test posts a scan's results the same way: the timer is counted
 * until it runs, but the message it posts arrives in a task of its own after it. Not counted, the page looked quiet in
 * between (no frame, timer or request outstanding), and under load settled() could end there: the test then read the
 * page as it was before the answer, e.g. an empty readout while the read's full data was on its way (R7), and failed
 * on the page's correct behaviour (plotContract.spec.ts, a ChannelFrameSegments' overlay: 'readout' and 'step').
 * Checked within the very task that posts the answer, so the outcome never depends on timing.
 */
test('settled() waits for a message the page posts to itself until the page has read it: a stand-in host\'s answer from a timer', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body><p id="read"></p><script>
        window.addEventListener('message', event => { if (event.data && event.data.type === 'read-result') document.getElementById('read').textContent = String(event.data.value); });
    </script></body></html>`);
    // As the stand-in host answers: a timer of 0 ms whose callback posts the answer to the page.
    const inTheTaskThatAnswers = await page.evaluate(() => new Promise<{ before: number; sent: number; shown: string }>(resolve => {
        const settle = (window as unknown as { __settle: { busy(): number } }).__settle;
        window.setTimeout(() => {
            const before = settle.busy();
            window.postMessage({ type: 'read-result', value: 42 }, '*');
            resolve({ before, sent: settle.busy(), shown: document.getElementById('read')!.textContent ?? '' });
        }, 0);
    }));
    expect(inTheTaskThatAnswers.before, 'nothing else is outstanding as the timer runs').toBe(0);
    expect(inTheTaskThatAnswers.shown, 'the answer is not read yet in the task that sends it').toBe('');
    expect(inTheTaskThatAnswers.sent, 'settled() must still wait: the answer is posted but the page has not read it, so what it shows is from before it').toBeGreaterThan(0);
    expect(await settled(page)).toBe(true);
    await expect(page.locator('#read')).toHaveText('42');
    expect(await page.evaluate(() => (window as unknown as { __settle: { busy(): number } }).__settle.busy()), 'read, the message no longer counts').toBe(0);
});
