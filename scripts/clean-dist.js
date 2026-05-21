#!/usr/bin/env node
/**
 * tsc -p ./ の直前に呼ばれ、dist/ 配下の "孤立した .js" (対応する src/.ts が
 * 既に存在しないファイル) を削除する。
 *
 * 解決する問題: ブランチ切替や rebase 後に dist/ 内に古いコンパイル成果が残り、
 * node:test がもう存在しないテスト .js を実行してしまう (実体験で 2 回ハマった)。
 *
 * 完全な dist/ 削除ではなく orphan のみを消すことで、tsc の incremental
 * compile (高速) を維持しつつ stale 起因の幻のテスト失敗を防ぐ。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');

if (!fs.existsSync(DIST_DIR)) {
    process.exit(0);
}

const srcSet = new Set();
function indexSrc(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { indexSrc(full); continue; }
        if (!entry.isFile()) { continue; }
        if (full.endsWith('.ts')) {
            // src/foo/bar.ts → dist/foo/bar.js のキー (拡張子なしの相対パス)
            const rel = path.relative(SRC_DIR, full).replace(/\.ts$/, '');
            srcSet.add(rel);
        }
    }
}
if (fs.existsSync(SRC_DIR)) { indexSrc(SRC_DIR); }

const removed = [];
function sweep(dir) {
    if (!fs.existsSync(dir)) { return; }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { sweep(full); continue; }
        if (!entry.isFile()) { continue; }
        // build-webview.js が生成する dist/webview/comparisonWaveform.js は
        // src に対応せず orphan に見えるが、必要なので保護する。
        // ディレクトリ単位で除外 (dist/webview ルート直下) する代わりに
        // この個別パスのみ skip する。
        if (full === path.join(DIST_DIR, 'webview', 'comparisonWaveform.js')) {
            continue;
        }
        // 対応 .ts は .js / .js.map / .d.ts のいずれかを生成しうる。
        const relNoExt = path.relative(DIST_DIR, full)
            .replace(/\.d\.ts$/, '')
            .replace(/\.js\.map$/, '')
            .replace(/\.js$/, '');
        if (!srcSet.has(relNoExt)) {
            fs.unlinkSync(full);
            removed.push(path.relative(ROOT, full));
        }
    }
}
sweep(DIST_DIR);

if (removed.length > 0) {
    console.log(`clean-dist: removed ${removed.length} orphan file(s):`);
    for (const f of removed) { console.log(`  - ${f}`); }
}
