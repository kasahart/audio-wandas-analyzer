import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogOperation, isCharted, outputOf, takes, WANDAS_OPERATIONS } from '../shared/recipe/recipeCatalog';

test('the catalog is wandas\' registry: what each operation takes and gives', () => {
    const welch = catalogOperation('wandas.audio.welch')!;
    assert.equal(outputOf(welch, 'ChannelFrame'), 'SpectralFrame');
    // welch takes a time signal, not a spectrum.
    assert.equal(outputOf(welch, 'SpectralFrame'), undefined);
    assert.equal(outputOf(catalogOperation('wandas.audio.stft')!, 'ChannelFrame'), 'SpectrogramFrame');
    // An operation of every Frame gives the Frame it took.
    assert.equal(outputOf(catalogOperation('wandas.frame.get_channel')!, 'NOctFrame'), 'NOctFrame');
    assert.ok(WANDAS_OPERATIONS.length > 40);
});

test('a Frame is taken by the operations of the Frames it derives from', () => {
    assert.ok(takes('PairwiseSpectralFrame', 'CoherenceFrame'));
    assert.ok(!takes('SpectralFrame', 'CoherenceFrame'));
    assert.ok(isCharted('SpectrogramFrame'));
    assert.ok(isCharted('CepstralFrame'));
    assert.ok(isCharted('CepstrogramFrame'));
});
