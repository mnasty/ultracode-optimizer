// V11: the visitor's hour on step i under real vs virtual time (default and explicit virtual.time), and after 61s
import { runMatrix, dusk } from '../ptest.mjs';
const rep = await runMatrix([{ name: 'real', virtual: false }, { name: 'virtual-default', virtual: true }, { name: 'virtual-0810', virtual: { time: '2026-10-27T08:10:00' } }, { name: 'virtual-1840', virtual: { time: '2026-10-27T18:40:00' } }], async t => {
  await dusk.open(t);
  const read = () => t.page.evaluate(() => ({ hour: document.querySelector('.js-hour')?.textContent, tod: [...document.querySelector('#sky').classList].filter(c => c.startsWith('tod')).join(' '), sun: document.querySelector('.js-sun')?.textContent }));
  const a = await read();
  if (t.page.__ptestVirtual) await t.runFor(61000); else await t.page.waitForTimeout(500);
  return { a, b: await read(), nodeNow: new Date().toTimeString().slice(0, 5) };
}, { name: 'v11-sky', quiet: true });
for (const r of rep.results) console.log(r.id, r.ok ? JSON.stringify(r.value) : r.error);
process.exit(0);
