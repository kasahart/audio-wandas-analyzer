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

export interface DomCanvasSpyCtx extends CanvasSpyCtx {
    saveCalls: number;
    restoreCalls: number;
    fillTextCalls: string[];
    fillRectCalls: number;
    putImageDataCalls: number;
}

export interface WebviewEnv {
    dom: JSDOM;
    postedMessages: unknown[];
    /** インデックス順に作られた OffscreenCanvas スパイ */
    offscreenInstances: SpyOffscreenCanvas[];
    domCanvasContexts: Map<string, DomCanvasSpyCtx>;
}

const noop = (): undefined => undefined;

// 既定値: ctx.lineWidth 等を set 前に読まれたときの返却値。
// 旧実装の getter 返却値を踏襲（変更すると既存テストが壊れる可能性がある）。
const CANVAS_PROPERTY_DEFAULTS: Record<string, unknown> = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
};

/**
 * 未知のメソッド呼び出しに対しては no-op を返す Canvas2D 互換 Proxy。
 *
 * 新しい描画 API が呼び出されても TypeError にならないため、
 * 描画コード側の追加で無関係なテストが連鎖失敗することを防ぐ。
 *
 * 計測したい呼び出しは `counters` テーブルに、戻り値が必要なメソッドは
 * `valueReturning` テーブルに明示的に列挙する。
 */
function createDomCanvasContextProxy(spy: DomCanvasSpyCtx): CanvasRenderingContext2D {
    const stored: Record<string, unknown> = { ...CANVAS_PROPERTY_DEFAULTS };

    const counters: Record<string, (...args: unknown[]) => void> = {
        clearRect: () => { spy.clearRectCalls++; },
        beginPath: () => { spy.beginPathCalls++; },
        stroke: () => { spy.strokeCalls++; },
        drawImage: (src) => { spy.drawImageCalls.push({ src }); },
        fillText: (text) => { spy.fillTextCalls.push(String(text)); },
        fillRect: () => { spy.fillRectCalls++; },
        putImageData: () => { spy.putImageDataCalls++; },
        save: () => { spy.saveCalls++; },
        restore: () => { spy.restoreCalls++; },
    };

    const valueReturning: Record<string, (...args: unknown[]) => unknown> = {
        createImageData: (w, h) => {
            const width = (w as number) | 0;
            const height = (h as number) | 0;
            return {
                width,
                height,
                data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
            };
        },
        getImageData: (_x, _y, w, h) => {
            const width = (w as number) | 0;
            const height = (h as number) | 0;
            return {
                width,
                height,
                data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
            };
        },
        measureText: () => ({ width: 0 }),
    };

    return new Proxy({}, {
        get(_target, prop) {
            if (typeof prop !== 'string') { return undefined; }
            if (prop in counters) { return counters[prop]; }
            if (prop in valueReturning) { return valueReturning[prop]; }
            if (prop in stored) { return stored[prop]; }
            return noop;
        },
        set(_target, prop, value) {
            if (typeof prop === 'string') { stored[prop] = value; }
            return true;
        },
    }) as unknown as CanvasRenderingContext2D;
}

function createOffscreenContextProxy(spy: CanvasSpyCtx): unknown {
    const stored: Record<string, unknown> = { ...CANVAS_PROPERTY_DEFAULTS };
    const counters: Record<string, (...args: unknown[]) => void> = {
        clearRect: () => { spy.clearRectCalls++; },
        beginPath: () => { spy.beginPathCalls++; },
        stroke: () => { spy.strokeCalls++; },
        drawImage: (src) => { spy.drawImageCalls.push({ src }); },
    };
    return new Proxy({}, {
        get(_target, prop) {
            if (typeof prop !== 'string') { return undefined; }
            if (prop in counters) { return counters[prop]; }
            if (prop in stored) { return stored[prop]; }
            return noop;
        },
        set(_target, prop, value) {
            if (typeof prop === 'string') { stored[prop] = value; }
            return true;
        },
    });
}

/**
 * ComparisonPanel の renderScript() を実行するための
 * 軽量 jsdom 環境を構築する。
 *
 * - acquireVsCodeApi() をスタブ化（postMessage はキャプチャ）
 * - OffscreenCanvas を Proxy ベースのスパイで差し替え
 * - HTMLCanvasElement.getContext() を Proxy ベースのスパイで差し替え
 *   未知の API は no-op、計測対象だけ明示的に counters に列挙する
 * - jsdom は CSS レイアウト（clientWidth）を実装しないため、
 *   テスト内で `Object.defineProperty(wrap, 'clientWidth', { value: 800 })` 等で設定できる。
 */
export function createWebviewEnv(appStateJson: string): WebviewEnv {
    const postedMessages: unknown[] = [];
    const offscreenInstances: SpyOffscreenCanvas[] = [];
    const domCanvasContexts = new Map<string, DomCanvasSpyCtx>();

    const dom = new JSDOM(
        `<!DOCTYPE html><body><div id="app"></div></body>`,
        { pretendToBeVisual: true, runScripts: 'dangerously' },
    );
    const win = dom.window as any;

    // VS Code API スタブ
    win.acquireVsCodeApi = () => ({
        postMessage: (msg: unknown) => { postedMessages.push(msg); },
        getState: () => null,
        setState: () => { },
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
            return createOffscreenContextProxy(this.ctx);
        }
    };

    // HTMLCanvasElement.getContext スタブ（DOM canvas 用）
    win.HTMLCanvasElement.prototype.getContext = function (_type: string) {
        const id = this.id || '__anonymous__';
        let spy = domCanvasContexts.get(id);
        if (!spy) {
            spy = {
                clearRectCalls: 0,
                drawImageCalls: [],
                beginPathCalls: 0,
                strokeCalls: 0,
                saveCalls: 0,
                restoreCalls: 0,
                fillTextCalls: [],
                fillRectCalls: 0,
                putImageDataCalls: 0,
            };
            domCanvasContexts.set(id, spy);
        }
        return createDomCanvasContextProxy(spy);
    };

    Object.defineProperty(win.HTMLMediaElement.prototype, 'paused', {
        configurable: true,
        get() { return this.__paused !== false; },
        set(value: boolean) { this.__paused = value; },
    });
    Object.defineProperty(win.HTMLMediaElement.prototype, 'currentTime', {
        configurable: true,
        get() { return this.__currentTime || 0; },
        set(value: number) { this.__currentTime = value; },
    });
    Object.defineProperty(win.HTMLMediaElement.prototype, 'duration', {
        configurable: true,
        get() { return this.__duration || 1; },
        set(value: number) { this.__duration = value; },
    });
    Object.defineProperty(win.HTMLMediaElement.prototype, 'ended', {
        configurable: true,
        get() { return !!this.__ended; },
        set(value: boolean) { this.__ended = value; },
    });
    win.HTMLMediaElement.prototype.play = function () {
        this.paused = false;
        this.ended = false;
        this.dispatchEvent(new win.Event('play'));
        return Promise.resolve();
    };
    win.HTMLMediaElement.prototype.pause = function () {
        const wasPaused = this.paused;
        this.paused = true;
        if (!wasPaused) {
            this.dispatchEvent(new win.Event('pause'));
        }
    };

    win.__APP_STATE__ = JSON.parse(appStateJson);

    return { dom, postedMessages, offscreenInstances, domCanvasContexts };
}

/**
 * renderScript() の文字列を jsdom の window.eval() で実行する。
 * runScripts: 'dangerously' が必要。
 */
export function evalScript(dom: JSDOM, scriptContent: string): void {
    (dom.window as any).eval(scriptContent);
}
