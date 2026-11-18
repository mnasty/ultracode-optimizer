// V3: what virtual time does and does not drive. Sample at trigger+500ms (half-way through 1000ms linear fades) in real and virtual,
// then advance 61s and check the Date-based minute tick.
import { runMatrix } from '../ptest.mjs';
import { pathToFileURL } from 'node:url';
const URL_ = pathToFileURL(new URL('./fixtures/clockprobe.html', import.meta.url).pathname).href;
const rep = await runMatrix([{ name: 'real', virtual: false }, { name: 'virtual', virtual: true }, { name: 'virtual-sync16', virtual: { syncEvery: 16 } }], async t => {
  await t.page.goto(URL_);
  await t.runFor(500);                                         // the trigger timer fires
  await t.runFor(500);                                         // half way
  const half = await t.page.evaluate(() => window.sample());
  if (t.page.__ptestVirtual) { await t.runFor(61000); } else await t.page.waitForTimeout(100);
  const later = await t.page.evaluate(() => window.sample());
  return { half, later };
}, { name: 'v3-clock-coverage', timeout: 90000 });
for (const r of rep.results) console.log(r.id, r.ok ? JSON.stringify(r.value) : r.error);
process.exit(0);
