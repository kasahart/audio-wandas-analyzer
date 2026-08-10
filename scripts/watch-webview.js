#!/usr/bin/env node
/**
 * Webview の tsc 出力が更新されるたびに scripts/build-webview.js を再実行する。
 *
 * npm run watch (tsc -watch) と併走させる前提のサイドカー。
 * 単体実行も可能。Ctrl+C で終了。
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'dist', 'webview', 'waveform', 'waveformRenderer.js');
const WATCH_DIRS = [
    path.join(ROOT, 'dist', 'webview', 'waveform'),
    path.join(ROOT, 'dist', 'webview', 'draw'),
    path.join(ROOT, 'dist', 'webview', 'runtime'),
];
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

    let debounceTimer = null;
    WATCH_DIRS.forEach((dir) => {
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
        fs.watch(dir, { persistent: true }, (_event, fname) => {
            if (!fname || !fname.endsWith('.js')) { return; }
            if (debounceTimer) { clearTimeout(debounceTimer); }
            debounceTimer = setTimeout(() => rebuild('change'), 150);
        });
    });
    console.log(`watch-webview: watching ${WATCH_DIRS.map((dir) => path.relative(ROOT, dir)).join(', ')}`);
}

startWatcher();
