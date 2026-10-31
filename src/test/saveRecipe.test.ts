import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { ExportFlows, ExportHost } from '../extension/exportFlows';
import type { BuildRecipePayload } from '../shared/protocol/backendProtocol';
import { parsePanelMessage } from '../shared/protocol/panelMessages';
import { ComparisonSessionController, type ComparisonSessionPorts, type ReportArtifactFile } from '../shared/session/comparisonSessionController';

const pairMessage = {
    type: 'save-recipe', filePath: '/a.wav', referenceChannel: 1,
    responses: [{ filePath: '/a.wav', channelIndex: 0 }, { filePath: '/b.wav', channelIndex: 0 }],
};

test('save-recipe messages carry only what build-recipe takes, without STFT settings', () => {
    assert.deepEqual(parsePanelMessage(pairMessage), pairMessage);
    assert.deepEqual(parsePanelMessage({ type: 'save-recipe', filePath: '/a.wav', bandsPerOctave: 3 }), { type: 'save-recipe', filePath: '/a.wav', bandsPerOctave: 3 });
    assert.equal(parsePanelMessage({ type: 'save-recipe' }), undefined);
    assert.equal(parsePanelMessage({ type: 'save-recipe', filePath: '/a.wav', bandsPerOctave: 2 }), undefined);
    assert.equal(parsePanelMessage({ ...pairMessage, referenceChannel: -1 }), undefined);
    assert.equal(parsePanelMessage({ ...pairMessage, stftOptions: { nFft: 1024, overlapPercent: 75, window: 'hann' } }), undefined);
});

test('the session controller builds the Recipe with the panel STFT settings, only for displayed files, and hands the host a .recipe.json', async () => {
    const payloads: BuildRecipePayload[] = [];
    const saved: ReportArtifactFile[] = [];
    const recipe = { schema: 'wandas.recipe', version: 2, inputs: [], nodes: [], output: 'input-0' };
    const stft = { nFft: 1024, overlapPercent: 75, window: 'hann' as const };
    let options: typeof stft | undefined = stft;
    const ports = {
        scope: () => ({ isCurrent: () => true, canPublish: () => true }),
        stftOptions: () => options,
        lazyContext: (filePath: string) => filePath === '/gone.wav' ? undefined : { analysisRevision: 0 },
        client: { buildRecipe: async (payload: BuildRecipePayload) => { payloads.push(payload); return { name: 'transfer-function', recipe }; } },
        saveRecipe: async (file: ReportArtifactFile) => { saved.push(file); },
        showError: (message: string) => { throw new Error(message); },
    } as unknown as ComparisonSessionPorts;
    const controller = new ComparisonSessionController(ports);

    await controller.dispatch(pairMessage);
    options = undefined;
    await controller.dispatch({ type: 'save-recipe', filePath: '/a.wav' });
    await controller.dispatch({ ...pairMessage, responses: [{ filePath: '/gone.wav', channelIndex: 0 }] });
    await controller.dispatch({ type: 'save-recipe', filePath: '/gone.wav' });

    const { type: _type, ...analysis } = pairMessage;
    assert.deepEqual(payloads, [{ ...analysis, stftOptions: stft }, { filePath: '/a.wav' }], 'files the host no longer displays are never sent');
    assert.equal(saved[0].name, 'transfer-function.recipe.json');
    assert.equal(saved[0].type, 'application/json');
    assert.deepEqual(JSON.parse(saved[0].content), recipe);
});

test('desktop recipe saving writes the chosen destination and says where', async () => {
    const exports: { ExportFlows?: typeof ExportFlows } = {};
    runInNewContext(readFileSync(join(__dirname, '../extension/exportFlows.js'), 'utf8'), {
        exports, Buffer,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require: (name: string) => name === 'vscode' ? {} : name === 'path' ? require('node:path') : require('../shared/i18n/strings'),
    });
    const writes: Array<[string, string]> = [];
    const notices: string[] = [];
    const asked: string[] = [];
    let destination: { fsPath: string } | undefined = undefined;
    const host = {
        pickRecipeDestination: async (name: string) => { asked.push(name); return destination; },
        writeFile: async (uri: { fsPath: string }, content: Uint8Array) => { writes.push([uri.fsPath, Buffer.from(content).toString('utf-8')]); },
        showInformation: (message: string) => { notices.push(message); },
        language: () => 'ja',
    } as unknown as ExportHost;
    const flows = new exports.ExportFlows!({ exportWavLoop: async () => { throw new Error('unused'); } }, host);
    const file = { name: 'spectrum.recipe.json', content: '{}\n', type: 'application/json' };

    await flows.saveRecipe(file);
    destination = { fsPath: '/work/mine.recipe.json' };
    await flows.saveRecipe(file);

    assert.deepEqual(asked, ['spectrum.recipe.json', 'spectrum.recipe.json']);
    assert.deepEqual(writes, [['/work/mine.recipe.json', '{}\n']]);
    assert.deepEqual(notices, ['レシピを保存しました → /work/mine.recipe.json']);
});
