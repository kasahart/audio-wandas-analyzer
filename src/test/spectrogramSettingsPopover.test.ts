import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { SpectrogramDisplaySettings, SpectrogramSettings } from '../shared/analysis/analysisTypes';
import { getStrings } from '../shared/i18n/strings';
import { installSpectrogramSettingsPopover, stftWindowFromValue } from '../webview/runtime/spectrogramSettingsPopover';

function setup(initial: SpectrogramSettings) {
    const dom = new JSDOM('<body><button data-action="spectrogram-settings" id="gear"></button><button data-action="spectrum-settings" id="spectrum-gear"></button><div id="outside"></div></body>');
    const document = dom.window.document;
    let settings = initial;
    const displays: SpectrogramDisplaySettings[] = [];
    const applied: SpectrogramSettings[] = [];
    let resets = 0;
    const popover = installSpectrogramSettingsPopover(document, {
        strings: getStrings('en'),
        getSettings: () => settings,
        onDisplayChange: display => displays.push(display),
        onReset: () => {
            resets += 1;
            settings = { auto: true, stft: { nFft: 1024, overlapPercent: 75, window: 'hann' }, display: { dbMin: null, dbMax: null, maxFrequencyHz: null } };
        },
        onApply: next => applied.push(next),
    });
    const el = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
    const change = (id: string) => el(id).dispatchEvent(new dom.window.Event('change'));
    return { dom, document, popover, el, change, displays, applied, resets: () => resets };
}

const CUSTOM: SpectrogramSettings = {
    auto: false,
    stft: { nFft: 2048, overlapPercent: 67, window: 'blackman' },
    display: { dbMin: -90, dbMax: null, maxFrequencyHz: 8000 },
};

test('stftWindowFromValue falls back to hann for unknown windows', () => {
    assert.equal(stftWindowFromValue('hamming'), 'hamming');
    assert.equal(stftWindowFromValue('boxcar'), 'boxcar');
    assert.equal(stftWindowFromValue('kaiser'), 'hann');
});

test('clicking the gear toggles the popover and syncs the form from the current settings', () => {
    const { popover, el } = setup(CUSTOM);
    assert.equal(popover.isOpen(), false);
    el<HTMLButtonElement>('gear').click();
    assert.equal(popover.isOpen(), true);
    assert.equal(el('spec-auto').checked, false);
    assert.equal(el<HTMLSelectElement>('spec-nfft').value, '2048');
    assert.equal(el<HTMLSelectElement>('spec-overlap').value, '67');
    assert.equal(el<HTMLSelectElement>('spec-window').value, 'blackman');
    assert.equal(el('spec-dbmin').value, '-90');
    assert.equal(el('spec-dbmax').value, '');
    assert.equal(el('spec-maxfreq').value, '8000');
    assert.equal(el<HTMLFieldSetElement>('spec-stft-fields').disabled, false);
    el<HTMLButtonElement>('gear').click();
    assert.equal(popover.isOpen(), false);
});

test('the docked spectrum gear opens the same settings, and switching gears keeps the popover open', () => {
    const { popover, el } = setup(CUSTOM);
    el<HTMLButtonElement>('spectrum-gear').click();
    assert.equal(popover.isOpen(), true);
    assert.equal(el<HTMLSelectElement>('spec-nfft').value, '2048');
    el<HTMLButtonElement>('gear').click();
    assert.equal(popover.isOpen(), true);
    el<HTMLButtonElement>('gear').click();
    assert.equal(popover.isOpen(), false);
});

test('outside clicks and Escape close the popover', () => {
    const { dom, document, popover, el } = setup(CUSTOM);
    popover.open();
    el<HTMLSelectElement>('spec-overlap').click();
    assert.equal(popover.isOpen(), true);
    el<HTMLDivElement>('outside').click();
    assert.equal(popover.isOpen(), false);
    popover.open();
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(popover.isOpen(), false);
});

test('toggling auto disables the STFT fieldset', () => {
    const { popover, el, change } = setup(CUSTOM);
    popover.open();
    el('spec-auto').checked = true;
    change('spec-auto');
    assert.equal(el<HTMLFieldSetElement>('spec-stft-fields').disabled, true);
});

test('display field changes report the parsed display settings', () => {
    const { popover, el, change, displays } = setup(CUSTOM);
    popover.open();
    el('spec-dbmax').value = '-10';
    change('spec-dbmax');
    assert.deepEqual(displays, [{ dbMin: -90, dbMax: -10, maxFrequencyHz: 8000 }]);
});

test('apply reports the form settings and closes; reset resyncs the form from the new settings', () => {
    const { popover, el, applied, resets } = setup(CUSTOM);
    popover.open();
    el<HTMLSelectElement>('spec-overlap').value = '50';
    el<HTMLButtonElement>('spec-apply').click();
    assert.deepEqual(applied, [{ ...CUSTOM, stft: { ...CUSTOM.stft, overlapPercent: 50 } }]);
    assert.equal(popover.isOpen(), false);
    popover.open();
    el<HTMLButtonElement>('spec-reset').click();
    assert.equal(resets(), 1);
    assert.equal(el('spec-auto').checked, true);
    assert.equal(el<HTMLSelectElement>('spec-nfft').value, '1024');
    assert.equal(el('spec-dbmin').value, '');
    assert.equal(el<HTMLFieldSetElement>('spec-stft-fields').disabled, true);
});
