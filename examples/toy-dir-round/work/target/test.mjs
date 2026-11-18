import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { double, add } from './src/math.mjs';
test('double', () => assert.equal(double(2), 4));
test('add', () => { assert.equal(add(2, 3), 5); assert.equal(add(-1, 1), 0); });
test('README lists add', () => assert.match(readFileSync(new URL('./README.md', import.meta.url), 'utf8'), /^- features: .*add\(a, b\)/m));
