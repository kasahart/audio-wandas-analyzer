#!/usr/bin/env node
/**
 * dist/webview/waveform/waveformRenderer.js が tsc -watch によって更新されるたびに
 * scripts/build-webview.js を再実行して dist/webview/comparisonWaveform.js を最新化する。
 *
 * npm run watch (tsc -watch) と併走させる前提のサイドカー。
 * 単体実行も可能。Ctrl+C で終了。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'dist', 'webview', 'waveform', 'waveformRenderer.js');
const BUILD_SCRIPT = path.join(__dirname, 'build-webview.js');

function rebuild(reason) {
    const result = spawnSync(process.execPath, [BUILD_SCRIPT], { stdio: 'inherit' });
    if (result.status !== 0) {
        console.error(`watch-webview: build failed (${reason})`);
    }
}

function startWatcher() {
    // 初回ビルド
    if (fs.existsSync(TARGET)) {
        rebuild('initial');
    } else {
        console.log(`watch-webview: waiting for ${path.relative(ROOT, TARGET)} to appear...`);
    }

    // 親ディレクトリ単位で watch (ファイル削除→再生成にも追随する)
    const dir = path.dirname(TARGET);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }

    let debounceTimer = null;
    fs.watch(dir, { persistent: true }, (_event, fname) => {
        if (fname !== path.basename(TARGET)) { return; }
        if (debounceTimer) { clearTimeout(debounceTimer); }
        debounceTimer = setTimeout(() => rebuild('change'), 150);
    });
    console.log(`watch-webview: watching ${path.relative(ROOT, TARGET)}`);
}

startWatcher();
