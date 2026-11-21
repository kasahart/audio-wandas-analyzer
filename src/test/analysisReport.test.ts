import assert from 'node:assert/strict';
import { assertNotDrawn } from './fullNotDrawn';
import test from 'node:test';
import { buildMarkdownReport, buildNotebook, type ReportTrack } from '../shared/report/analysisReport';

const track = (fileName: string, offsetSeconds: number, durationSeconds = 2): ReportTrack => ({
    offsetSeconds,
    result: {
        filePath: `/audio/${fileName}`, fileName, sampleRateHz: 48000, durationSeconds, channelCount: 1, sampleCount: 96000,
        channels: [{ label: 'mic', peakAbsolute: 0.5, fullScale: true, sourceUnit: 'FS', sourceLevelReferenceLabel: 'dBFS' }],
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
    // A region under a millisecond keeps its ends apart as written (a short transient is not written as nothing).
    const short = buildMarkdownReport([track('long.wav', 0, 3)], { globalStartSec: 1.0001, globalEndSec: 1.0004 }, new Date('2026-10-11T00:00:00Z'));
    assert.match(short, /- Global Start: 1\.0001 s\n- Global End: 1\.0004 s\n- Global Duration: 0\.0003 s/);
    assert.match(short, /\| long\.wav \| 0\.000 s \| 1\.0001 s \| 1\.0004 s \| 0\.0003 s \| In range \|/);
    // Ends that differ at the millisecond with a length that does not: the length decides the decimals, never written as zero.
    const across = buildMarkdownReport([track('long.wav', 0, 3)], { globalStartSec: 1.00049, globalEndSec: 1.00051 }, new Date('2026-10-11T00:00:00Z'));
    assert.match(across, /- Global Start: 1\.00049 s\n- Global End: 1\.00051 s\n- Global Duration: 0\.00002 s/);
    const aroundZero = buildMarkdownReport([track('long.wav', 0, 3)], { globalStartSec: -0.0001, globalEndSec: 0.0001 }, new Date('2026-10-11T00:00:00Z'));
    assert.match(aroundZero, /- Global Duration: 0\.0002 s/);
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
        const own = { ...measurement, levelReferenceLabel: clipped !== null ? 'dBFS' : 'dB re 1 input unit' };
        base.result.channels = [{ label: 'ch', peakAbsolute: rawPeakFullScale, peakLevelDb: 0, rawPeakFullScale, fullScale: clipped !== null, sourceUnit: clipped !== null ? 'FS' : '', sourceLevelReferenceLabel: clipped !== null ? 'dBFS' : 'dB re 1 input unit', clipped, measurement: own }];
        return base;
    };
    const report = buildMarkdownReport([measured('full.wav', 1, true), measured('vib.csv', 1.414, null)], undefined, new Date());
    assert.match(report, /\| full\.wav \| Channel 1 \(ch\) \| 1\.00  \| 0\.0 dBFS \(uncalibrated\) \| 1\.00 FS \| Yes \|/);
    assert.match(report, /\| vib\.csv \| Channel 1 \(ch\) \| 1\.41  \| 0\.0 dB re 1 input unit \(uncalibrated\) \| — \| — \|/);
});

test('the markdown report writes every sample\'s peak and level and the file\'s own length, never the envelope thinned to draw it', () => {
    const measurement = {
        calibrationStatus: 'uncalibrated' as const, calibrationSource: 'default' as const, factor: 1, linearUnit: 'FS',
        referenceValue: 1, referenceUnit: 'FS', levelUnit: 'dBFS', levelReferenceLabel: 'dBFS',
    };
    const spike = track('spike.wav', 0, 12.5);
    spike.result.channels = [{
        label: 'mic', peakAbsolute: 0.8125, peakLevelDb: 20 * Math.log10(0.8125), rawPeakFullScale: 0.8125, fullScale: true,
        sourceUnit: 'FS', sourceLevelReferenceLabel: 'dBFS', clipped: false, measurement,
    }];
    const report = buildMarkdownReport([spike], undefined, new Date('2026-11-09T00:00:00Z'));
    // The backend's peak of every sample (0.8125 FS, −1.8 dBFS); the length is the file's.
    assert.match(report, /\| spike\.wav \| [^|]+ \| 48000 Hz \| 12\.500 ?s \| 1 \| −1\.8 dBFS \|/);
    assert.match(report, /\| 0\.813 FS \| −1\.8 dBFS \(uncalibrated\) \|/);
    const written = /\| (\d+\.\d+) FS \|/u.exec(report)?.[1];
    assert.equal(written, '0.813');
    // The row's picture of the same recording is thinned to a few points and holds none of the file's peak.
    const drawn = [-0.2, 0.3, -0.25, 0.2];
    assertNotDrawn(written, Math.max(...drawn.map(Math.abs)).toFixed(3), 'not the peak of the points drawn');
    assert.doesNotMatch(report, /\b0\.30\b/);
});
