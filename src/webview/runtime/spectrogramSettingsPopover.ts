import { escapeHtml } from '../../shared/utils/webviewEscaping';
import type { SpectrogramDisplaySettings, SpectrogramSettings, StftWindow } from '../../shared/analysis/analysisTypes';
import type { UiStrings } from '../../shared/i18n/strings';
import { eventTarget } from './domAdapter';
import { hintAttr, hoverHintAttr } from './hintFooter';

export type SpectrogramSettingsPopoverStrings = Pick<UiStrings,
    'specSettingsAuto' | 'specSettingsStftLegend' | 'specSettingsNFft' | 'specSettingsHopSize' | 'specSettingsWindow'
    | 'specSettingsDisplayLegend' | 'specSettingsDbMin' | 'specSettingsDbMax' | 'specSettingsMaxFreqHz'
    | 'specSettingsReset' | 'specSettingsApply' | 'specSettingsPlaceholderAuto' | 'specSettingsPlaceholderNyquist'
    | 'settingsApplyHint' | 'hintSpecAuto' | 'hintSpecNFft' | 'hintSpecHopSize' | 'hintSpecWindow' | 'hintSpecDisplay'
    | 'hintSpecReset' | 'hintSpecApply'>;

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
    return '<div id="spec-settings-popover" hidden style="position:absolute;z-index:50;background:var(--panel);border:1px solid var(--line);padding:12px;border-radius:6px;min-width:260px;color:var(--text);font-family:var(--font-ui);">'
        + '<label style="display:block;margin-bottom:6px"' + hoverHintAttr(strings.hintSpecAuto) + '><input type="checkbox" id="spec-auto"' + hintAttr(strings.hintSpecAuto) + '> ' + escapeHtml(strings.specSettingsAuto) + '</label>'
        + '<fieldset id="spec-stft-fields" style="border:1px solid var(--line);padding:6px;margin-bottom:8px">'
        + '<legend>' + escapeHtml(strings.specSettingsStftLegend) + '</legend>'
        + '<label' + hoverHintAttr(strings.hintSpecNFft) + '>' + escapeHtml(strings.specSettingsNFft) + ' <select id="spec-nfft"' + hintAttr(strings.hintSpecNFft) + '>' + nfftOptions + '</select></label><br>'
        + '<label' + hoverHintAttr(strings.hintSpecHopSize) + '>' + escapeHtml(strings.specSettingsHopSize) + ' <input type="number" id="spec-hop" min="1" step="1"' + hintAttr(strings.hintSpecHopSize) + '></label><br>'
        + '<label' + hoverHintAttr(strings.hintSpecWindow) + '>' + escapeHtml(strings.specSettingsWindow) + ' <select id="spec-window"' + hintAttr(strings.hintSpecWindow) + '>'
        + '<option value="hann">hann</option><option value="hamming">hamming</option>'
        + '<option value="blackman">blackman</option><option value="boxcar">boxcar</option>'
        + '</select></label>'
        + '<div style="font-size:11px;color:var(--muted)">' + escapeHtml(strings.settingsApplyHint) + '</div>'
        + '</fieldset>'
        + '<fieldset style="border:1px solid var(--line);padding:6px;margin-bottom:8px"' + hoverHintAttr(strings.hintSpecDisplay) + '>'
        + '<legend>' + escapeHtml(strings.specSettingsDisplayLegend) + '</legend>'
        + '<label>' + escapeHtml(strings.specSettingsDbMin) + ' <input type="number" id="spec-dbmin" step="1" placeholder="' + escapeHtml(strings.specSettingsPlaceholderAuto) + '"' + hintAttr(strings.hintSpecDisplay) + '></label><br>'
        + '<label>' + escapeHtml(strings.specSettingsDbMax) + ' <input type="number" id="spec-dbmax" step="1" placeholder="' + escapeHtml(strings.specSettingsPlaceholderAuto) + '"' + hintAttr(strings.hintSpecDisplay) + '></label><br>'
        + '<label>' + escapeHtml(strings.specSettingsMaxFreqHz) + ' <input type="number" id="spec-maxfreq" min="1" step="1" placeholder="' + escapeHtml(strings.specSettingsPlaceholderNyquist) + '"' + hintAttr(strings.hintSpecDisplay) + '></label>'
        + '</fieldset>'
        + '<div style="display:flex;gap:6px;justify-content:flex-end">'
        + '<button class="tb-btn" id="spec-reset"' + hintAttr(strings.hintSpecReset) + '>' + escapeHtml(strings.specSettingsReset) + '</button>'
        + '<button class="tb-btn" id="spec-apply"' + hintAttr(strings.hintSpecApply) + '>' + escapeHtml(strings.specSettingsApply) + '</button>'
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
    function syncFromSettings(): void {
        const settings = options.getSettings();
        const text = (v: number | null) => v == null ? '' : String(v);
        field('spec-auto').checked = !!settings.auto;
        field('spec-nfft').value = String(settings.stft.nFft);
        field('spec-hop').value = String(settings.stft.hopSize);
        field<HTMLSelectElement>('spec-window').value = settings.stft.window;
        field('spec-dbmin').value = text(settings.display.dbMin);
        field('spec-dbmax').value = text(settings.display.dbMax);
        field('spec-maxfreq').value = text(settings.display.maxFrequencyHz);
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
    ['spec-dbmin', 'spec-dbmax', 'spec-maxfreq'].forEach(id => {
        field(id).addEventListener('change', () => options.onDisplayChange(readDisplay()));
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
                hopSize: Number(field('spec-hop').value),
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
    document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') {
            close();
        }
    });

    return { open, close, isOpen: () => !!popover && !popover.hidden, applyAutoState };
}
