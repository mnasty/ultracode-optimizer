// V7: is virtual time deterministic? performance.now()/Date.now() right after goto, and after runFor(1000), across 12 parallel cases
import { runMatrix, DUSK_URL } from '../ptest.mjs';
import { pathToFileURL } from 'node:url';
const blank = pathToFileURL(new URL('./fixtures/clockprobe.html', import.meta.url).pathname).href;
const rep = await runMatrix(Array.from({ length: 12 }, (_, i) => ({ name: 'c' + i, virtual: true, url: i % 2 ? DUSK_URL : blank })), async t => {
  await t.page.goto(t.c.url);
  const a = await t.page.evaluate(() => [performance.now(), Date.now() % 100000, performance.timeOrigin % 100000]);
  await t.runFor(1000);
  const b = await t.page.evaluate(() => [performance.now(), Date.now() % 100000]);
  return { a, b };
}, { name: 'v7', quiet: true });
for (const r of rep.results) console.log(r.id, r.c?.url, JSON.stringify(r.value));
process.exit(0);
