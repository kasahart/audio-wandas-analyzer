// A node:test reporter that writes the skipped (and todo) tests as JSON, [{ test, reason }], for the skip gate
// (scripts/test-skips.mjs). A test is named `<its source file> > <its name>`, the source file being the
// src/test/*.ts a dist/test/*.js was compiled from.
import { relative, sep } from 'node:path';

function source(file) {
    const path = relative(process.cwd(), file ?? '').split(sep).join('/');
    return path.replace(/^dist\/(.*)\.js$/u, 'src/$1.ts');
}

export default async function* testSkipReporter(events) {
    const skipped = [];
    for await (const event of events) {
        if (event.type !== 'test:pass' && event.type !== 'test:fail') {
            continue;
        }
        const { skip, todo, name, file } = event.data;
        const why = skip ?? todo;
        if (why !== undefined && why !== false) {
            skipped.push({ test: `${source(file)} > ${name}`, reason: typeof why === 'string' ? why : '' });
        }
    }
    yield `${JSON.stringify(skipped, null, 1)}\n`;
}
