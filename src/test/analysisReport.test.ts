import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarkdownReport, buildNotebook, type ReportTrack } from '../shared/report/analysisReport';

const waveform = { min: [], max: [], samples: [], absolutePeak: 0 };
const track = (fileName: string, offsetSeconds: number, durationSeconds = 2): ReportTrack => ({
    offsetSeconds,
    result: {
        filePath: `/audio/${fileName}`, fileName, sampleRateHz: 48000, durationSeconds, channelCount: 1, sampleCount: 96000,
        channels: [{ label: 'mic', peakAbsolute: 0.5, fullScale: true, waveform, spectrogram: null }],
    },
});

test('markdown report is a pure function of tracks, loop region and time', () => {
    const tracks = [track('a|b.wav', 0), track('late.wav', 1.5), track('long.wav', 0.5, 3)];
    const report = buildMarkdownReport(tracks, { globalStartSec: 1, globalEndSec: 2.5 }, new Date('2026-10-11T00:00:00Z'));
    assert.match(report, /\*\*Generated:\*\* 2026-10-11 00:00:00 UTC/);
    assert.match(report, /\| a\\\|b\.wav \|/, 'table cells escape pipes');
    assert.match(report, /\| a\\\|b\.wav \| 0\.000 s \| 1\.000 s \| 2\.000 s \| 1\.000 s \| Partial \|/);
    assert.match(report, /\| late\.wav \| 1\.500 s \| 0\.000 s \| 1\.000 s \| 1\.000 s \| Partial \|/);
    assert.match(report, /\| long\.wav \| 0\.500 s \| 0\.500 s \| 2\.000 s \| 1\.500 s \| In range \|/);
    assert.doesNotMatch(buildMarkdownReport(tracks, undefined, new Date()), /## Loop Region/);
    assert.match(report, /- long\.wav: \/audio\/long\.wav$/);
});

test('notebook loads each track from its report source path', () => {
    const exported = track('x.wav', 0);
    exported.result.reportSourcePath = 'audio/01-x.wav';
    const notebook = JSON.parse(buildNotebook([exported])) as { cells: Array<{ id: string; source: string[] }> };
    const load = notebook.cells.find(cell => cell.id === 'load-files')!;
    assert.equal(load.source[0], 'signal_1 = wd.read("audio/01-x.wav")\nsignal_1.describe()');
});

test('measurements: a source without a full scale reports neither a full-scale peak nor clipping', () => {
    const measurement = {
        calibrationStatus: 'uncalibrated' as const, calibrationSource: 'default' as const, factor: 1, linearUnit: '',
        referenceValue: 1, referenceUnit: '', levelUnit: 'dB', levelReferenceLabel: 'dB re 1 input unit',
    };
    const measured = (fileName: string, rawPeakFullScale: number, clipped: boolean | null): ReportTrack => {
        const base = track(fileName, 0);
        base.result.channels = [{ label: 'ch', peakAbsolute: rawPeakFullScale, peakLevelDb: 0, rawPeakFullScale, fullScale: clipped !== null, clipped, measurement, waveform, spectrogram: null }];
        return base;
    };
    const report = buildMarkdownReport([measured('full.wav', 1, true), measured('vib.csv', 1.414, null)], undefined, new Date());
    assert.match(report, /\| full\.wav \| Channel 1 \(ch\) \| 1\.00  \| 0\.0 dB \| 1\.00 FS \| Yes \|/);
    assert.match(report, /\| vib\.csv \| Channel 1 \(ch\) \| 1\.41  \| 0\.0 dB \| — \| — \|/);
});
