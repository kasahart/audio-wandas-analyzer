import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getChartSpecRenderScript } from '../webview/chartSpecRenderScript';
import { normalizedColor, viridis } from '../shared/gui-core/index';
import { getStrings, rangePopoverStrings } from '../shared/i18n/strings';

// Shared canvas stub helper to avoid duplication across tests
function applyCanvasStub(
    doc: Document,
    fillTextSpy?: (text: string) => void,
    fillRectSpy?: (x: number, y: number, width: number, height: number) => void,
    imageSpy?: (image: { width: number; height: number; data: Uint8ClampedArray }) => void,
) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origCreate = (doc as any).createElement.bind(doc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).createElement = function(tag: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = origCreate(tag) as any;
        if (tag === 'canvas') {
            el.getContext = () => new Proxy({}, {
                get(_t: unknown, p: string | symbol) {
                    if (p === 'canvas') { return el; }
                    if (p === 'measureText') { return () => ({ width: 0 }); }
                    if (p === 'fillText') { return (text: string) => { if (fillTextSpy) { fillTextSpy(String(text)); } }; }
                    if (p === 'fillRect') { return (x: number, y: number, width: number, height: number) => { if (fillRectSpy) { fillRectSpy(x, y, width, height); } }; }
                    if (p === 'createImageData') { return (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }); }
                    if (p === 'putImageData') { return (image: { width: number; height: number; data: Uint8ClampedArray }) => { if (imageSpy) { imageSpy(image); } }; }
                    return () => undefined;
                },
                set() { return true; },
            });
            el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 240 });
        }
        return el;
    };
}

function setupChartEnv(specs: unknown[], fillTextSpy?: (text: string) => void) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = specs;
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];

    applyCanvasStub(dom.window.document, fillTextSpy);

    const script = dom.window.document.createElement('script');
    script.textContent = getChartSpecRenderScript();
    dom.window.document.body.appendChild(script);
    return dom;
}

test('Line チャートが描画される（rangeOverrides なし）', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'Test', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1, 2], series: [{ name: 's1', ys: [1, 2, 3] }],
    }]);
    const cards = dom.window.document.querySelectorAll('.chart-card');
    assert.equal(cards.length, 1, 'チャートカードが1件生成されること');
    dom.window.close();
});

test('range-popup div が DOM に存在する', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 1] }],
    }]);
    const popup = dom.window.document.getElementById('range-popup');
    assert.ok(popup, 'range-popup が存在すること');
    dom.window.close();
});

test('range-popup が HTML になくても buildRangePopup() が注入する', () => {
    // No #range-popup in the HTML template — injection path must run
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = [{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 1] }],
    }];
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];

    applyCanvasStub(dom.window.document);

    const script = dom.window.document.createElement('script');
    script.textContent = getChartSpecRenderScript();
    dom.window.document.body.appendChild(script);

    const popup = dom.window.document.getElementById('range-popup');
    assert.ok(popup, 'buildRangePopup() が #range-popup を body に注入すること');

    // Verify child IDs
    assert.ok(dom.window.document.getElementById('range-min'),   '#range-min が存在すること');
    assert.ok(dom.window.document.getElementById('range-max'),   '#range-max が存在すること');
    assert.ok(dom.window.document.getElementById('range-apply'), '#range-apply が存在すること');
    assert.ok(dom.window.document.getElementById('range-auto'),  '#range-auto が存在すること');
    assert.ok(dom.window.document.getElementById('range-close'), '#range-close が存在すること');
    assert.ok(dom.window.document.getElementById('range-error'), '#range-error が存在すること');
    assert.ok(dom.window.document.getElementById('popup-axis-badge'),        '#popup-axis-badge が存在すること');
    assert.ok(dom.window.document.getElementById('range-inputs'),            '#range-inputs が存在すること');
    dom.window.close();
});

test('Line チャートの Y 軸エリアをダブルクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    // Y 軸エリア (x=20, y=100) でダブルクリックイベントを発火
    const ev = new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    });
    canvas.dispatchEvent(ev);

    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'ポップアップが表示されること');
    dom.window.close();
});

test('Bar チャートの Y 軸エリアをダブルクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'bar', title: 'T', xLabel: 'X', yLabel: 'Y',
        categories: ['A', 'B'], series: [{ name: 's', values: [1, 2] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'ポップアップが表示されること');
    dom.window.close();
});

