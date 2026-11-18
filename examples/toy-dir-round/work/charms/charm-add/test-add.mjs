import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs'; import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
const APP = process.env.APP_DIR; if (!APP) throw new Error('APP_DIR not set');
test('add exported from src/math.mjs', async () => {
  const m = await import(pathToFileURL(join(APP, 'src/math.mjs')).href);
  assert.equal(m.add(2, 3), 5); assert.equal(m.add(0.5, 0.25), 0.75); assert.equal(m.double(2), 4);
});
test('README lists add(a, b)', () => assert.match(readFileSync(join(APP, 'README.md'), 'utf8'), /^- add\(a, b\)$/m));
test('test.mjs tests add', () => assert.match(readFileSync(join(APP, 'test.mjs'), 'utf8'), /test\('add'/));
