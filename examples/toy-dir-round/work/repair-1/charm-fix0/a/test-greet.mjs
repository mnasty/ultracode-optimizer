import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { join, dirname } from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const root = process.env.APP_DIR || dirname(fileURLToPath(import.meta.url));
const { greet } = await import(pathToFileURL(join(root, 'src/greet.mjs')).href);
test('greet', () => assert.equal(greet('mick'), 'hello, mick'));
test('dot.png is a 1x1 png', () => {
  const b = readFileSync(join(root, 'assets/dot.png'));
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(b.readUInt32BE(16), 1); assert.equal(b.readUInt32BE(20), 1);
});
test('README lists greet', () => assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /^- greet\(name\)$/m));
