#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

console.log('Compiling extension and E2E tests...');
try {
    execSync('npm run compile', { cwd: rootDir, stdio: 'inherit' });
} catch (error) {
    console.error('Compilation failed:', error);
    process.exit(1);
}

console.log('Detecting display environment and launching UX Audit...');
let command = 'node dist/e2e/runVscodeUXAudit.js';

// If xvfb-run is available, use it to launch headless on Linux
try {
    execSync('command -v xvfb-run', { stdio: 'ignore' });
    command = 'xvfb-run -a node dist/e2e/runVscodeUXAudit.js';
    console.log('Running via xvfb-run (virtual framebuffer)...');
} catch (e) {
    console.log('xvfb-run not found. Running directly...');
}

try {
    execSync(command, { cwd: rootDir, stdio: 'inherit' });
    console.log('UX Cognitive Audit completed successfully.');
} catch (error) {
    console.error('UX Cognitive Audit failed to execute:', error);
    process.exit(1);
}
