import { escapeHtml } from '../../shared/utils/webviewEscaping';
import { STFT_OVERLAP_PERCENT_OPTIONS, type SpectrogramDisplaySettings, type SpectrogramSettings, type StftWindow } from '../../shared/analysis/analysisTypes';
import type { UiStrings } from '../../shared/i18n/strings';
import { eventTarget } from './domAdapter';
import { hintAttr, hoverHintAttr } from './hintFooter';
import { keyRouterFor } from './keyRouter';

export type SpectrogramSettingsPopoverStrings = Pick<UiStrings,
    'specSettingsAuto' | 'specSettingsStftLegend' | 'specSettingsNFft' | 'specSettingsOverlap' | 'specSettingsWindow'
    | 'specSettingsDisplayLegend' | 'specSettingsDbMin' | 'specSettingsDbMax' | 'specSettingsMaxFreqHz'
    | 'btnZoomReset' | 'stepApply' | 'specSettingsPlaceholderAuto' | 'specSettingsPlaceholderNyquist'
    | 'settingsApplyHint' | 'hintSpecAuto' | 'hintSpecNFft' | 'hintSpecOverlap' | 'hintSpecWindow' | 'hintSpecDisplay'
    | 'hintSpecReset' | 'hintSpecApply' | 'specSettingsColorRange' | 'specSettingsWindowBoxcar'>;

export interface SpectrogramSettingsPopoverOptions {
    strings: SpectrogramSettingsPopoverStrings;
    getSettings(): SpectrogramSettings;
    onDisplayChange(display: SpectrogramDisplaySettings): void;
    onReset(): void;
    onApply(settings: SpectrogramSettings): void;
}

export interface SpectrogramSettingsPopover {
    open(from?: Element): void;
    close(): void;
    isOpen(): boolean;
    applyAutoState(): void;
}

const NFFT_OPTIONS = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
const GEAR_SELECTOR = '[data-action="spectrogram-settings"], [data-action="spectrum-settings"]';

export function spectrogramSettingsPopoverHtml(strings: SpectrogramSettingsPopoverStrings): string {
    const nfftOptions = NFFT_OPTIONS.map(v => '<option value="' + v + '">' + v + '</option>').join('');
    const overlapOptions = STFT_OVERLAP_PERCENT_OPTIONS.map(v => '<option value="' + v + '">' + v + '%</option>').join('');
    const row = (label: string, hint: string, control: string): string =>
        '<label class="spec-pop-row"' + hoverHintAttr(hint) + '><span>' + escapeHtml(label) + '</span>' + control + '</label>';
    const number = (id: string, placeholder: string, label: string, extra = ''): string =>
        '<input type="number" class="spec-pop-field" id="' + id + '" step="1"' + extra + ' placeholder="' + escapeHtml(placeholder) + '" aria-label="' + escapeHtml(label) + '"' + hintAttr(strings.hintSpecDisplay) + '>';
    return '<div id="spec-settings-popover" class="spec-pop" hidden>'
        + '<label class="spec-pop-check"' + hoverHintAttr(strings.hintSpecAuto) + '><input type="checkbox" id="spec-auto"' + hintAttr(strings.hintSpecAuto) + '> ' + escapeHtml(strings.specSettingsAuto) + '</label>'
        + '<fieldset id="spec-stft-fields" class="spec-pop-group">'
        + '<legend>' + escapeHtml(strings.specSettingsStftLegend) + '</legend>'
        + row(strings.specSettingsNFft, strings.hintSpecNFft, '<select class="spec-pop-field" id="spec-nfft"' + hintAttr(strings.hintSpecNFft) + '>' + nfftOptions + '</select>')
        + row(strings.specSettingsOverlap, strings.hintSpecOverlap, '<select class="spec-pop-field" id="spec-overlap"' + hintAttr(strings.hintSpecOverlap) + '>' + overlapOptions + '</select>')
        + row(strings.specSettingsWindow, strings.hintSpecWindow, '<select class="spec-pop-field" id="spec-window"' + hintAttr(strings.hintSpecWindow) + '>'
            + '<option value="hann">Hann</option><option value="hamming">Hamming</option>'
            + '<option value="blackman">Blackman</option><option value="boxcar">' + escapeHtml(strings.specSettingsWindowBoxcar) + '</option>'
            + '</select>')
        + '<div class="spec-pop-note">' + escapeHtml(strings.settingsApplyHint) + '</div>'
        + '</fieldset>'
        + '<fieldset class="spec-pop-group"' + hoverHintAttr(strings.hintSpecDisplay) + '>'
        + '<legend>' + escapeHtml(strings.specSettingsDisplayLegend) + '</legend>'
        // The colour range is one row, low – high: either end left empty follows the data.
        + '<div class="spec-pop-row"><span>' + escapeHtml(strings.specSettingsColorRange) + '</span><span class="spec-pop-pair">'
        + number('spec-dbmin', strings.specSettingsPlaceholderAuto, strings.specSettingsDbMin) + '<span aria-hidden="true">–</span>'
        + number('spec-dbmax', strings.specSettingsPlaceholderAuto, strings.specSettingsDbMax) + '</span></div>'
        + row(strings.specSettingsMaxFreqHz, strings.hintSpecDisplay, number('spec-maxfreq', strings.specSettingsPlaceholderNyquist, strings.specSettingsMaxFreqHz, ' min="1"'))
        + '</fieldset>'
        + '<div class="spec-pop-bar">'
        + '<button type="button" class="tb-btn" id="spec-reset"' + hintAttr(strings.hintSpecReset) + '>' + escapeHtml(strings.btnZoomReset) + '</button>'
        + '<button type="button" class="tb-btn spec-pop-apply" id="spec-apply"' + hintAttr(strings.hintSpecApply) + '>' + escapeHtml(strings.stepApply) + '</button>'
        + '</div>'
        + '</div>';
}