test('Heatmap のカラーバーエリアをダブルクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], ys: [0, 1],
        matrix: [[0, 50], [50, 100]],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    // カラーバー右端エリア (x=690 > plot.x + plot.w = 50 + 630 = 680)
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 690, clientY: 100,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'ポップアップが表示されること');
    dom.window.close();
});

test('Apply ボタンで範囲が適用される', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    // ポップアップを開く
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'ポップアップが開いていること');

    // 値を入力して Apply
    const minInput = dom.window.document.getElementById('range-min') as HTMLInputElement;
    const maxInput = dom.window.document.getElementById('range-max') as HTMLInputElement;
    minInput.value = '-5';
    maxInput.value = '20';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();

    assert.equal(popup.style.display, 'none', 'Apply 後にポップアップが閉じること');
    dom.window.close();
});

test('min >= max のとき Apply でエラーメッセージが表示される', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const minInput = dom.window.document.getElementById('range-min') as HTMLInputElement;
    const maxInput = dom.window.document.getElementById('range-max') as HTMLInputElement;
    minInput.value = '10';
    maxInput.value = '5';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();

    const errDiv = dom.window.document.getElementById('range-error') as HTMLElement;
    assert.ok(errDiv.textContent && errDiv.textContent.length > 0, 'エラーメッセージが表示されること');
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'エラー時はポップアップが開いたままであること');
    dom.window.close();
});

test('Auto ボタンでオーバーライドが解除される', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    // Apply でオーバーライドをセット
    (dom.window.document.getElementById('range-min') as HTMLInputElement).value = '1';
    (dom.window.document.getElementById('range-max') as HTMLInputElement).value = '9';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();

    // 再度開いて Auto
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    (dom.window.document.getElementById('range-auto') as HTMLElement).click();

    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.equal(popup.style.display, 'none', 'Auto 後にポップアップが閉じること');
    dom.window.close();
});

test('Apply で redraw に override が渡される（fillText で軸ラベルが変化）', () => {
    const filledTexts: string[] = [];
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = [{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }];
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];

    applyCanvasStub(dom.window.document, (text: string) => { filledTexts.push(text); });

    const script = dom.window.document.createElement('script');
    script.textContent = getChartSpecRenderScript();
    dom.window.document.body.appendChild(script);

    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));

    // Apply with min=-50, max=200
    filledTexts.length = 0;  // clear before apply
    (dom.window.document.getElementById('range-min') as HTMLInputElement).value = '-50';
    (dom.window.document.getElementById('range-max') as HTMLInputElement).value = '200';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();

    // drawAxisLabels calls fillText with y-axis tick labels including the min/max values
    const hasMinValue = filledTexts.some(t => t.includes('-50') || t.includes('-50.00'));
    const hasMaxValue = filledTexts.some(t => t.includes('200') || t.includes('200.00'));
    assert.ok(hasMinValue || hasMaxValue, `override の値 (-50, 200) が fillText で描画されること。実際: ${JSON.stringify(filledTexts.slice(0, 10))}`);
    dom.window.close();
});

test('Line チャートの Y 軸エリアへのシングルクリックではポップアップが開かない', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.equal(popup.style.display, 'none', 'シングルクリックではポップアップが開かないこと');
    dom.window.close();
});

test('Line チャートの X 軸エリアをダブルクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    // X 軸ゾーン: cy > plot.y + plot.h = 206, cx ∈ [50, 710]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'X 軸ポップアップが表示されること');
    dom.window.close();
});

test('Line チャートの X 軸ポップアップには X 軸バッジが表示される', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));
    const badge = dom.window.document.getElementById('popup-axis-badge') as HTMLElement;
    assert.ok(badge, '#popup-axis-badge が存在すること');
    assert.ok(
        badge.textContent && badge.textContent.includes('X'),
        `X 軸バッジのテキストが "X" を含むこと。実際: ${badge.textContent}`,
    );
    dom.window.close();
});

test('Line チャートの Y 軸ポップアップには Y 軸バッジが表示される', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const badge = dom.window.document.getElementById('popup-axis-badge') as HTMLElement;
    assert.ok(badge, '#popup-axis-badge が存在すること');
    assert.ok(
        badge.textContent && badge.textContent.includes('Y'),
        `Y 軸バッジのテキストが "Y" を含むこと。実際: ${badge.textContent}`,
    );
    dom.window.close();
});

