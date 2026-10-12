import test from 'node:test';
import assert from 'node:assert/strict';
import { channelIndexAttribute, spectrumHoverAt } from '../webview/runtime/spectrumRuntime';

const withAttr = (value: string | null) => ({ getAttribute: (name: string) => (name === 'data-channel-index' ? value : null) });

test('channelIndexAttribute: data-channel-index を整数で返し、欠落や非数値は null', () => {
    assert.equal(channelIndexAttribute(withAttr('2')), 2);
    assert.equal(channelIndexAttribute(withAttr('0')), 0);
    assert.equal(channelIndexAttribute(withAttr(null)), null);
    assert.equal(channelIndexAttribute(withAttr('ch')), null);
});

test('spectrumHoverAt: プロット領域内の位置を 0..1 に正規化してクランプする', () => {
    assert.deepEqual(spectrumHoverAt(60, 50, 120, 100, 20, 0), { hoverNorm: 0.4, yFrac: 0.5 });
    assert.deepEqual(spectrumHoverAt(5, -10, 120, 100, 20, 0), { hoverNorm: 0, yFrac: 0 });
    assert.deepEqual(spectrumHoverAt(500, 300, 120, 100, 20, 0), { hoverNorm: 1, yFrac: 1 });
});

test('spectrumHoverAt: 高さ 0 のキャンバスは 140px として扱う', () => {
    assert.equal(spectrumHoverAt(60, 70, 120, 0, 20, 0)?.yFrac, 0.5);
});

test('spectrumHoverAt: プロット幅が 0 以下なら null', () => {
    assert.equal(spectrumHoverAt(10, 10, 40, 100, 20, 20), null);
});
