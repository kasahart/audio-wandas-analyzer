import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNodeTestNamePattern, parseTapTestResults } from '../testing/tapParser';

test('parseTapTestResults keeps nested suite and test paths', () => {
  const results = parseTapTestResults(`TAP version 13
# Subtest: math
    # Subtest: adds
    ok 1 - adds
      ---
      duration_ms: 0.29
      type: 'test'
      ...
    # Subtest: nested
        # Subtest: multiplies
        not ok 1 - multiplies
          ---
          duration_ms: 0.09
          type: 'test'
          error: 'boom'
          ...
        1..1
    ok 2 - nested
      ---
      duration_ms: 0.15
      type: 'suite'
      ...
    1..2
ok 1 - math
  ---
  duration_ms: 0.89
  type: 'suite'
  ...`);

  const testResults = results.filter((entry) => entry.kind === 'test');
  assert.deepEqual(
    testResults.map((entry) => entry.fullName),
    ['math > adds', 'math > nested > multiplies'],
  );
  assert.equal(testResults[1]?.status, 'failed');
  assert.match(testResults[1]?.diagnostics ?? '', /error: 'boom'/);
});

test('buildNodeTestNamePattern escapes titles and distinguishes suite from test', () => {
  assert.equal(buildNodeTestNamePattern(['math', 'adds?'], 'test'), '^math.*adds\\?$');
  assert.equal(buildNodeTestNamePattern(['math', 'nested'], 'suite'), '^math.*nested(?:$|.*)$');
});