test('Line チャートのプロット内部ダブルクリックで Y レンジがリセットされる', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    const doc = dom.window.document;

    // Y 軸レンジをセット
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    (doc.getElementById('range-max') as HTMLInputElement).value = '100';
    (doc.getElementById('range-min') as HTMLInputElement).value = '10';
    (doc.getElementById('range-apply') as HTMLElement).click();

    // プロット内部 dblclick でリセット: cx=300 ∈ [50,710], cy=100 ∈ [16,206]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 100,
    }));

    // 再度 Y 軸 dblclick でポップアップを開いて入力が空であることを確認
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const maxInput = doc.getElementById('range-max') as HTMLInputElement;
    assert.equal(maxInput.value, '', 'リセット後 range-max が空であること');
    dom.window.close();
});

test('Heatmap のプロット内部ダブルクリックでカラーレンジがリセットされる', () => {
    const dom = setupChartEnv([{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], ys: [0, 1],
        matrix: [[0, 50], [50, 100]],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    const doc = dom.window.document;

    // カラーバー dblclick でレンジをセット: cx=690 > 680
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 690, clientY: 100,
    }));
    (doc.getElementById('range-max') as HTMLInputElement).value = '-10';
    (doc.getElementById('range-min') as HTMLInputElement).value = '-60';
    (doc.getElementById('range-apply') as HTMLElement).click();

    // プロット内部 dblclick でリセット: cx=300 ∈ [50,680], cy=100 ∈ [16,206]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 100,
    }));

    // カラーバー dblclick で再度確認
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 690, clientY: 100,
    }));
    const maxInput = doc.getElementById('range-max') as HTMLInputElement;
    assert.equal(maxInput.value, '', 'リセット後 range-max が空であること');
    dom.window.close();
});

test('Bar チャートのプロット内部ダブルクリックで Y レンジがリセットされる', () => {
    const dom = setupChartEnv([{
        kind: 'bar', title: 'T', xLabel: 'X', yLabel: 'Y',
        categories: ['A', 'B'], series: [{ name: 's', values: [1, 2] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    const doc = dom.window.document;

    // Y 軸 dblclick でレンジをセット
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    (doc.getElementById('range-max') as HTMLInputElement).value = '50';
    (doc.getElementById('range-min') as HTMLInputElement).value = '0';
    (doc.getElementById('range-apply') as HTMLElement).click();

    // プロット内部 dblclick: cx=300 ∈ [50,710], cy=100 ∈ [16,206]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 100,
    }));

    // 再度 Y 軸 dblclick で確認
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const maxInput = doc.getElementById('range-max') as HTMLInputElement;
    assert.equal(maxInput.value, '', 'リセット後 range-max が空であること');
    dom.window.close();
});

test('Line チャートの Y 軸エリアを canvas が拡大表示時もダブルクリックで正しく判定できる', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    // canvas が 1440px 幅に拡大表示されているとシミュレート (論理 720px の 2 倍)
    // scaleX = 720 / 1440 = 0.5
    (canvas as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1440, height: 480, right: 1440, bottom: 480, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    // CSS座標 x=60 → 論理座標 x=30 (scaleX=0.5) → plot.x=50 より左 → Y軸ゾーン
    // スケールなし (バグあり): raw cx=60 > plot.x=50 → Y軸外 → ポップアップが開かない (バグ)
    // toCanvasCoords あり: scaled cx=30 < plot.x=50 → Y軸ゾーン → ポップアップが開く (正常)
    const ev = new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 60, clientY: 100,
    });
    canvas.dispatchEvent(ev);

    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', '拡大表示でも Y 軸 dblclick でポップアップが開くこと (toCanvasCoords で正規化済み)');
    dom.window.close();
});

test('Line チャートの X 軸 Apply→override→プロット内部リセットの一連の動作', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    const doc = dom.window.document;

    // X 軸エリア dblclick でポップアップを開く: cy=220 > 206, cx=300 ∈ [50,710]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));
    const minX = doc.getElementById('range-min') as HTMLInputElement;
    const maxX = doc.getElementById('range-max') as HTMLInputElement;
    assert.ok(minX, '#range-min が存在すること');
    assert.ok(maxX, '#range-max が存在すること');

    // X レンジを 0 〜 5 に設定して Apply
    minX.value = '0';
    maxX.value = '5';
    (doc.getElementById('range-apply') as HTMLElement).click();

    // 再度 X 軸 dblclick でポップアップを開いて入力値が反映されていることを確認
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));
    assert.equal((doc.getElementById('range-min') as HTMLInputElement).value, '0', 'X 軸の Min が 0 であること');
    assert.equal((doc.getElementById('range-max') as HTMLInputElement).value, '5', 'X 軸の Max が 5 であること');

    // プロット内部 dblclick でリセット: cx=300 ∈ [50,710], cy=100 ∈ [16,206]
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 100,
    }));

    // X 軸 dblclick で再度確認 → 入力が空であること
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));
    assert.equal((doc.getElementById('range-max') as HTMLInputElement).value, '', 'リセット後 X 軸の Max が空であること');
    assert.equal((doc.getElementById('range-min') as HTMLInputElement).value, '', 'リセット後 X 軸の Min が空であること');
    dom.window.close();
});

