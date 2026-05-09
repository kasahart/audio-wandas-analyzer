import { JSDOM } from 'jsdom';

export interface DrawImageCall {
    src: unknown;
}

export interface CanvasSpyCtx {
    clearRectCalls: number;
    drawImageCalls: DrawImageCall[];
    beginPathCalls: number;
    strokeCalls: number;
}

export interface SpyOffscreenCanvas {
    width: number;
    height: number;
    ctx: CanvasSpyCtx;
}

export interface WebviewEnv {
    dom: JSDOM;
    postedMessages: unknown[];
    /** インデックス順に作られた OffscreenCanvas スパイ */
    offscreenInstances: SpyOffscreenCanvas[];
}

/**
 * ComparisonPanel / AnalysisPanel の renderScript() を実行するための
 * 軽量 jsdom 環境を構築する。
 *
 * - acquireVsCodeApi() をスタブ化（postMessage はキャプチャ）
 * - OffscreenCanvas をスパイ付きスタブで差し替え
 * - HTMLCanvasElement.getContext() を最小スタブで差し替え
 * - jsdom は CSS レイアウトを実装しないため clientWidth は 0 になる点に注意。
 *   テスト内で `Object.defineProperty(wrap, 'clientWidth', { value: 800 })` 等で設定できる。
 */
export function createWebviewEnv(appStateJson: string): WebviewEnv {
    const postedMessages: unknown[] = [];
    const offscreenInstances: SpyOffscreenCanvas[] = [];

    const dom = new JSDOM(
        `<!DOCTYPE html><body><div id="app"></div></body>`,
        { pretendToBeVisual: true, runScripts: 'dangerously' },
    );
    const win = dom.window as any;

    // VS Code API スタブ
    win.acquireVsCodeApi = () => ({
        postMessage: (msg: unknown) => { postedMessages.push(msg); },
        getState: () => null,
        setState: () => {},
    });

    // OffscreenCanvas スパイ
    win.OffscreenCanvas = class {
        width: number;
        height: number;
        ctx: CanvasSpyCtx;

        constructor(w: number, h: number) {
            this.width = w;
            this.height = h;
            this.ctx = { clearRectCalls: 0, drawImageCalls: [], beginPathCalls: 0, strokeCalls: 0 };
            offscreenInstances.push({ width: w, height: h, ctx: this.ctx });
        }

        getContext(_type: string) {
            const ctx = this.ctx;
            return {
                clearRect() { ctx.clearRectCalls++; },
                beginPath() { ctx.beginPathCalls++; },
                moveTo() {},
                lineTo() {},
                stroke() { ctx.strokeCalls++; },
                drawImage(src: unknown) { ctx.drawImageCalls.push({ src }); },
                get lineWidth() { return 1; },
                set lineWidth(_v: number) {},
                get strokeStyle() { return ''; },
                set strokeStyle(_v: string) {},
            };
        }
    };

    // HTMLCanvasElement.getContext スタブ（DOM canvas 用）
    const origCreateElement = dom.window.document.createElement.bind(dom.window.document);
    dom.window.document.createElement = function(tag: string, ...args: any[]) {
        const el = origCreateElement(tag, ...args);
        if (tag.toLowerCase() === 'canvas') {
            (el as any).getContext = (_type: string) => ({
                clearRect() {},
                beginPath() {},
                moveTo() {},
                lineTo() {},
                stroke() {},
                drawImage() {},
                fillText() {},
                get lineWidth() { return 1; },
                set lineWidth(_v: number) {},
                get strokeStyle() { return ''; },
                set strokeStyle(_v: string) {},
                get fillStyle() { return ''; },
                set fillStyle(_v: string) {},
                get font() { return ''; },
                set font(_v: string) {},
                get textAlign() { return 'left'; },
                set textAlign(_v: string) {},
                setLineDash() {},
                save() {},
                restore() {},
                get globalAlpha() { return 1; },
                set globalAlpha(_v: number) {},
            });
        }
        return el;
    } as any;

    win.__APP_STATE__ = JSON.parse(appStateJson);

    return { dom, postedMessages, offscreenInstances };
}

/**
 * renderScript() の文字列を jsdom の window.eval() で実行する。
 * runScripts: 'dangerously' が必要。
 */
export function evalScript(dom: JSDOM, scriptContent: string): void {
    (dom.window as any).eval(scriptContent);
}
