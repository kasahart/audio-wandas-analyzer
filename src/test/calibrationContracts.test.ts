import assert from 'node:assert/strict';
import test from 'node:test';
import { isConfigureCalibrationMessage } from '../shared/utils/audioTarget';
import { getCalibrationRenderScript } from '../webview/calibrationRenderScript';

test('configure-calibration message guard accepts exact channel metadata', () => {
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 2,
        filePath: '/tmp/audio.wav',
        channels: [
            { channelIndex: 0, label: 'microphone' },
            { channelIndex: 1, label: 'accelerometer' },
        ],
    }), true);
});

test('configure-calibration message guard rejects malformed payloads', () => {
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 0,
        filePath: '',
        channels: [],
    }), false);
    assert.equal(isConfigureCalibrationMessage({
        type: 'configure-calibration',
        trackIndex: 0,
        filePath: '/tmp/audio.wav',
        channels: [{ channelIndex: '0', label: 'microphone' }],
    }), false);
});

test('calibration webview runtime exposes the GUI and calibrated evidence output', () => {
    const script = getCalibrationRenderScript();

    assert.match(script, /data-action="configure-calibration"/);
    assert.match(script, /rmsLevelDb/);
    assert.match(script, /rawPeakFullScale/);
    assert.match(script, /dB SPL re 20 µPa/);
    assert.match(script, /with_calibration/);
    assert.match(script, /Spectrum overlay is unavailable/);
    assert.match(script, /calibration-reload/);
});
