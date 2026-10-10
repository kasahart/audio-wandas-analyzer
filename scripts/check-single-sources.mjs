#!/usr/bin/env node
// Keeps values that must live in several files in step with their single source:
//   - Python runtime dependencies: pyproject.toml [project].dependencies
//   - Browser session limits: python-backend/browser_service.py (README tables, browserWavHint)
// `--write` regenerates the README limit tables; without it the script only checks (used by verify).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFileSync(join(root, relative), 'utf8');
const write = process.argv.includes('--write');
const problems = [];

// --- Python dependencies -------------------------------------------------------------------
const pyproject = read('pyproject.toml');
const dependencyBlock = /^dependencies = \[([\s\S]*?)^\]/m.exec(pyproject);
if (!dependencyBlock) throw new Error('pyproject.toml: [project].dependencies not found');
const dependencies = [...dependencyBlock[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
const requirementName = requirement => requirement.split(/[[<>=!~ ]/)[0];
const versionTuple = text => { const parts = text.split('.').map(Number); while (parts.length < 3) parts.push(0); return parts; };

const requirementsTxt = read('python-backend/requirements.txt').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
if (JSON.stringify([...requirementsTxt].sort()) !== JSON.stringify([...dependencies].sort())) {
    problems.push(`python-backend/requirements.txt must list exactly the pyproject dependencies: ${dependencies.join(', ')}`);
}
for (const readme of ['README.md', 'README.ja.md']) {
    const install = read(readme).split('\n').find(line => line.startsWith('pip install "'));
    const quoted = install ? [...install.matchAll(/"([^"]+)"/g)].map(match => match[1]).sort() : [];
    if (JSON.stringify(quoted) !== JSON.stringify([...dependencies].sort())) {
        problems.push(`${readme}: the pip install line must quote exactly the pyproject dependencies`);
    }
}
const environment = read('src/extension/pythonEnvironment.ts');
const probed = [...environment.matchAll(/distribution: '([^']+)',/g)].map(match => match[1]);
const unprobed = dependencies.map(requirementName).filter(name => !probed.includes(name));
if (unprobed.length) problems.push(`pythonEnvironment.ts: REQUIRED_PACKAGES has no record for ${unprobed.join(', ')}`);
for (const block of environment.matchAll(/distribution: '([^']+)',\s*requirement: '([^']+)',\s*minimum: \[([^\]]*)\],(?:\s*maximum: \[([^\]]*)\],)?/g)) {
    const [, distribution, requirement, minimum, maximum] = block;
    const declared = dependencies.find(dependency => requirementName(dependency) === distribution);
    if (declared !== requirement) {
        problems.push(`pythonEnvironment.ts: ${distribution} requirement '${requirement}' differs from pyproject '${declared}'`);
        continue;
    }
    const lower = /(?:^|,)\s*>=\s*([\d.]+)/.exec(requirement.replace(/^[^<>=!~]*/, ''));
    const upper = /(?:^|,)\s*<\s*([\d.]+)/.exec(requirement.replace(/^[^<>=!~]*/, ''));
    const tuple = text => text.split(',').map(value => Number(value.trim()));
    if (!lower || JSON.stringify(tuple(minimum)) !== JSON.stringify(versionTuple(lower[1]))) {
        problems.push(`pythonEnvironment.ts: ${distribution} minimum [${minimum}] does not match '${requirement}'`);
    }
    if (JSON.stringify(maximum ? tuple(maximum) : null) !== JSON.stringify(upper ? versionTuple(upper[1]) : null)) {
        problems.push(`pythonEnvironment.ts: ${distribution} maximum [${maximum ?? ''}] does not match '${requirement}'`);
    }
}

// --- Browser limits ------------------------------------------------------------------------
const browserService = read('python-backend/browser_service.py');
const constants = { MIB: 1024 * 1024 };
for (const [, name, expression] of browserService.matchAll(/^([A-Z_]+) = ([\d *A-Z_]+)$/gm)) {
    constants[name] = expression.split('*').map(term => term.trim()).reduce((product, term) => product * (/^\d+$/.test(term) ? Number(term) : constants[term]), 1);
    if (!Number.isFinite(constants[name])) throw new Error(`browser_service.py: cannot evaluate ${name}`);
}
const mib = bytes => bytes / constants.MIB;
const khz = hz => hz / 1000;
const limitRows = {
    'README.md': [
        '| Limit | Browser version |',
        '| --- | --- |',
        '| Audio format | RIFF WAV |',
        `| Per file | Up to ${mib(constants.MAX_INPUT_BYTES)} MiB and ${constants.MAX_DURATION_SECONDS} seconds; mono or stereo |`,
        `| Sample rate | ${khz(constants.MIN_SAMPLE_RATE_HZ)}–${khz(constants.MAX_SAMPLE_RATE_HZ)} kHz |`,
        `| Comparison | Up to ${constants.MAX_SOURCES} tracks and ${mib(constants.MAX_TOTAL_INPUT_BYTES)} MiB of input files in total |`,
        `| WAV export | Uncalibrated PCM16 audio; up to ${mib(constants.MAX_EXPORT_BYTES)} MiB in total |`,
    ],
    'README.ja.md': [
        '| 制限 | ブラウザー版 |',
        '| --- | --- |',
        '| 音声形式 | RIFF WAV |',
        `| 1 ファイル | ${mib(constants.MAX_INPUT_BYTES)} MiB・${constants.MAX_DURATION_SECONDS} 秒まで、モノラルまたはステレオ |`,
        `| サンプリング周波数 | ${khz(constants.MIN_SAMPLE_RATE_HZ)}–${khz(constants.MAX_SAMPLE_RATE_HZ)} kHz |`,
        `| 比較 | 最大 ${constants.MAX_SOURCES} トラック、入力ファイルの合計 ${mib(constants.MAX_TOTAL_INPUT_BYTES)} MiB まで |`,
        `| WAV 出力 | 校正を適用しない PCM16 音声、合計 ${mib(constants.MAX_EXPORT_BYTES)} MiB まで |`,
    ],
};
if (constants.MAX_CHANNELS !== 2) problems.push('browser_service.py: README wording "mono or stereo" assumes MAX_CHANNELS = 2');
// The browser page's opening hint repeats the same limits in both languages.
const strings = read('src/shared/i18n/strings.ts');
const hintFragments = {
    en: `up to ${constants.MAX_SOURCES} tracks / ${mib(constants.MAX_TOTAL_INPUT_BYTES)} MiB total input; each ≤${mib(constants.MAX_INPUT_BYTES)} MiB / ${constants.MAX_DURATION_SECONDS}s / ${constants.MAX_CHANNELS}ch`,
    ja: `最大${constants.MAX_SOURCES}トラック・入力合計${mib(constants.MAX_TOTAL_INPUT_BYTES)} MiB、各${mib(constants.MAX_INPUT_BYTES)} MiB・${constants.MAX_DURATION_SECONDS}秒・${constants.MAX_CHANNELS}ch以下`,
};
const hints = [...strings.matchAll(/browserWavHint: '([^']*)'/g)].map(match => match[1]);
for (const [language, fragment] of Object.entries(hintFragments)) {
    if (!hints.some(hint => hint.includes(fragment))) problems.push(`strings.ts: the ${language} browserWavHint must say "${fragment}"`);
}
const START = '<!-- browser-limits:start (generated by scripts/check-single-sources.mjs --write) -->';
const END = '<!-- browser-limits:end -->';
for (const [readme, rows] of Object.entries(limitRows)) {
    const text = read(readme);
    const start = text.indexOf(START), end = text.indexOf(END);
    if (start < 0 || end < start) { problems.push(`${readme}: browser limit markers are missing`); continue; }
    const expected = `${START}\n${rows.join('\n')}\n${END}`;
    if (text.slice(start, end + END.length) === expected) continue;
    if (write) writeFileSync(join(root, readme), text.slice(0, start) + expected + text.slice(end + END.length));
    else problems.push(`${readme}: browser limit table is out of date; run node scripts/check-single-sources.mjs --write`);
}

if (problems.length) {
    console.error(problems.map(problem => `✗ ${problem}`).join('\n'));
    process.exit(1);
}
console.log('Dependency pins and browser limits match their single sources');
