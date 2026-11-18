// V12: an app error thrown inside a timer / rAF callback: real vs virtual, with failOnPageError:false
import { runMatrix, dusk } from '../ptest.mjs';
const rep = await runMatrix(['timer', 'raf', 'handler'].flatMap(k => [false, true].map(v => ({ name: `${k}-${v ? 'virtual' : 'real'}`, k, virtual: v }))), async t => {
  await dusk.open(t);
  await t.page.evaluate(k => { if (k === 'timer') setTimeout(() => { throw new Error('app timer error'); }, 100); else if (k === 'raf') requestAnimationFrame(() => { throw new Error('app raf error'); }); else { document.body.addEventListener('click', () => { throw new Error('app handler error'); }); } }, t.c.k);
  if (t.c.k === 'handler') await t.page.mouse.click(5, 5);
  let after = 'reached';
  try { await t.runFor(300); } catch (e) { after = 'runFor threw: ' + e.message.split('\n')[0]; }
  if (!t.page.__ptestVirtual) await t.page.waitForTimeout(100);
  return { after, pageErrors: t.errors.pageErrors.length };
}, { name: 'v12-timer-errors', quiet: true, failOnPageError: false });
for (const r of rep.results) console.log(r.id.padEnd(18), r.ok ? 'ok ' : 'FAIL', JSON.stringify(r.value), r.error || '');
process.exit(0);
