#!/usr/bin/env node
/**
 * `npm run watch`: tsc --watch for dist/, and esbuild watch contexts for the Webview bundles.
 *
 * esbuild watches every file a bundle imports (dist/shared included), so a change anywhere a Webview
 * bundle reaches is re-bundled once tsc has re-emitted it. Plain Node, so it runs the same on Windows.
 */

const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const esbuild = require('esbuild');
const { BUILDS } = require('./build-webview.js');

const ROOT = path.resolve(__dirname, '..');
const TSC = require.resolve('typescript/bin/tsc');

// The bundles' entry points must exist before esbuild can watch them.
const first = spawnSync(process.execPath, [TSC, '-p', ROOT], { stdio: 'inherit' });
if (first.status !== 0) {
    console.error('watch-webview: tsc reported errors; it keeps watching, and the bundles use the last emitted output.');
}

const tsc = spawn(process.execPath, [TSC, '-p', ROOT, '--watch', '--preserveWatchOutput'], { stdio: 'inherit' });

(async () => {
    const contexts = await Promise.all(BUILDS.map((build) => esbuild.context(build)));
    await Promise.all(contexts.map((context) => context.watch()));
    console.log(`watch-webview: watching ${contexts.length} Webview bundles`);
    const stop = async () => {
        tsc.kill();
        await Promise.all(contexts.map((context) => context.dispose()));
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    tsc.on('exit', stop);
})();
