import { expect, settled, test, type Page } from './canvasAudit';
import { buildExtensionHostPathUiSmokeHtml } from './buildHtml';
import { CURSOR_FIGURE, drawnFigure, drawnRow, hoverLane, laneOf, PAIR_FIGURE, pointOnLane, rowFigure, ROW_WAVE, seenFigure } from './tracksFigures';


interface PostedMessage {
    type: string;
    reference?: { filePath: string; channelIndex: number };
    responses?: Array<{ filePath: string; channelIndex: number }>;
}

function pairRequests(page: Page): Promise<PostedMessage[]> {
    return page.evaluate(() => ((window as typeof window & { __uiSmokePostedMessages: PostedMessage[] }).__uiSmokePostedMessages)
        .filter(message => message && message.type === 'request-pair-spectrum'));
}

test('a reference lane splits the spectrum section into the power spectrum and the pair view', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const buttons = page.locator('[data-action="set-pair-reference"]');
    await expect(buttons.first()).toBeVisible();
    await expect(page.locator('#pair-spectrum-wrap')).toBeHidden();

    await page.locator('[data-action="spectrum-octave-3"]').click();
    await expect(page.locator('[data-action="spectrum-octave-3"]')).toHaveAttribute('aria-pressed', 'true');

    await buttons.first().click();
    await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(buttons.first().locator('.pair-ref-badge')).toBeVisible();
    await expect(page.locator('#pair-spectrum-wrap')).toBeVisible();
    // The pair view has only an FFT axis, so the octave bands give way to it.
    await expect(page.locator('[data-action="spectrum-fft"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-action="spectrum-octave-1"]')).toBeDisabled();
    await expect(page.locator('[data-action="spectrum-octave-3"]')).toBeDisabled();

    await expect.poll(async () => (await pairRequests(page)).length).toBe(1);
    const [request] = await pairRequests(page);
    const laneCount = await buttons.count();
    expect(request.responses?.length).toBe(laneCount - 1);
    expect(request.responses?.some(source => source.filePath === request.reference?.filePath && source.channelIndex === request.reference?.channelIndex)).toBe(false);

    await expect(page.locator('#pair-spectrum-summary')).toHaveText(/^H1 · \d+ avg · \d+\.\d\d–\d+\.\d\d s$/u);
    await expect(page.locator('.pair-legend-item')).toHaveCount(laneCount - 1);

    // One Figure of three lanes, gain, phase and γ², one above another on one frequency axis: a line a response on each.
    const pair = await drawnFigure(page, PAIR_FIGURE, laneCount - 1);
    expect(pair.lanes.map(lane => [lane.id, lane.lines.length])).toEqual([['gain', laneCount - 1], ['phase', laneCount - 1], ['coherence', laneCount - 1]]);
    // Three lanes share the panel's height (140 px by default): each keeps room to read its line.
    expect(laneOf(pair, 'phase').frame.height).toBeGreaterThan(24);
    await drawnFigure(page, CURSOR_FIGURE);
    expect((await seenFigure(page, CURSOR_FIGURE)).followed).toBeNull();
    // Hovering a lane reads only the line nearest the pointer, in that lane's unit, without asking the host again;
    // the power spectrum marks the frequency read with a line of its own, and reads nothing itself.
    await hoverLane(page, PAIR_FIGURE, 'phase', 0.5);
    await expect(page.locator('#pair-spectrum-readout')).toBeVisible();
    await expect(page.locator('#pair-spectrum-readout')).toHaveText(/ k?Hz \/ −?\d+(\.\d+)?°$/u);
    await expect.poll(async () => (await seenFigure(page, CURSOR_FIGURE)).followed !== null).toBe(true);
    const read = (await seenFigure(page, PAIR_FIGURE)).mark!;
    expect((await seenFigure(page, CURSOR_FIGURE)).followed!.x).toBe(read.x);
    await expect(page.locator('#spectrum-freq-readout')).toHaveText('');
    // And the other way round: a read on the power spectrum is marked on the pair figure.
    await hoverLane(page, CURSOR_FIGURE, undefined, 0.5);
    await expect(page.locator('#spectrum-freq-readout')).toContainText(/ \/ \d+(\.\d+)? k?Hz \/ .* dB\S*$/u);
    await expect.poll(async () => (await seenFigure(page, PAIR_FIGURE)).followed !== null).toBe(true);
    // The pair figure's own read gave way to the mark: the two figures never show two reads at once.
    await expect(page.locator('#pair-spectrum-readout')).toBeHidden();
    expect((await seenFigure(page, PAIR_FIGURE)).mark).toBeNull();
    expect((await seenFigure(page, CURSOR_FIGURE)).followed).toBeNull();
    const overlay = (await page.locator(CURSOR_FIGURE).boundingBox())!;
    const box = (await page.locator(PAIR_FIGURE).boundingBox())!;
    // Both readouts sit at the right end of their own half's header row.
    const readoutRight = async (id: string, pane: string) => {
        const [readout, half] = await Promise.all([page.locator(id).boundingBox(), page.locator(pane).boundingBox()]);
        return Math.round((half!.x + half!.width) - (readout!.x + readout!.width));
    };
    await page.mouse.move(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2);
    await settled(page);
    const powerRight = await readoutRight('#spectrum-freq-readout', '#spectrum-overlay-wrap');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#pair-spectrum-readout')).not.toHaveText('');
    await settled(page);
    expect(await readoutRight('#pair-spectrum-readout', '#pair-spectrum-wrap')).toBe(powerRight);
    await drawnRow(page, 0, 0, true);
    const onTrack = await pointOnLane(page, rowFigure(), ROW_WAVE, 0.7);
    await page.mouse.click(onTrack.x, onTrack.y);
    await settled(page);
    expect((await pairRequests(page)).length).toBe(1);

    // Dragging the divider moves the split.
    const overlayWidth = async () => (await page.locator('#spectrum-overlay-wrap').boundingBox())?.width ?? 0;
    const before = await overlayWidth();
    const divider = await page.locator('#pair-divider').boundingBox();
    if (!divider) throw new Error('pair divider has no layout box');
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x - 150, divider.y + divider.height / 2);
    await page.mouse.up();
    await settled(page);
    expect(await overlayWidth()).toBeLessThan(before - 100);

    await buttons.first().click();
    await expect(page.locator('#pair-spectrum-wrap')).toBeHidden();
    await expect(page.locator('[data-action="spectrum-octave-3"]')).toBeEnabled();
});

