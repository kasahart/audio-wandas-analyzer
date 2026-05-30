import { expect, test, type Page } from '@playwright/test';
import { buildUiSmokeHtml } from './buildHtml';

/**
 * パワースペクトル overlay の dblclick 操作（軸→レンジ popover / 内部→ズームリセット）の
 * 実ブラウザ smoke。
 *
 * 【既知の環境制約 — fixme】
 * この環境では `page.setContent(buildUiSmokeHtml())`（~250KB の自己完結 HTML）が
 * Chromium で安定して domcontentloaded を発火できず固まり、後続の mouse.dblclick が
 * タイムアウトする（PR #104 検証時にも観測。ComparisonPanel の大きな inline
 * スクリプト + 同期描画が原因と推測）。
 *
 * 同じ振る舞い（dblclick → ゾーン判定 → popover 表示 / specZoomReset、Apply による
 * specDbMin/Max・specFreqStart/End への反映）は jsdom 統合テスト
 * （src/test/renderScript.integration.test.ts の "spectrum overlay:" 4 ケース）で
 * 実イベント・実ハンドラ・実 state により検証済み。実 Chromium で setContent が
 * 安定して動く環境では下記 fixme を外して有効化できる。
 */

async function loadResultsUi(page: Page) {
    await page.setContent(buildUiSmokeHtml(), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#toolbar')).toBeVisible();
    // overlay がレンダリングされ canvas にサイズが付くのを待つ
    await page.waitForFunction(() => {
        const c = document.getElementById('spectrum-overlay-canvas') as HTMLCanvasElement | null;
        return !!c && c.width > 100;
    }, { timeout: 5000 });
}

test.fixme('spectrum overlay: Y軸 dblclick で範囲 popover が表示される', async ({ page }) => {
    await loadResultsUi(page);
    const overlay = page.locator('#spectrum-overlay-canvas');
    const box = await overlay.boundingBox();
    expect(box).not.toBeNull();
    const { W, H } = await overlay.evaluate((c) => ({
        W: (c as HTMLCanvasElement).width, H: (c as HTMLCanvasElement).height,
    }));
    const sX = box!.width / W, sY = box!.height / H;
    // Y軸ゾーン: canvas x=10 (<padL36)
    await page.mouse.dblclick(box!.x + 10 * sX, box!.y + (H / 2) * sY);
    const pop = page.locator('#spectrum-range-popover');
    await expect(pop).toBeVisible();
    await expect(page.locator('#spec-range-axis-badge')).toContainText('dB');
});

test.fixme('spectrum overlay: X軸 dblclick で周波数 popover が表示される', async ({ page }) => {
    await loadResultsUi(page);
    const overlay = page.locator('#spectrum-overlay-canvas');
    const box = await overlay.boundingBox();
    const { W, H } = await overlay.evaluate((c) => ({
        W: (c as HTMLCanvasElement).width, H: (c as HTMLCanvasElement).height,
    }));
    const sX = box!.width / W, sY = box!.height / H;
    // X軸ゾーン: canvas y = H-5 (>H-padB18), x = 中央
    await page.mouse.dblclick(box!.x + (W / 2) * sX, box!.y + (H - 5) * sY);
    await expect(page.locator('#spectrum-range-popover')).toBeVisible();
    await expect(page.locator('#spec-range-axis-badge')).toContainText('Hz');
});

test.fixme('spectrum overlay: 内部 dblclick で popover を開かずズームリセット相当', async ({ page }) => {
    await loadResultsUi(page);
    const overlay = page.locator('#spectrum-overlay-canvas');
    const box = await overlay.boundingBox();
    const { W, H } = await overlay.evaluate((c) => ({
        W: (c as HTMLCanvasElement).width, H: (c as HTMLCanvasElement).height,
    }));
    const sX = box!.width / W, sY = box!.height / H;
    // 内部中央 dblclick → popover は出ない（reset 動作）
    await page.mouse.dblclick(box!.x + (W / 2) * sX, box!.y + (H / 2) * sY);
    await expect(page.locator('#spectrum-range-popover')).toBeHidden();
});
