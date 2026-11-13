import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { E2E_LOCALE, LOCALE_LAUNCH_ARGS } from '../e2e/runnerHelpers';
import { getStrings } from '../shared/i18n/strings';
import { uiNumber } from '../shared/utils/format';
import { batchPopHtml, checkListHtml } from '../webview/runtime/entryTableHtml';

const ROOT = path.join(__dirname, '..', '..');

/** Runs `body` as if the runtime's default locale were `locale`: a call that names no locale formats in it. */
function withRuntimeDefault<T>(locale: string, body: () => T): T {
    const own = Number.prototype.toLocaleString;
    Number.prototype.toLocaleString = function (this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions): string {
        return own.call(this, locales ?? locale, options);
    };
    try {
        return body();
    } finally {
        Number.prototype.toLocaleString = own;
    }
}

test('a number in a sentence of the UI is grouped as the UI\'s language does, whatever the runtime\'s default locale', () => {
    withRuntimeDefault('de-DE', () => {
        assert.equal((1234).toLocaleString(), '1.234', 'the runtime default is German here, which groups with a dot');
        assert.equal(uiNumber(1234, 'en'), '1,234');
        assert.equal(uiNumber(1234, 'ja'), (1234).toLocaleString('ja-JP'));
        // Where the UI writes counts: a filter's value counts and the batch export's choice of rows.
        assert.match(checkListHtml([['a', 1234]], new Set(), '', getStrings('en')), /<span class="entry-ck-n">1,234<\/span>/u);
        assert.match(checkListHtml([['a', 1234]], new Set(), '', getStrings('ja')), new RegExp(`<span class="entry-ck-n">${(1234).toLocaleString('ja-JP')}</span>`, 'u'));
        assert.ok(batchPopHtml({ recordings: 1234, channels: 2468 }, { recordings: 1234, channels: 2468 }, 'all', getStrings('en')).includes('1,234'));
    });
});

test('the strings carry the UI language they are in, which the numbers are formatted by', () => {
    assert.equal(getStrings('en-GB').uiLocale, 'en');
    assert.equal(getStrings('ja-JP').uiLocale, 'ja');
});

test('webview and shared code format numbers and dates only through uiNumber (src/shared/utils/format.ts), never in the runtime\'s locale', () => {
    // A bare toLocaleString() / Intl.NumberFormat() writes in the machine's or the browser's locale, not the UI's
    // language: an English UI in a German browser showed "1.234". Even a call that names a locale is a second place
    // to choose it; uiNumber takes the UI language from the strings (UiStrings.uiLocale).
    const call = /\.toLocale(?:Date|Time)?String\s*\(|\bIntl\s*\.\s*(?:NumberFormat|DateTimeFormat)\b/u;
    const helper = path.join('src', 'shared', 'utils', 'format.ts');
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const file = path.join(dir, name);
            if (statSync(file).isDirectory()) { walk(file); continue; }
            const relative = path.relative(ROOT, file);
            if (!/\.(?:ts|js|mjs)$/u.test(file) || relative === helper) continue;
            readFileSync(file, 'utf8').split('\n').forEach((line, index) => { if (call.test(line)) found.push(`${relative}:${index + 1}: ${line.trim()}`); });
        }
    };
    ['webview', 'shared'].forEach(dir => walk(path.join(ROOT, 'src', dir)));
    assert.deepEqual(found, [], 'Rule: a number or date the UI shows is formatted in the UI language through uiNumber '
        + '(src/shared/utils/format.ts) with strings.uiLocale, never by toLocaleString / Intl.NumberFormat / Intl.DateTimeFormat of its own:\n' + found.join('\n'));
});

test('the VS Code E2E pins the webview\'s locale (Chromium --lang, VS Code --locale) in every runner, as the browser layers pin theirs', () => {
    assert.equal(E2E_LOCALE, 'en-US');
    assert.deepEqual(LOCALE_LAUNCH_ARGS, ['--locale=en-US', '--lang=en-US']);
    for (const runner of ['runVscodeE2E.ts', 'runVscodeUXAudit.ts']) {
        assert.match(readFileSync(path.join(ROOT, 'src', 'e2e', runner), 'utf8'), /launchArgs: \[[^\]]*\.\.\.LOCALE_LAUNCH_ARGS,/u, runner);
    }
    // The browser layers' pin, which the E2E matches.
    assert.match(readFileSync(path.join(ROOT, 'playwright.config.ts'), 'utf8'), new RegExp(`locale: '${E2E_LOCALE}'`, 'u'));
    // The E2E reads the webview's locale back, so a VS Code that ignores the switches fails there (CI's e2e job).
    assert.match(readFileSync(path.join(ROOT, 'src', 'e2e', 'suite', 'index.ts'), 'utf8'), /renderedUi\.intlLocale, 'en-US'/u);
});
