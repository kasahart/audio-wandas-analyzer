import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPythonButtonText, buildPythonTooltip, isPythonEnvError } from '../webview/runtime/pythonEnvironmentLabels';

test('buildPythonButtonText: shows only the executable name for POSIX and Windows paths', () => {
    assert.equal(buildPythonButtonText('/opt/venv/bin/python3', false), 'Python: python3');
    assert.equal(buildPythonButtonText('C:\\Python\\python.exe', true), 'Python: python.exe ⚠');
    assert.equal(buildPythonButtonText('/opt/venv/bin/', false), 'Python: /opt/venv/bin/');
    assert.equal(buildPythonButtonText('', false), 'Python: python3');
});

test('buildPythonTooltip: joins the full command and the description', () => {
    assert.equal(buildPythonTooltip('/opt/venv/bin/python3', 'wandas missing'), '/opt/venv/bin/python3 — wandas missing');
    assert.equal(buildPythonTooltip('', ''), 'python3');
});

test('isPythonEnvError: matches process-start and import failures only', () => {
    assert.equal(isPythonEnvError('spawn python3 ENOENT'), true);
    assert.equal(isPythonEnvError("ModuleNotFoundError: No module named 'wandas'"), true);
    assert.equal(isPythonEnvError('Unsupported sample format'), false);
    assert.equal(isPythonEnvError(''), false);
});
