import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeCalibrationHtml } from './buildHtml';

type PostedMessage = Record<string, unknown>;

async function loadCalibrationUi(page: Page): Promise<void> {
    await page.setContent(buildUiSmokeCalibrationHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-action="configure-calibration"]')).toHaveCount(2);
}

async function postedMessages(page: Page): Promise<PostedMessage[]> {
    return page.evaluate(() => {
        return (window as unknown as { __uiSmokePostedMessages: PostedMessage[] }).__uiSmokePostedMessages;
    });
}

test('calibrated channels show physical metrics and reference badges', async ({ page }) => {
    await loadCalibrationUi(page);

    const badges = page.locator('.calibration-badge');
    await expect(badges).toHaveCount(2);
    await expect(badges.nth(0)).toHaveText('CAL: Pa');
    await expect(badges.nth(1)).toHaveText('CAL: m/s^2');

    await expect(page.locator('#track-row-0 .track-meta')).toContainText('RMS 0.063 Pa / 70.0 dB SPL');
    await expect(page.locator('#track-row-0 .track-meta')).toContainText('Peak 5.00 Pa / 80.0 dB SPL');

    await expect(page.locator('#track-row-0 .clip-badge')).toHaveCount(0);
    await expect(page.locator('#track-row-1 .clip-badge')).toHaveCount(0);
});

test('incompatible level references disable only the shared spectrum overlay', async ({ page }) => {
    await loadCalibrationUi(page);

    const warning = page.locator('.calibration-overlay-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('incompatible level references');
    await expect(page.locator('#spectrum-overlay-canvas')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('.track-spectrum-canvas')).toHaveCount(2);
});

test('calibration controls post exact configuration and reanalysis messages', async ({ page }) => {
    await loadCalibrationUi(page);

    await page.evaluate(() => {
        const auto = document.querySelector<HTMLInputElement>('#spec-auto');
        const nFft = document.querySelector<HTMLSelectElement>('#spec-nfft');
        const hop = document.querySelector<HTMLInputElement>('#spec-hop');
        const windowType = document.querySelector<HTMLSelectElement>('#spec-window');
        const apply = document.querySelector<HTMLButtonElement>('#spec-apply');
        if (!auto || !nFft || !hop || !windowType || !apply) {
            throw new Error('Spectrogram settings controls were not found');
        }
        auto.checked = false;
        nFft.value = '512';
        hop.value = '128';
        windowType.value = 'hamming';
        apply.click();
    });

    await page.locator('#track-row-0 [data-action="configure-calibration"]').click();
    await expect.poll(async () => {
        const messages = await postedMessages(page);
        return messages.find((message) => message['type'] === 'configure-calibration');
    }).toMatchObject({
        type: 'configure-calibration',
        trackIndex: 0,
        filePath: '/preview/demo-tone.wav',
        channels: [{ channelIndex: 0, label: 'L' }],
    });

    await page.evaluate(() => {
        (window as unknown as { __uiSmokePostedMessages: PostedMessage[] }).__uiSmokePostedMessages = [];
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'calibration-configured' },
        }));
    });
    await expect.poll(async () => {
        const messages = await postedMessages(page);
        return messages.find((message) => message['type'] === 'request-reanalyze');
    }).toMatchObject({
        type: 'request-reanalyze',
        settings: {
            auto: false,
            stft: { nFft: 512, hopSize: 128, window: 'hamming' },
        },
    });
});

test('report export records calibration and generates a reproducible notebook', async ({ page }) => {
    await loadCalibrationUi(page);

    await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('[data-action="export-report"]');
        if (!button) { throw new Error('Report export button was not found'); }
        button.click();
    });
    await expect.poll(async () => {
        const messages = await postedMessages(page);
        return messages.find((message) => message['type'] === 'export-report-options');
    }).toBeTruthy();

    const exported = (await postedMessages(page)).find((message) => message['type'] === 'export-report-options');
    expect(exported).toBeDefined();
    const markdown = String(exported?.['markdownContent']);
    expect(markdown).toContain('| File | Channel | Sample Rate | Duration | Channels | RMS | Peak |');
    expect(markdown).toContain('| demo-tone.wav | Channel 1 (L) | 8000 Hz | 2.000s | 1 |');
    expect(markdown).toContain('## Calibration');
    expect(markdown).toContain('dB SPL re 20 µPa');
    expect(markdown).toContain('0.500 FS');
    expect(String(exported?.['notebookContent'])).toContain('.with_calibration([');
    expect(String(exported?.['notebookContent'])).toContain('wd.ChannelCalibration(factor=2');
});

test('calibration update preserves runtime state without requesting a Webview reload', async ({ page }) => {
    await loadCalibrationUi(page);

    const offset = page.locator('#track-row-0 .track-offset-val');
    await offset.click();
    const input = page.locator('#track-row-0 .track-offset-input');
    await input.fill('2000');
    await input.press('Enter');
    await expect(offset).toContainText('2.000');

    await page.evaluate(() => {
        const appWindow = window as unknown as {
            __APP_STATE__: { results: unknown[] };
            __uiSmokePostedMessages: PostedMessage[];
        };
        appWindow.__uiSmokePostedMessages = [];
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'calibration-configured' },
        }));
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'analysis-update', results: appWindow.__APP_STATE__.results },
        }));
    });

    await expect(offset).toContainText('2.000');
    const messages = await postedMessages(page);
    expect(messages.some((message) => message['type'] === 'calibration-reload')).toBe(false);
});

test('calibration report includes active tracks only', async ({ page }) => {
    await loadCalibrationUi(page);

    await page.locator('#track-row-1 [data-action="remove-track"]').click();
    await expect(page.locator('#track-row-1')).toHaveCount(0);
    await page.evaluate(() => {
        const button = document.querySelector<HTMLElement>('[data-action="export-report"]');
        if (!button) { throw new Error('Report export button was not found'); }
        button.click();
    });

    await expect.poll(async () => {
        return (await postedMessages(page)).find((message) => message['type'] === 'export-report-options');
    }).toBeTruthy();
    const exported = (await postedMessages(page)).find((message) => message['type'] === 'export-report-options');
    expect(String(exported?.['markdownContent'])).toContain('demo-tone.wav');
    expect(String(exported?.['markdownContent'])).not.toContain('acceleration.wav');
    expect(String(exported?.['notebookContent'])).not.toContain('acceleration.wav');
});
