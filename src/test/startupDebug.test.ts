import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
    getDebugStartupBehavior,
    isEnabledEnvFlag,
} from '../shared/utils/startupDebug';

test('isEnabledEnvFlag only accepts explicit truthy flags', () => {
    assert.equal(isEnabledEnvFlag(undefined), false);
    assert.equal(isEnabledEnvFlag(''), false);
    assert.equal(isEnabledEnvFlag('0'), false);
    assert.equal(isEnabledEnvFlag('false'), false);
    assert.equal(isEnabledEnvFlag('1'), true);
    assert.equal(isEnabledEnvFlag('true'), true);
    assert.equal(isEnabledEnvFlag('TRUE'), true);
});

test('getDebugStartupBehavior keeps startup automation off by default', () => {
    assert.deepEqual(getDebugStartupBehavior({}), {
        autoOpenDebugTarget: false,
        autoSelectAllDirectoryFiles: false,
        closePanelOnStartup: false,
    });
});

test('getDebugStartupBehavior enables auto-open and directory auto-select independently', () => {
    assert.deepEqual(getDebugStartupBehavior({
        AUDIO_WANDAS_AUTO_OPEN_DEBUG: '1',
        AUDIO_WANDAS_AUTO_SELECT_ALL_DEBUG_DIR: 'true',
        AUDIO_WANDAS_CLOSE_PANEL_ON_STARTUP: 'TRUE',
    }), {
        autoOpenDebugTarget: true,
        autoSelectAllDirectoryFiles: true,
        closePanelOnStartup: true,
    });
});

test('debug directory launch profiles Python startup imports', () => {
    const launch = JSON.parse(
        readFileSync(path.resolve(process.cwd(), '.vscode/launch.json'), 'utf8'),
    ) as { configurations: Array<{ name: string; env?: Record<string, string> }> };
    const debugDirectory = launch.configurations.find(
        (configuration) => configuration.name === 'Run Extension (Open Debug Directory)',
    );

    assert.equal(debugDirectory?.env?.['AWA_PERF_LOG'], '1');
    assert.equal(debugDirectory?.env?.['AWA_IMPORT_TIME'], '1');
});