test('Heatmap の Y 軸エリアをダブルクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], ys: [0, 1],
        matrix: [[0, 50], [50, 100]],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    // Y 軸エリア (cx=20 < plot.x=50)
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'Y 軸 dblclick でポップアップが表示されること');
    dom.window.close();
});

test('Heatmap の X 軸エリアをダブルクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], ys: [0, 1],
        matrix: [[0, 50], [50, 100]],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    // X 軸エリア (cy=220 > plot.y+plot.h=206, cx=300 ∈ [50,680])
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'X 軸 dblclick でポップアップが表示されること');
    dom.window.close();
});

test('Heatmap の Y レンジを Apply すると軸ラベルが変化する', () => {
    const filledTexts: string[] = [];
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = [{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], ys: [0, 100],
        matrix: [[0, 50], [50, 100]],
    }];
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];

    applyCanvasStub(dom.window.document, (text: string) => { filledTexts.push(text); });

    const script = dom.window.document.createElement('script');
    script.textContent = getChartSpecRenderScript();
    dom.window.document.body.appendChild(script);

    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));

    filledTexts.length = 0;
    (dom.window.document.getElementById('range-min') as HTMLInputElement).value = '10';
    (dom.window.document.getElementById('range-max') as HTMLInputElement).value = '80';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();

    const has10 = filledTexts.some(t => t.includes('10'));
    const has80 = filledTexts.some(t => t.includes('80'));
    assert.ok(has10 || has80, `Y レンジ (10, 80) が軸ラベルに反映されること。実際: ${JSON.stringify(filledTexts.slice(0, 10))}`);
    dom.window.close();
});

test('Heatmap の X レンジを Apply すると軸ラベルが変化する', () => {
    const filledTexts: string[] = [];
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = [{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 100], ys: [0, 1],
        matrix: [[0, 50], [50, 100]],
    }];
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];

    applyCanvasStub(dom.window.document, (text: string) => { filledTexts.push(text); });

    const script = dom.window.document.createElement('script');
    script.textContent = getChartSpecRenderScript();
    dom.window.document.body.appendChild(script);

    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    // X 軸エリア dblclick
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: 300, clientY: 220,
    }));

    filledTexts.length = 0;
    (dom.window.document.getElementById('range-min') as HTMLInputElement).value = '20';
    (dom.window.document.getElementById('range-max') as HTMLInputElement).value = '60';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();

    const has20 = filledTexts.some(t => t.includes('20'));
    const has60 = filledTexts.some(t => t.includes('60'));
    assert.ok(has20 || has60, `X レンジ (20, 60) が軸ラベルに反映されること。実際: ${JSON.stringify(filledTexts.slice(0, 10))}`);
    dom.window.close();
});


function heatmapZoomRaster(axis: 'x' | 'y'): { width: number; height: number; data: Uint8ClampedArray } {
    const images: Array<{ width: number; height: number; data: Uint8ClampedArray }> = [];
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = [{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 100], ys: [0, 100],
        matrix: [
            [0, 1, 2, 3],
            [4, 5, 6, 7],
            [8, 9, 10, 11],
            [12, 13, 14, 15],
        ],
    }];
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];
    applyCanvasStub(dom.window.document, undefined, undefined, image => { images.push(image); });
    const script = dom.window.document.createElement('script');
    script.textContent = getChartSpecRenderScript();
    dom.window.document.body.appendChild(script);

    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', {
        bubbles: true, cancelable: true, clientX: axis === 'x' ? 300 : 20, clientY: axis === 'x' ? 220 : 100,
    }));
    (dom.window.document.getElementById('range-min') as HTMLInputElement).value = '25';
    (dom.window.document.getElementById('range-max') as HTMLInputElement).value = '75';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();
    dom.window.close();
    return images.at(-1)!;
}