export function stftWindowFromValue(value: string): StftWindow {
    return value === 'hamming' || value === 'blackman' || value === 'boxcar' ? value : 'hann';
}

export function installSpectrogramSettingsPopover(
    document: Document,
    options: SpectrogramSettingsPopoverOptions,
): SpectrogramSettingsPopover {
    document.body.insertAdjacentHTML('beforeend', spectrogramSettingsPopoverHtml(options.strings));
    const popover = document.getElementById('spec-settings-popover');
    const field = <T extends HTMLElement = HTMLInputElement>(id: string): T => document.getElementById(id) as T;

    function optionalNumber(id: string): number | null {
        const value = field(id).value;
        return value === '' ? null : Number(value);
    }
    function readDisplay(): SpectrogramDisplaySettings {
        return { dbMin: optionalNumber('spec-dbmin'), dbMax: optionalNumber('spec-dbmax'), maxFrequencyHz: optionalNumber('spec-maxfreq') };
    }
    function applyAutoState(): void {
        field<HTMLFieldSetElement>('spec-stft-fields').disabled = field('spec-auto').checked;
    }
    let reported = '';
    function syncFromSettings(): void {
        const settings = options.getSettings();
        const text = (v: number | null) => v == null ? '' : String(v);
        field('spec-auto').checked = !!settings.auto;
        field('spec-nfft').value = String(settings.stft.nFft);
        field<HTMLSelectElement>('spec-overlap').value = String(settings.stft.overlapPercent);
        field<HTMLSelectElement>('spec-window').value = settings.stft.window;
        field('spec-dbmin').value = text(settings.display.dbMin);
        field('spec-dbmax').value = text(settings.display.dbMax);
        field('spec-maxfreq').value = text(settings.display.maxFrequencyHz);
        reported = JSON.stringify(readDisplay());
        applyAutoState();
    }
    let anchor: Element | null = null;
    function open(from?: Element): void {
        const gears = Array.from(document.querySelectorAll<HTMLElement>(GEAR_SELECTOR));
        const gear = from || gears.find(g => g.getClientRects().length > 0) || gears[0];
        if (!gear || !popover) {
            return;
        }
        anchor = gear;
        popover.hidden = false;
        syncFromSettings();
        const rect = gear.getBoundingClientRect();
        popover.style.left = Math.max(8, rect.right - 280) + 'px';
        const viewportHeight = document.documentElement.clientHeight;
        // The body does not scroll, so a popover taller than the Webview must scroll internally to keep Apply reachable.
        popover.style.maxHeight = Math.max(0, viewportHeight - 16) + 'px';
        popover.style.overflowY = 'auto';
        const height = popover.offsetHeight;
        // The docked spectrum gear sits at the page bottom, so open upwards when there is no room below.
        const below = rect.bottom + 6;
        const above = rect.top - 6 - height;
        const top = below + height <= viewportHeight ? below : above >= 0 ? above : Math.max(8, viewportHeight - height - 8);
        popover.style.top = top + 'px';
    }
    function close(): void {
        if (popover) {
            popover.hidden = true;
        }
    }

    field('spec-auto').addEventListener('change', applyAutoState);
    // The display range is drawn as it is typed (no Apply): a half-typed number such as "-" waits for its digits.
    ['spec-dbmin', 'spec-dbmax', 'spec-maxfreq'].forEach(id => {
        const report = () => {
            if (field(id).validity?.badInput) return;
            const display = readDisplay();
            if (JSON.stringify(display) === reported) return;
            reported = JSON.stringify(display);
            options.onDisplayChange(display);
        };
        field(id).addEventListener('input', report);
        field(id).addEventListener('change', report);
    });
    field('spec-reset').addEventListener('click', () => {
        options.onReset();
        syncFromSettings();
    });
    field('spec-apply').addEventListener('click', () => {
        options.onApply({
            auto: field('spec-auto').checked,
            stft: {
                nFft: Number(field('spec-nfft').value),
                overlapPercent: Number(field<HTMLSelectElement>('spec-overlap').value),
                window: stftWindowFromValue(field<HTMLSelectElement>('spec-window').value),
            },
            display: readDisplay(),
        });
        close();
    });
    document.addEventListener('click', function (ev) {
        const target = eventTarget(ev);
        const gear = target && target.closest ? target.closest(GEAR_SELECTOR) : null;
        if (gear) {
            ev.stopPropagation();
            if (!popover || popover.hidden || anchor !== gear) {
                open(gear);
            }
            else {
                close();
            }
            return;
        }
        if (popover && !popover.hidden && !popover.contains(target)) {
            close();
        }
    });
    keyRouterFor(document.defaultView!).add({
        layer: 'popover',
        keydown(ev) {
            if (ev.key !== 'Escape' || !popover || popover.hidden) {
                return false;
            }
            close();
            return true;
        },
    });

    return { open, close, isOpen: () => !!popover && !popover.hidden, applyAutoState };
}
