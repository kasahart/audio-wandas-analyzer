#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const webviewRoot = path.join(repoRoot, 'src', 'webview');

const PATTERNS = [
    {
        id: 'hidden-inline-display',
        description: 'Avoid combining the hidden attribute with an inline display style in generated Webview HTML.',
        regexes: [
            /<[^>]*\bhidden\b[^>]*\bstyle\s*=\s*["'][^"']*\bdisplay\s*:/gisu,
            /<[^>]*\bstyle\s*=\s*["'][^"']*\bdisplay\s*:[^"']*["'][^>]*\bhidden\b/gisu,
        ],
    },
];

/** @param {string} dir */
function listSourceFiles(dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listSourceFiles(fullPath));
            continue;
        }
        if (entry.isFile() && fullPath.endsWith('.ts')) {
            out.push(fullPath);
        }
    }
    return out;
}

/** @param {string} text @param {number} index */
function lineNumberAt(text, index) {
    return text.slice(0, index).split('\n').length;
}

/** @param {string} text @param {number} index */
function excerptAt(text, index) {
    const start = Math.max(0, index - 80);
    const end = Math.min(text.length, index + 160);
    return text.slice(start, end).replace(/\s+/gu, ' ').trim();
}

const findings = [];

for (const filePath of listSourceFiles(webviewRoot)) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const pattern of PATTERNS) {
        for (const regex of pattern.regexes) {
            regex.lastIndex = 0;
            let match;
            while ((match = regex.exec(source)) !== null) {
                findings.push({
                    filePath,
                    line: lineNumberAt(source, match.index),
                    description: pattern.description,
                    excerpt: excerptAt(source, match.index),
                });
            }
        }
    }
}

if (findings.length > 0) {
    console.error('Webview pattern lint failed:\n');
    for (const finding of findings) {
        console.error(`${path.relative(repoRoot, finding.filePath)}:${finding.line}`);
        console.error(`  ${finding.description}`);
        console.error(`  ${finding.excerpt}`);
        console.error('');
    }
    process.exit(1);
}

console.log('webview pattern lint: OK');