test('Save as recipe asks the host for what the bottom panel shows: the bands, then the pairs once a reference is set', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const posted = () => page.evaluate(() => ((window as typeof window & { __uiSmokePostedMessages: Array<Record<string, unknown>> }).__uiSmokePostedMessages)
        .filter(message => message && message.type === 'save-recipe'));
    const save = async () => {
        const workflow = page.locator('#toolbar details.tb-menu').filter({ has: page.locator('[data-action="save-recipe"]') });
        if (await workflow.getAttribute('open') === null) await workflow.locator('summary').click();
        await workflow.locator('[data-action="save-recipe"]').click();
    };
    const buttons = page.locator('[data-action="set-pair-reference"]');
    await expect(buttons.first()).toBeVisible();

    await page.locator('[data-action="spectrum-octave-3"]').click();
    await save();
    await expect.poll(async () => (await posted()).length).toBe(1);
    const [spectrum] = await posted();
    expect(spectrum).toEqual({ type: 'save-recipe', filePath: expect.any(String), bandsPerOctave: 3 });

    await buttons.first().click();
    await expect.poll(async () => (await pairRequests(page)).length).toBe(1);
    const [request] = await pairRequests(page);
    await save();
    await expect.poll(async () => (await posted()).length).toBe(2);
    const transfer = (await posted())[1];
    expect(transfer).toEqual({
        type: 'save-recipe',
        filePath: request.reference?.filePath,
        referenceChannel: request.reference?.channelIndex,
        responses: request.responses?.map(source => ({ filePath: source.filePath, channelIndex: source.channelIndex })),
    });
});

