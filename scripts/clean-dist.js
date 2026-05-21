#!/usr/bin/env node
/**
 * tsc -p ./ の直前に呼ばれ、dist/ 配下の tsc 出力 (.js / .js.map) のうち、
 * 対応する src/.ts が既に存在しない孤立ファイルを削除する。
 *
 * 解決する問題: ブランチ切替や rebase 後に dist/ 内に古いコンパイル成果が残り、
 * node:test がもう存在しないテスト .js を実行してしまう (実体験で 2 回ハマった)。
 *
 * 設計判断:
 * - 全 dist/ 削除ではなく orphan のみ消す → tsc incremental の高速性を維持
 * - 対象拡張子を tsc が実際に emit するもの (.js, .js.map) に限定し、
 *   将来 dist/ にコピーされうる他種ファイル (画像、JSON 等) を誤って消さない
 * - .d.ts は現在 tsconfig が emit しないため対象外 (将来 declaration を有効化
 *   する場合はここに足す)
 * - PROTECTED に列挙したパスは src と対応がなくても保持する (build-webview など
 *   別スクリプトが生成する成果物)。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');

// 拡張子 → 除去用正規表現。tsc が emit する成果物のみを管理対象とする。
const MANAGED_EXTENSIONS = [
    { ext: '.js.map', strip: /\.js\.map$/ },
    { ext: '.js', strip: /\.js$/ },
];

// src/ 対応のない build スクリプト生成物を保護する (dist からの相対パスで列挙)。
const PROTECTED_RELATIVE = new Set([
    path.join('webview', 'comparisonWaveform.js'),
]);

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
        const relFromDist = path.relative(DIST_DIR, full);
        if (PROTECTED_RELATIVE.has(relFromDist)) { continue; }

        // 管理対象拡張子に該当しないファイル (.json / 画像など) は触らない。
        const match = MANAGED_EXTENSIONS.find(({ ext }) => full.endsWith(ext));
        if (!match) { continue; }

        const relNoExt = relFromDist.replace(match.strip, '');
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
