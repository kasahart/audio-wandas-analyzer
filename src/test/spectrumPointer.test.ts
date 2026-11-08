import test from 'node:test';
import assert from 'node:assert/strict';
import { channelIndexAttribute } from '../webview/runtime/spectrumRuntime';

const withAttr = (value: string | null) => ({ getAttribute: (name: string) => (name === 'data-channel-index' ? value : null) });

test('channelIndexAttribute: data-channel-index を整数で返し、欠落や非数値は null', () => {
    assert.equal(channelIndexAttribute(withAttr('2')), 2);
    assert.equal(channelIndexAttribute(withAttr('0')), 0);
    assert.equal(channelIndexAttribute(withAttr(null)), null);
    assert.equal(channelIndexAttribute(withAttr('ch')), null);
});

