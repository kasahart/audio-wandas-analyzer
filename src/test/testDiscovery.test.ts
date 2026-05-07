import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNodeTestDefinitions } from '../testing/testDiscovery';

test('parseNodeTestDefinitions discovers suites and tests with hierarchical names', () => {
    const definitions = parseNodeTestDefinitions(`
        describe('audioTarget', () => {
            test('accepts wav', () => {});
            describe('messages', () => {
                it('rejects invalid payload', () => {});
            });
        });
    `);

    assert.equal(definitions.length, 1);
    assert.equal(definitions[0]?.kind, 'suite');
    assert.equal(definitions[0]?.fullName, 'audioTarget');
    assert.equal(definitions[0]?.children[0]?.kind, 'test');
    assert.equal(definitions[0]?.children[0]?.fullName, 'audioTarget > accepts wav');
    assert.equal(definitions[0]?.children[1]?.kind, 'suite');
    assert.equal(definitions[0]?.children[1]?.children[0]?.fullName, 'audioTarget > messages > rejects invalid payload');
});

test('parseNodeTestDefinitions ignores dynamic titles', () => {
    const definitions = parseNodeTestDefinitions(`
        const dynamicTitle = 'case';
        test(dynamicTitle, () => {});
        test('static case', () => {});
    `);

    assert.equal(definitions.length, 1);
    assert.equal(definitions[0]?.fullName, 'static case');
});