function pixel(image: { width: number; data: Uint8ClampedArray }, x: number, y: number): number[] {
    const offset = (y * image.width + x) * 4;
    return Array.from(image.data.slice(offset, offset + 3));
}

const valueColor = (value: number): number[] => normalizedColor(value / 15, viridis);

test('Heatmap の X レンジを Apply すると表示範囲内の列だけが共有ラスタで拡大描画される', () => {
    const image = heatmapZoomRaster('x');
    const bottom = image.height - 1;
    // Visible 25–75 covers columns 1 and 2: each fills half the plot width; the bottom row is matrix row 0.
    assert.deepEqual(pixel(image, 0, bottom), valueColor(1));
    assert.deepEqual(pixel(image, image.width - 1, bottom), valueColor(2));
    assert.deepEqual(pixel(image, 0, 0), valueColor(13));
});

test('Heatmap の Y レンジを Apply すると表示範囲内の行だけが共有ラスタで拡大描画される', () => {
    const image = heatmapZoomRaster('y');
    // Visible 25–75 covers rows 1 (bottom half) and 2 (top half).
    assert.deepEqual(pixel(image, 0, image.height - 1), valueColor(4));
    assert.deepEqual(pixel(image, 0, 0), valueColor(8));
    assert.deepEqual(pixel(image, image.width - 1, 0), valueColor(11));
});


test('line legends visibly distinguish calibrated references and preserve unqualified names', () => {
    const labels: string[] = [];
    const dom = setupChartEnv([{
        kind: 'line', title: 'Levels', xLabel: 'Frequency [Hz]', yLabel: 'Level [dB]',
        xs: [100, 200], series: [
            { name: 'pressure', unit: 'dB SPL', ys: [60, 61] },
            { name: 'digital', unit: 'dBFS', ys: [-20, -19] },
            { name: 'unqualified', ys: [1, 2] },
        ],
    }], text => labels.push(text));
    assert.ok(labels.includes('pressure [dB SPL]'));
    assert.ok(labels.includes('digital [dBFS]'));
    assert.ok(labels.includes('unqualified'));
    dom.window.close();
});


test('bar legends visibly distinguish calibrated octave references', () => {
    const labels: string[] = [];
    const dom = setupChartEnv([{
        kind: 'bar', title: 'Octave levels', categories: ['125', '250'], yLabel: 'Level [dB]',
        series: [
            { name: 'pressure', unit: 'dB SPL', values: [60, 61] },
            { name: 'digital', unit: 'dBFS', values: [-20, -19] },
        ],
    }], text => labels.push(text));
    assert.ok(labels.includes('pressure [dB SPL]'));
    assert.ok(labels.includes('digital [dBFS]'));
    dom.window.close();
});


test('heatmap color scales visibly display their calibrated reference', () => {
    for (const unit of ['dB SPL re 20 µPa', 'dBFS']) {
        const labels: string[] = [];
        const dom = setupChartEnv([{
            kind: 'heatmap', title: 'STFT', unit, xs: [0, 1], ys: [100, 200], matrix: [[60, 61], [50, 51]],
        }], text => labels.push(text));
        assert.ok(labels.includes(unit));
        dom.window.close();
    }
});

test('recipe range popover is localized through the shared dictionary', () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="charts"></div></body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = [{ kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y', xs: [0, 1], series: [{ name: 's', ys: [0, 1] }] }];
    win.__CHART_RANGE_STRINGS__ = rangePopoverStrings(getStrings('ja'));
    applyCanvasStub(dom.window.document);
    const script = dom.window.document.createElement('script');
    script.textContent = getChartSpecRenderScript();
    dom.window.document.body.appendChild(script);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    canvas.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 300, clientY: 220 }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.match(popup.textContent ?? '', /^レンジ/);
    assert.equal(dom.window.document.getElementById('popup-axis-badge')!.textContent, 'X 軸');
    assert.equal(dom.window.document.getElementById('range-apply')!.textContent, '適用');
    (dom.window.document.getElementById('range-min') as HTMLInputElement).value = '5';
    (dom.window.document.getElementById('range-max') as HTMLInputElement).value = '1';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();
    assert.equal(dom.window.document.getElementById('range-error')!.textContent, 'Min は Max より小さい値を入力してください');
    dom.window.close();
});
