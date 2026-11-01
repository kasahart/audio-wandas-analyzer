import assert from 'node:assert/strict';
import test from 'node:test';
import { channelsFromHeader } from '../shared/analysis/audioHeader';
import { SAMPLE_RATE_HZ, SAMPLE_SECONDS, sampleRecordings } from '../webview/runtime/sampleRecordings';

function pcm(bytes: Uint8Array): Int16Array {
    return new Int16Array(bytes.buffer.slice(bytes.byteOffset + 44, bytes.byteOffset + bytes.byteLength));
}

test('the samples are three short mono 16-bit WAV files the header reader accepts', () => {
    const samples = sampleRecordings();
    assert.equal(samples.length, 3);
    for (const sample of samples) {
        assert.match(sample.name, /\.wav$/);
        const view = new DataView(sample.bytes.buffer, sample.bytes.byteOffset);
        assert.equal(String.fromCharCode(...sample.bytes.slice(0, 4)), 'RIFF');
        assert.equal(view.getUint32(24, true), SAMPLE_RATE_HZ);
        assert.equal(view.getUint16(34, true), 16);
        assert.equal(sample.bytes.byteLength, 44 + SAMPLE_RATE_HZ * SAMPLE_SECONDS * 2);
        assert.deepEqual(channelsFromHeader(sample.bytes, sample.name), { channels: 1, durationS: SAMPLE_SECONDS });
        // Loud enough to see, and never clipped.
        const peak = pcm(sample.bytes).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
        assert.ok(peak > 3000 && peak < 32767, `peak ${peak}`);
    }
});

test('the samples share their hum: each differs from the first only by its added fault', () => {
    const [hum, whine, clicks] = sampleRecordings().map(sample => pcm(sample.bytes));
    // The whine adds a steady tone everywhere; the clicks only at the start of each half second.
    const quarter = SAMPLE_RATE_HZ / 4 + 1;
    assert.ok(Math.abs(whine[quarter] - hum[quarter]) > 0);
    assert.ok(Math.abs(clicks[quarter] - hum[quarter]) <= 1);
    assert.ok(Math.abs(clicks[SAMPLE_RATE_HZ / 2 + 1] - hum[SAMPLE_RATE_HZ / 2 + 1]) > 1000);
    // Every visitor gets the same files.
    assert.deepEqual(sampleRecordings()[0].bytes, sampleRecordings()[0].bytes);
});
