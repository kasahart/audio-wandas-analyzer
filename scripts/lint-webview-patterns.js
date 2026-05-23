#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const webviewRoot = path.join(repoRoot, 'src', 'webview');

const inlineDisplayRegexes = [
    /\bstyle\s*=\s*["'][^"']*\bdisplay\s*:\s*([^;"']+)/iu,
];

const hiddenAttrRegexes = [
    /\bhidden\b/iu,
];

const ariaHiddenTrueRegexes = [
    /\baria-hidden\s*=\s*["']true["']/iu,
];

const roleDialogRegex = /\brole\s*=\s*["']dialog["']/iu;
const escapeHandlerRegex = /\bkey\s*===?\s*["']Escape["']|\bkey\s*==\s*["']Escape["']|key\s*:\s*["']Escape["']/u;
const tagRegex = /<[^>]+>/gisu;

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

/** @param {string} tag */
function getInlineDisplayValue(tag) {
    for (const regex of inlineDisplayRegexes) {
        const match = regex.exec(tag);
        if (match) {
            return match[1].trim().toLowerCase();
        }
    }
    return null;
}

/** @param {string} tag @param {RegExp[]} regexes */
function hasAny(tag, regexes) {
    return regexes.some((regex) => regex.test(tag));
}

/** @param {string} source @param {string} filePath */
function collectInlineVisibilityFindings(source, filePath) {
    /** @type {Array<{filePath:string,line:number,description:string,excerpt:string}>} */
    const findings = [];
    tagRegex.lastIndex = 0;
    let match;
    while ((match = tagRegex.exec(source)) !== null) {
        const tag = match[0];
        const display = getInlineDisplayValue(tag);
        if (display === null || display === 'none') {
            continue;
        }
        const line = lineNumberAt(source, match.index);
        const excerpt = excerptAt(source, match.index);
        if (hasAny(tag, hiddenAttrRegexes)) {
            findings.push({
                filePath,
                line,
                description: 'Avoid combining the hidden attribute with an inline display style other than none in generated Webview HTML.',
                excerpt,
            });
        }
        if (hasAny(tag, ariaHiddenTrueRegexes)) {
            findings.push({
                filePath,
                line,
                description: 'Avoid combining aria-hidden="true" with an inline display style other than none in generated Webview HTML.',
                excerpt,
            });
        }
    }
    return findings;
}

/** @param {string} source @param {string} filePath */
function collectDialogEscapeFindings(source, filePath) {
    /** @type {Array<{filePath:string,line:number,description:string,excerpt:string}>} */
    const findings = [];
    if (!roleDialogRegex.test(source)) {
        return findings;
    }
    if (escapeHandlerRegex.test(source)) {
        return findings;
    }
    const match = source.match(roleDialogRegex);
    const index = match && typeof match.index === 'number' ? match.index : 0;
    findings.push({
        filePath,
        line: lineNumberAt(source, index),
        description: 'Files that generate role="dialog" markup must also include an Escape-key handler so the dialog can be dismissed from the keyboard.',
        excerpt: excerptAt(source, index),
    });
    return findings;
}

const findings = [];

for (const filePath of listSourceFiles(webviewRoot)) {
    const source = fs.readFileSync(filePath, 'utf8');
    findings.push(...collectInlineVisibilityFindings(source, filePath));
    findings.push(...collectDialogEscapeFindings(source, filePath));
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
