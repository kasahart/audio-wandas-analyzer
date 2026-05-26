import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildBrowserOpenCommand,
    buildComparisonPreviewHtml,
    resolvePreviewOutputPath,
} from '../tools/comparisonPreview';

test('buildComparisonPreviewHtml returns results-mode ComparisonPanel HTML', () => {
    const html = buildComparisonPreviewHtml('results');

    assert.match(html, /"mode":"results"/);
    assert.match(html, /id="toolbar"/);
    assert.match(html, /data-action="content-waveform"/);
    assert.doesNotMatch(html, /"mode":"directory-selection"/);
});

test('buildComparisonPreviewHtml returns selection-mode ComparisonPanel HTML', () => {
    const html = buildComparisonPreviewHtml('selection');

    assert.match(html, /"mode":"directory-selection"/);
    assert.match(html, /id="selection-toolbar"/);
    assert.match(html, /id="selection-tree"/);
});

test('resolvePreviewOutputPath creates a mode-specific html path under os.tmpdir()', () => {
    const filePath = resolvePreviewOutputPath('results');

    assert.equal(path.extname(filePath), '.html');
    assert.match(filePath, /comparison-preview-results\.html$/);
    assert.equal(filePath.startsWith(os.tmpdir()), true);
});

test('buildBrowserOpenCommand uses xdg-open on linux', () => {
    assert.deepEqual(
        buildBrowserOpenCommand('linux', '/tmp/comparison-preview-results.html'),
        { command: 'xdg-open', args: ['/tmp/comparison-preview-results.html'] },
    );
});

test('buildBrowserOpenCommand uses open on darwin', () => {
    assert.deepEqual(
        buildBrowserOpenCommand('darwin', '/tmp/comparison-preview-results.html'),
        { command: 'open', args: ['/tmp/comparison-preview-results.html'] },
    );
});

test('buildBrowserOpenCommand uses cmd /c start on win32', () => {
    assert.deepEqual(
        buildBrowserOpenCommand('win32', 'C:\\temp\\comparison-preview-results.html'),
        { command: 'cmd', args: ['/c', 'start', '', 'C:\\temp\\comparison-preview-results.html'] },
    );
});

test('buildComparisonPreviewHtml rejects unsupported mode values', () => {
    assert.throws(
        () => buildComparisonPreviewHtml('detail' as never),
        /Unsupported preview mode: detail/,
    );
});

test('tasks.json exposes browser preview tasks for results and selection modes', () => {
    const tasksPath = path.resolve(__dirname, '..', '..', '.vscode', 'tasks.json');
    const tasksJson = JSON.parse(readFileSync(tasksPath, 'utf8')) as {
        tasks: Array<{ label: string; command: string; args?: string[]; dependsOn?: string | string[] }>;
    };

    assert.ok(tasksJson.tasks.some((task) => task.label === 'Preview ComparisonPanel (Results)'));
    assert.ok(tasksJson.tasks.some((task) => task.label === 'Preview ComparisonPanel (Selection)'));
});