test('a fresh panel folds the cursor spectrum; a channel ◎ unfolds it to show the transfer function', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    // A fresh panel: no saved view state.
    await page.setContent(buildExtensionHostPathUiSmokeHtml().replace('<head>', '<head><script>window.__uiSmokeViewState = null;</script>'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#spectrum-overlay-wrap')).toBeHidden();
    await expect(page.locator('#spectrum-section-header [data-action="toggle-spectrum-panel"]')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('[data-action="set-pair-reference"]').first().click();
    await expect(page.locator('#spectrum-overlay-wrap')).toBeVisible();
    await expect(page.locator('#pair-spectrum-wrap')).toBeVisible();
});

test('the two figures keep one range across and one place read: after a zoom on one, a read, and a range typed on the other', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.setContent(buildExtensionHostPathUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    const buttons = page.locator('[data-action="set-pair-reference"]');
    await buttons.first().click();
    const laneCount = await buttons.count();
    await drawnFigure(page, PAIR_FIGURE, laneCount - 1);
    await drawnFigure(page, CURSOR_FIGURE);
    /** The range across each figure drew, once neither waits for a picture. */
    const across = async (): Promise<{ cursor: [number, number]; pair: Array<[number, number]> } | null> => {
        const [cursor, pair] = [await seenFigure(page, CURSOR_FIGURE), await seenFigure(page, PAIR_FIGURE)];
        if (cursor.waiting || pair.waiting || !cursor.lanes[0]?.range || pair.lanes.some(lane => !lane.range)) return null;
        return { cursor: cursor.lanes[0].range.x, pair: pair.lanes.map(lane => lane.range!.x) };
    };
    await expect.poll(across).not.toBeNull();
    const whole = (await across())!;
    expect(whole.pair, 'before any zoom the three lanes and the power spectrum are of one range').toEqual([whole.cursor, whole.cursor, whole.cursor]);

    // A drag on the power spectrum zooms into its box: the pair figure takes the same ends.
    const from = await pointOnLane(page, CURSOR_FIGURE, undefined, 0.3, 0.7);
    const to = await pointOnLane(page, CURSOR_FIGURE, undefined, 0.6, 0.3);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => { const now = await across(); return now !== null && now.cursor[0] > whole.cursor[0] && now.cursor[1] < whole.cursor[1]; }, { message: 'the drag zoomed the power spectrum' }).toBe(true);
    await expect.poll(async () => { const now = await across(); return now !== null && now.pair.every(range => range[0] === now.cursor[0] && range[1] === now.cursor[1]); }, { message: 'the pair figure follows the zoom' }).toBe(true);

    // A read on the pair figure after the zoom is marked on the power spectrum at the same frequency, inside the range.
    await hoverLane(page, PAIR_FIGURE, 'gain', 0.5);
    await expect.poll(async () => (await seenFigure(page, CURSOR_FIGURE)).followed !== null).toBe(true);
    const zoomed = (await across())!;
    const read = (await seenFigure(page, PAIR_FIGURE)).mark!;
    expect((await seenFigure(page, CURSOR_FIGURE)).followed!.x).toBe(read.x);
    expect(read.x).toBeGreaterThanOrEqual(zoomed.cursor[0]);
    expect(read.x).toBeLessThanOrEqual(zoomed.cursor[1]);

    // A range typed on the pair figure's axis is the power spectrum's range too.
    const box = (await page.locator(PAIR_FIGURE).boundingBox())!;
    const bottom = laneOf(await seenFigure(page, PAIR_FIGURE), 'coherence').frame;
    await page.mouse.dblclick(box.x + bottom.left + bottom.width / 2, box.y + bottom.top + bottom.height + 8);
    const popover = page.locator('[id$="range-popover"]:visible');
    await expect(popover).toHaveCount(1);
    await popover.locator('input[id$="-min"]').fill('200');
    await popover.locator('input[id$="-max"]').fill('2000');
    await popover.locator('button[id$="-apply"]').click();
    await expect.poll(across, { message: 'both figures drew the typed range' }).toEqual({ cursor: [200, 2000], pair: [[200, 2000], [200, 2000], [200, 2000]] });
});
