// T3 targeted test: FILE=<built html> node t3-test.mjs
// Cases: the built file (3 li -> "3 items"), and a variant with a 4th li injected into a copy (-> "4 items", proves derivation).
import { runMatrix } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const FILE = process.env.FILE; if (!FILE) { console.error('set FILE'); process.exit(2); }
const src = readFileSync(FILE, 'utf8');
const VAR = new URL('./out/t3-variant.html', import.meta.url).pathname;
import { mkdirSync } from 'node:fs'; mkdirSync(new URL('./out', import.meta.url).pathname, { recursive: true });
writeFileSync(VAR, src.replace('<li>three</li>', '<li>three</li><li>four</li>'));
const cases = [ { vp: '360x640', variant: 'built', file: FILE, want: '3 items' }, { vp: '360x640', variant: 'four', file: VAR, want: '4 items' } ]
  .map(c => ({ ...c, virtual: true }));
const rep = await runMatrix(cases, async t => {
  await t.page.goto('file://' + t.c.file); await t.runFor(200);
  const before = await t.page.$eval('#count', e => e.textContent);
  t.check('count on load', before === t.c.want, before);
  await t.page.click('#go'); const after = await t.page.$eval('#count', e => e.textContent);
  t.check('start writes started', after === 'started', after);
  return { before, after };
}, { name: 't3', dir: new URL('./out/t3', import.meta.url).pathname, failOnConsoleError: true, quiet: true });
console.log(rep.results.map(r => (r.ok ? 'ok ' : 'FAIL ') + r.id + ' ' + JSON.stringify(r.value) + ' ' + (r.checks || []).filter(k => !k.ok).map(k => k.name + ':' + k.detail).join(', ')).join('\n'));
console.log('hardcoded "3 items" in source:', /3 items/.test(src));
process.exit(rep.ok && !/3 items/.test(src) ? 0 : 1);
