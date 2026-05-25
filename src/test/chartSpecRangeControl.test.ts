import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getChartSpecRenderScript } from '../webview/chartSpecRenderScript';

function setupChartEnv(specs: unknown[]) {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="charts"></div>
        <div id="range-popup" style="display:none">
            <input id="range-min" type="number">
            <input id="range-max" type="number">
            <button id="range-auto">Auto</button>
            <button id="range-apply">Apply</button>
            <button id="range-close">×</button>
        </div>
    </body></html>`, { runScripts: 'dangerously' });
    const win = dom.window as unknown as Record<string, unknown>;
    win.__CHART_SPECS__ = specs;
    win.__CHART_NO_RESULTS_LABEL__ = 'No results';
    win.__CHART_SCALAR_HEADERS__ = ['Label', 'Value', 'Unit'];

    // canvas stub
    const origCreateElement = dom.window.document.createElement.bind(dom.window.document);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dom.window.document as any).createElement = function(tag: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = origCreateElement(tag) as any;
        if (tag === 'canvas') {
            el.getContext = () => {
                return new Proxy({}, {
                    get(_t: unknown, p: string | symbol) {
                        if (p === 'canvas') { return el; }
                        if (p === 'measureText') { return () => ({ width: 0 }); }
                        return () => undefined;
                    },
                    set() { return true; },
                });
            };
            el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 240 });
        }
        return el;
    };

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

    // Same canvas stub as setupChartEnv
    const origCreateElement2 = dom.window.document.createElement.bind(dom.window.document);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dom.window.document as any).createElement = function(tag: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const el = origCreateElement2(tag) as any;
        if (tag === 'canvas') {
            el.getContext = () => new Proxy({}, {
                get(_t: unknown, p: string | symbol) {
                    if (p === 'canvas') { return el; }
                    if (p === 'measureText') { return () => ({ width: 0 }); }
                    return () => undefined;
                },
                set() { return true; },
            });
            el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 720, height: 240 });
        }
        return el;
    };

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
