// The skip gate for `npm run test:ui` (scripts/test-skips.mjs says why): a Playwright reporter that collects the
// tests that did not run (test.skip, in a test or for a whole file, test.describe.skip, test.fixme), and in CI
// fails the run for each one scripts/test-skip-allowlist.json does not list for Playwright on this OS. A test is
// named `<its spec file> > <its describe blocks> > <its title>`.
import { relative, sep } from 'node:path';
import { readAllowlist, reportSkips, skipProblems } from './test-skips.mjs';

function testId(test) {
    const titles = [test.title];
    for (let suite = test.parent; suite && suite.type === 'describe'; suite = suite.parent) {
        titles.unshift(suite.title);
    }
    return [relative(process.cwd(), test.location.file).split(sep).join('/'), ...titles].join(' > ');
}

export default class PlaywrightSkipReporter {
    constructor(options = {}) {
        this.allowlist = options.allowlist;
        this.skipped = [];
    }

    onTestEnd(test, result) {
        if (result.status === 'skipped') {
            const annotation = test.annotations.find(item => ['skip', 'fixme'].includes(item.type));
            this.skipped.push({ runner: 'playwright', test: testId(test), reason: annotation?.description ?? annotation?.type ?? '' });
        }
    }

    onEnd() {
        const ci = process.env.CI === 'true';
        const problems = skipProblems(this.skipped, readAllowlist(this.allowlist), { ci, platform: process.platform, runners: ['playwright'] });
        if (reportSkips(this.skipped, problems, { ci }) !== 0) {
            return { status: 'failed' };
        }
        return undefined;
    }

    printsToStdio() {
        return false;
    }
}
