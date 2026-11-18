// (d) step i-vii smoke walk at 6 viewports: every step renders, is the visible screen, no page errors, screenshot each
import { runMatrix, dusk } from '../ptest.mjs';

export const cases = ['360x640', '390x844', '430x932', '768x1024', '1440x900', '1920x1080'].map(vp => ({ vp, virtual: true }));
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

export async function fn(t) {
  await dusk.open(t);
  const steps = [];
  for (let n = 0; n <= 6; n++) {
    await t.page.evaluate(n => { window.__dusk.S.question = 'will i get the job?'; window.__dusk.jumpTo(n); }, n);
    await t.runFor(2500);
    if (n === 6) { // vii writes the reading once it is in view (IntersectionObserver: real frames), then streams it on sleep(160) loops (virtual)
      await t.page.evaluate(() => document.querySelector('#rBody').scrollIntoView({ block: 'center' }));
      await t.frames(3); await t.runFor(8000); await t.page.evaluate(() => window.scrollTo(0, 0)); await t.frames(2);
    }
    const st = await t.page.evaluate(n => { const sc = document.querySelector('#s' + n), r = sc.getBoundingClientRect();
      return { step: window.__dusk.S.step, visible: !sc.hidden && sc.classList.contains('on') && r.width > 0 && r.height > 0, others: [...document.querySelectorAll('section.screen')].filter(s => s !== sc && !s.hidden).length,
        text: (sc.innerText || '').trim().length, hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        reading: n === 6 ? (document.querySelector('#rBody') || {}).childElementCount || 0 : null }; }, n);
    t.check(`${ROMAN[n]} is step ${n}`, st.step === n, st.step);
    t.check(`${ROMAN[n]} visible alone`, st.visible && st.others === 0, st);
    t.check(`${ROMAN[n]} has text`, st.text > 10, st.text);
    t.check(`${ROMAN[n]} no horizontal scroll`, !st.hScroll);
    if (n === 6) t.check('vii reading written', st.reading > 0, st.reading);
    await t.shot(`${n}-${ROMAN[n]}`);
    steps.push(st);
  }
  t.check('no page errors', t.errors.pageErrors.length === 0, t.errors.pageErrors);
  return steps.map(s => s.step);
}

export const bench = { key: 'd', name: 'd-smoke-walk', title: 'step i-vii smoke walk, 6 viewports', cases, fn, opts: { timeout: 120000 } };

if (import.meta.url === `file://${process.argv[1]}`) {
  const rep = await runMatrix(cases, fn, { name: bench.name, ...bench.opts });
  process.exit(rep.ok ? 0 : 1);
}
