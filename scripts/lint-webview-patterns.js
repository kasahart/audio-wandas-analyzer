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
    // `--minus-hits <file>...`: only the hand-made minus signs of those files, one line each (for its test).
if (process.argv[2] === '--minus-hits') {
    for (const finding of collectMinusFindings(process.argv.slice(3))) console.log(`${finding.filePath}:${finding.line}`);
    process.exit(0);
}

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

// Files that put pixels on a canvas. Every chart used to bring its own axes, scaling, decimation and hover, so the
// same fix had to be made once per chart. Charts are moving onto shared plot code; this list may only shrink:
// a new file that draws fails here (draw through the shared code instead), and a listed file that no longer
// draws must be taken off the list.
const CANVAS_DRAWING_FILES = [
    'src/shared/gui-core/index.ts',
    'src/webview/draw/canvasDrawers.ts',
    'src/webview/plot/waveformLayer.ts',
    'src/webview/runtime/canvasOverlays.ts',
    'src/webview/runtime/compareReport.ts',
    'src/webview/runtime/comparisonRuntime.ts',
    'src/webview/runtime/exportDownloads.ts',
    'src/webview/runtime/stagePanes.ts',
    'src/webview/waveform/waveformRenderer.ts',
];
// Path building and every fill/stroke; `.fill(` / `.stroke(` count only with no argument or a Path2D / fill rule, so
// Array.prototype.fill(value) does not match. Comments are stripped first, so a leftover comment neither draws nor keeps a file listed.
const canvasDrawingRegex = /\.\s*(?:lineTo|moveTo|rect|roundRect|arc|arcTo|ellipse|bezierCurveTo|quadraticCurveTo|fillRect|strokeRect|fillText|strokeText|putImageData|drawImage)\s*\(|\.\s*(?:fill|stroke)\s*\(\s*(?:\)|new\s+Path2D|['"](?:nonzero|evenodd)['"]|[\w$]*[Pp]ath\b)/u;
/** @param {string} source */
function withoutComments(source) {
    // Blank comments out (keeping newlines, so line numbers stay right); strings stay as they are.
    return source.replace(/("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu,
        (match, quoted) => quoted ?? match.replace(/[^\n]/gu, ' '));
}

/** @param {string[]} filePaths */
function collectCanvasDrawingFindings(filePaths) {
    /** @type {Array<{filePath:string,line:number,description:string,excerpt:string}>} */
    const out = [];
    const drawing = new Set();
    for (const filePath of filePaths) {
        const source = withoutComments(fs.readFileSync(filePath, 'utf8'));
        const match = canvasDrawingRegex.exec(source);
        if (!match) continue;
        const relative = path.relative(repoRoot, filePath).split(path.sep).join('/');
        drawing.add(relative);
        if (!CANVAS_DRAWING_FILES.includes(relative)) {
            out.push({
                filePath,
                line: lineNumberAt(source, match.index),
                description: 'Only the files in CANVAS_DRAWING_FILES (scripts/lint-webview-patterns.js) draw on a canvas; draw this chart through the shared plot code instead of adding a new painter.',
                excerpt: excerptAt(source, match.index),
            });
        }
    }
    for (const relative of CANVAS_DRAWING_FILES.filter(file => !drawing.has(file))) {
        out.push({
            filePath: path.join(repoRoot, relative),
            line: 1,
            description: 'This file no longer draws on a canvas: take it off CANVAS_DRAWING_FILES so the list keeps shrinking.',
            excerpt: relative,
        });
    }
    return out;
}

// A minus sign is written by plotText.ts alone (R7), so every number reads the same and none keeps a hyphen.
const MINUS_FILE = 'src/webview/plot/plotText.ts';
// Either a hyphen replaced by a minus, or a minus sign alone in a string (a sign picked by hand: `x < 0 ? '−' : ''`).
const handMadeMinusRegex = /\.replace\(\s*\/\^?-\/[gu]*\s*,\s*['"`]\u2212['"`]|(['"`])\u2212\1/u;
/** @param {string[]} filePaths */
function collectMinusFindings(filePaths) {
    /** @type {Array<{filePath:string,line:number,description:string,excerpt:string}>} */
    const out = [];
    for (const filePath of filePaths) {
        if (path.relative(repoRoot, filePath).split(path.sep).join('/') === MINUS_FILE) continue;
        const source = withoutComments(fs.readFileSync(filePath, 'utf8'));
        for (const match of source.matchAll(new RegExp(handMadeMinusRegex, 'gu'))) out.push({
            filePath,
            line: lineNumberAt(source, match.index),
            description: `Write a number's minus sign with withMinus (or another formatter) from ${MINUS_FILE}, not by hand.`,
            excerpt: excerptAt(source, match.index),
        });
    }
    return out;
}

const findings = [];

for (const filePath of listSourceFiles(webviewRoot)) {
    const source = fs.readFileSync(filePath, 'utf8');
    findings.push(...collectInlineVisibilityFindings(source, filePath));
    findings.push(...collectDialogEscapeFindings(source, filePath));
}
findings.push(...collectMinusFindings([...listSourceFiles(webviewRoot), ...listSourceFiles(path.join(repoRoot, 'src', 'shared'))]));
findings.push(...collectCanvasDrawingFindings([...listSourceFiles(webviewRoot), ...listSourceFiles(path.join(repoRoot, 'src', 'shared'))]));

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
