import { expect, settled, test } from './canvasAudit';
import { postLastAnswer } from './realBackend';

/**
 * settled() waits for a request the page posted to the host until the page has read its answer, not until the answer
 * is sent (realBackend.ts postLastAnswer). The answer is a window message, delivered in a task after the one that
 * posts it; counted as answered when it is sent, the page looked quiet with the answer still on its way, and a test
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
