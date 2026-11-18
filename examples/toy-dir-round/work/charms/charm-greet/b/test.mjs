import { test } from 'node:test'; import assert from 'node:assert/strict';
import { double } from './src/math.mjs';
test('double', () => assert.equal(double(2), 4));
