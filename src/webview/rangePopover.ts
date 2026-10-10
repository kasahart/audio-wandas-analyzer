// Axis range popover shared by the comparison runtime (bundled import) and the recipe ChartSpec
// render script (inlined through Function.prototype.toString(), so this function must stay
// self-contained: no references to anything outside its own body).

export interface RangePopoverStrings {
    title: string;
    min: string;
    max: string;
    apply: string;
    auto: string;
    close: string;
    invalid: string;
}

export interface RangePopoverConfig {
    rootId: string;
    badgeId: string;
    /** Prefix for the inner element ids: `<prefix>-min`, `-max`, `-apply`, `-auto`, `-close`, `-error`, `-inputs`. */
    idPrefix: string;
    strings: RangePopoverStrings;
    position(clientX: number, clientY: number, width: number, height: number, viewportWidth: number, viewportHeight: number): { left: number; top: number };
}

export interface RangePopoverRequest {
    axisLabel: string;
    badgeColor?: string;
    /** Horizontal axes show Min (left) → Max (right); vertical axes stack Max above Min. */
    horizontal: boolean;
    min: string;
    max: string;
    clientX: number;
    clientY: number;
    /** Receives validated bounds (null = auto); return a message to keep the popover open with that error. */
    apply(min: number | null, max: number | null): string | void;
    auto(): void;
}

export interface RangePopover {
    open(request: RangePopoverRequest): void;
    close(): void;
}

export function installRangePopover(doc: Document, config: RangePopoverConfig): RangePopover {
    const id = (suffix: string): string => config.idPrefix + '-' + suffix;
    const strings = config.strings;
    let active: RangePopoverRequest | null = null;

    const pop = doc.createElement('div');
    pop.id = config.rootId;
    pop.style.cssText = 'display:none;position:fixed;z-index:9999;background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:10px 12px;font-size:12px;color:var(--text);box-shadow:0 4px 12px rgba(0,0,0,.4);min-width:180px;';
    const header = doc.createElement('div');
    header.style.cssText = 'margin-bottom:8px;font-weight:600;font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;';
    header.append(strings.title);
    const badge = doc.createElement('span');
    badge.id = config.badgeId;
    badge.style.cssText = 'padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700;color:#fff;background:#0e639c;';
    header.appendChild(badge);
    const inputs = doc.createElement('div');
    inputs.id = id('inputs');
    inputs.style.cssText = 'display:flex;flex-direction:column;gap:4px;align-items:center;';
    function field(name: 'min' | 'max', text: string): [HTMLLabelElement, HTMLInputElement] {
        const label = doc.createElement('label');
        label.id = id(name + '-label');
        label.style.cssText = 'display:flex;align-items:center;gap:6px;';
        const caption = doc.createElement('span');
        caption.style.cssText = 'width:42px;font-size:11px;color:var(--muted);';
        caption.textContent = text;
        const input = doc.createElement('input');
        input.id = id(name);
        input.type = 'number';
        input.step = 'any';
        input.placeholder = 'auto';
        input.setAttribute('aria-label', text);
        input.style.cssText = 'width:90px;background:var(--vscode-input-background,#3c3c3c);color:inherit;border:1px solid var(--vscode-input-border,#555);border-radius:2px;padding:2px 4px;font-size:12px;';
        label.append(caption, input);
        return [label, input];
    }
    const [minLabel, minInput] = field('min', strings.min);
    const [maxLabel, maxInput] = field('max', strings.max);
    inputs.append(minLabel, maxLabel);
    const buttons = doc.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
    function button(name: string, text: string, flex: boolean): HTMLButtonElement {
        const element = doc.createElement('button');
        element.id = id(name);
        element.className = 'tb-btn';
        element.textContent = text;
        if (flex) { element.style.flex = '1'; }
        buttons.appendChild(element);
        return element;
    }
    const applyButton = button('apply', strings.apply, true);
    const autoButton = button('auto', strings.auto, true);
    const closeButton = button('close', '×', false);
    closeButton.setAttribute('aria-label', strings.close);
    const error = doc.createElement('div');
    error.id = id('error');
    error.style.cssText = 'color:#f48771;font-size:11px;margin-top:4px;min-height:14px;';
    pop.append(header, inputs, buttons, error);
    doc.body.appendChild(pop);

    function close(): void {
        pop.style.display = 'none';
        error.textContent = '';
        active = null;
    }
    function parse(input: HTMLInputElement): number | null | undefined {
        const text = input.value.trim();
        if (text === '') { return null; }
        const value = Number(text);
        return Number.isFinite(value) ? value : undefined;
    }
    applyButton.addEventListener('click', () => {
        if (!active) { return; }
        const min = parse(minInput), max = parse(maxInput);
        if (min === undefined || max === undefined || (min !== null && max !== null && min >= max)) {
            error.textContent = strings.invalid;
            return;
        }
        const message = active.apply(min, max);
        if (message) { error.textContent = message; return; }
        close();
    });
    autoButton.addEventListener('click', () => {
        if (active) { active.auto(); }
        close();
    });
    closeButton.addEventListener('click', close);
    doc.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); } });
    doc.addEventListener('mousedown', event => {
        if (pop.style.display !== 'none' && !pop.contains(event.target as Node | null)) { close(); }
    });

    return {
        open(request: RangePopoverRequest): void {
            active = request;
            badge.textContent = request.axisLabel;
            badge.style.background = request.badgeColor || '#0e639c';
            minInput.value = request.min;
            maxInput.value = request.max;
            inputs.style.flexDirection = request.horizontal ? 'row' : 'column';
            minLabel.style.order = request.horizontal ? '0' : '1';
            maxLabel.style.order = request.horizontal ? '1' : '0';
            error.textContent = '';
            pop.style.display = 'block';
            const view = doc.defaultView;
            const rect = pop.getBoundingClientRect();
            const position = config.position(request.clientX, request.clientY, rect.width, rect.height,
                view ? view.innerWidth : 0, view ? view.innerHeight : 0);
            pop.style.left = position.left + 'px';
            pop.style.top = position.top + 'px';
            (request.horizontal ? minInput : maxInput).focus();
        },
        close,
    };
}
