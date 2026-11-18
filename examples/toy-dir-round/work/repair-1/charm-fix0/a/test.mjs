import { test } from 'node:test'; import assert from 'node:assert/strict';
import { double, add } from './src/math.mjs';
test('double', () => assert.equal(double(2), 4));
test('add', () => { assert.equal(add(2, 3), 5); assert.equal(add(-1, 1), 0); });
