import assert from 'node:assert/strict';
import test from 'node:test';
import { StderrLineSplitter } from '../extension/backendIpc';

test('StderrLineSplitter keeps a lone carriage return inside the line', () => {
    const lines = new StderrLineSplitter();
    assert.deepEqual(lines.push('progress 10%\rprogress 90%\r[perf] phase=x ms=1\n'), ['progress 10%\rprogress 90%\r[perf] phase=x ms=1']);
});

test('StderrLineSplitter joins chunks, strips CRLF and returns the unterminated tail on flush', () => {
    const lines = new StderrLineSplitter();
    assert.deepEqual(lines.push('[perf] pha'), []);
    assert.deepEqual(lines.push('se=a ms=1\r\nTraceback'), ['[perf] phase=a ms=1']);
    assert.equal(lines.flush(), 'Traceback');
    assert.equal(lines.flush(), null);
});
