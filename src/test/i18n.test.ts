import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLocale, getStrings, getAllStrings } from '../shared/i18n/strings';

test('pickLocale: VS Code 言語 "ja" は ja', () => {
    assert.equal(pickLocale('ja'), 'ja');
});

test('pickLocale: "ja-JP" や "JA" も ja に正規化', () => {
    assert.equal(pickLocale('ja-JP'), 'ja');
    assert.equal(pickLocale('JA'), 'ja');
});

test('pickLocale: "en", "en-US", "fr" などは en にフォールバック', () => {
    assert.equal(pickLocale('en'), 'en');
    assert.equal(pickLocale('en-US'), 'en');
    assert.equal(pickLocale('fr'), 'en');
    assert.equal(pickLocale('zh-CN'), 'en');
});

test('pickLocale: undefined / 空文字 / 非文字列は en', () => {
    assert.equal(pickLocale(undefined), 'en');
    assert.equal(pickLocale(''), 'en');
    // @ts-expect-error: deliberately passing a non-string to verify defensive default
    assert.equal(pickLocale(null), 'en');
});

test('getStrings: ja で日本語、en で英語の対応キーを返す', () => {
    const ja = getStrings('ja');
    const en = getStrings('en-US');
    assert.equal(ja.btnWaveform, '波形');
    assert.equal(en.btnWaveform, 'Waveform');
    assert.equal(ja.btnSpectrogram, 'スペクトログラム');
    assert.equal(en.btnSpectrogram, 'Spectrogram');
});

test('getStrings: en と ja は同じキー集合を持つ (キー欠落の防止)', () => {
    const all = getAllStrings();
    const enKeys = Object.keys(all.en).sort();
    const jaKeys = Object.keys(all.ja).sort();
    assert.deepEqual(jaKeys, enKeys, '英日辞書のキー集合が一致すること');
});

test('getStrings: すべての値が非空文字列', () => {
    for (const locale of ['en', 'ja'] as const) {
        const dict = getStrings(locale);
        for (const [key, value] of Object.entries(dict)) {
            assert.equal(typeof value, 'string', `${locale}.${key} は string`);
            assert.ok(value.length > 0, `${locale}.${key} は非空`);
        }
    }
});
