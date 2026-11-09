import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { byLevelKey, calibrationWordsBy, levelKeyOf, levelKeyOfReading } from '../webview/runtime/levelGrouping';

interface Side { unit: string; ref: number; label: string; status: string }
const CASES = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'levelIdentityCases.json'), 'utf8')) as Array<{ why: string; a: Side; b: Side; same: boolean }>;
const input = (side: Side) => ({ unit: side.unit, ref: side.ref, levelReferenceLabel: side.label, calibrationStatus: side.status });

test('lines share an axis by level identity alone: the grouping answers the table the backend answers, whatever their calibration status (R1, R4, A43)', () => {
    assert.ok(CASES.length >= 6);
    for (const item of CASES) {
        const groups = byLevelKey([item.a, item.b], side => levelKeyOf(input(side)));
        assert.equal(groups.size === 1, item.same, item.why);
        // A picture's own axis can only split lines further: never join two the identity keeps apart.
        assert.equal(levelKeyOf(input(item.a), 'x') === levelKeyOf(input(item.b), 'x'), item.same, item.why);
    }
    assert.notEqual(levelKeyOf(input(CASES[0].a), 'dB SPL re 20 µPa'), levelKeyOf(input(CASES[0].a), 'dB SPL re 1 Pa'));
});

test('an uncalibrated line says so only where it shares an axis with a calibrated one (R1, R4, A49)', () => {
    const spl = { unit: 'Pa', ref: 2e-5, levelReferenceLabel: 'dB SPL re 20 µPa' };
    const lines = [{ name: 'cal', level: spl, calibrated: true }, { name: 'raw', level: spl, calibrated: false }, { name: 'fs', level: { unit: 'FS', ref: 1, levelReferenceLabel: 'dBFS' }, calibrated: false }];
    const word = calibrationWordsBy(lines, line => levelKeyOf(line.level), line => line.calibrated, ' (uncal)');
    assert.deepEqual(lines.map(word), ['', ' (uncal)', '']);
});

test('spectrograms share a colour scale only of one reference unit and value and one axis as drawn (R1)', () => {
    const spl = { unit: 'dB SPL', axisLabel: 'STFT amplitude level [dB SPL re 20 µPa]', referenceUnit: 'Pa', referenceValue: 2e-5 };
    assert.equal(levelKeyOfReading(spl), levelKeyOfReading({ ...spl }));
    assert.notEqual(levelKeyOfReading(spl), levelKeyOfReading({ ...spl, referenceValue: 1 }));
    assert.notEqual(levelKeyOfReading(spl), levelKeyOfReading({ ...spl, referenceUnit: 'V' }));
    assert.notEqual(levelKeyOfReading(spl), levelKeyOfReading({ ...spl, unit: 'dBFS', axisLabel: 'STFT amplitude level [dBFS]' }));
});

/**
 * The class closed (A43, A49): nothing outside levelGrouping keys lines by level identity itself, nor by a label, an
 * axis title or a unit string; every file that builds a second level axis or a range per group takes its groups from
 * levelGrouping (or from overlayLevelAxes / byReference, which do).
 */
test('every place that groups lines onto a level axis, range or colour scale goes through levelGrouping (A43, A49, R1, R4)', () => {
    const root = path.join(__dirname, '..', '..', 'src');
    const files: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) { if (name !== 'test' && name !== 'generated') walk(full); } else if (name.endsWith('.ts')) files.push(full);
        }
    };
    walk(root);
    const IDENTITY_HOME = new Set(['webview/runtime/comparePanes.ts', 'webview/runtime/levelGrouping.ts']);
    const LABEL = '(?:levelReferenceLabel|axisLabel|spectrumLevelReference|shownLevelOf|levelUnit|referenceUnit|levelLabel)';
    const keyedByLabel = new RegExp(`\\.(?:get|set|has)\\(\\s*[^,()\\n]*\\b${LABEL}\\b|new (?:Set|Map)\\([^\\n]*\\b${LABEL}\\b|statuses\\.(?:get|set)\\(`, 'u');
    const buildsSecondary = /secondary:\s*\{\s*layers:/u;
    const rangesPerGroup = /new Map<string,\s*PaneRange>/u;
    const grouped = /from '\.\/levelGrouping'|\boverlayLevelAxes\(|\bbyReference\(/u;
    const problems: string[] = [];
    let builders = 0;
    for (const file of files) {
        const rel = path.relative(root, file).split(path.sep).join('/');
        const source = readFileSync(file, 'utf8');
        if (!IDENTITY_HOME.has(rel) && /\blevelIdentityOf\(/u.test(source)) problems.push(`${rel}: keys levels by levelIdentityOf itself`);
        if (rel !== 'webview/runtime/levelGrouping.ts' && keyedByLabel.test(source)) problems.push(`${rel}: keys levels by a label or unit (${keyedByLabel.exec(source)?.[0]})`);
        if (buildsSecondary.test(source) || rangesPerGroup.test(source)) {
            builders++;
            if (!grouped.test(source)) problems.push(`${rel}: builds a level axis per group without levelGrouping`);
        }
    }
    assert.ok(builders >= 3, `the second-axis and per-group range builders are walked (${builders})`);
    assert.deepEqual(problems, []);
});
