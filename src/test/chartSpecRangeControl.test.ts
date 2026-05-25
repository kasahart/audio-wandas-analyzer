import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getChartSpecRenderScript } from '../webview/chartSpecRenderScript';

// Fix 7: Shared canvas stub helper to avoid duplication across tests
function applyCanvasStub(doc: Document, fillTextSpy?: (text: string) => void) {
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
                    return () => undefined;
                },
                set() { return true; },
            });
            el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 240 });
        }
        return el;
    };
}

function setupChartEnv(specs: unknown[]) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
        <div id="range-popup" style="display:none">
            <input id="range-min" type="number">
            <input id="range-max" type="number">
            <button id="range-auto">Auto</button>
            <button id="range-apply">Apply</button>
            <button id="range-close">×</button>
            <div id="range-error"></div>
        </div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = specs;
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];

    applyCanvasStub(dom.window.document);

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
    dom.window.close();
});

test('Line チャートの Y 軸エリアをクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'line', title: 'T', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], series: [{ name: 's', ys: [0, 10] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    // Y 軸エリア (x=20, y=100) でクリックイベントを発火
    const ev = new dom.window.MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    });
    canvas.dispatchEvent(ev);

    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'ポップアップが表示されること');
    dom.window.close();
});

test('Bar チャートの Y 軸エリアをクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'bar', title: 'T', xLabel: 'X', yLabel: 'Y',
        categories: ['A', 'B'], series: [{ name: 's', values: [1, 2] }],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.notEqual(popup.style.display, 'none', 'ポップアップが表示されること');
    dom.window.close();
});

test('Heatmap のカラーバーエリアをクリックするとポップアップが開く', () => {
    const dom = setupChartEnv([{
        kind: 'heatmap', title: 'H', xLabel: 'X', yLabel: 'Y',
        xs: [0, 1], ys: [0, 1],
        matrix: [[0, 50], [50, 100]],
    }]);
    const canvas = dom.window.document.querySelector('canvas') as HTMLElement;
    assert.ok(canvas, 'canvas が存在すること');

    // カラーバー右端エリア (x=690 > plot.x + plot.w = 50 + 630 = 680)
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
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
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
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
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
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
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    // Apply でオーバーライドをセット
    (dom.window.document.getElementById('range-min') as HTMLInputElement).value = '1';
    (dom.window.document.getElementById('range-max') as HTMLInputElement).value = '9';
    (dom.window.document.getElementById('range-apply') as HTMLElement).click();

    // 再度開いて Auto
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: 20, clientY: 100,
    }));
    (dom.window.document.getElementById('range-auto') as HTMLElement).click();

    const popup = dom.window.document.getElementById('range-popup') as HTMLElement;
    assert.equal(popup.style.display, 'none', 'Auto 後にポップアップが閉じること');
    dom.window.close();
});

// Fix 6: Test verifying redraw actually receives override (fillText spy)
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
    canvas.dispatchEvent(new dom.window.MouseEvent('click', {
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
