// (b) one full 30s hold with the message log, 4 viewports, virtual time (+ one real-time proof: REALTIME=1)
import { runMatrix, dusk } from '../ptest.mjs';

export const cases = ['360x640', '390x844', '768x1024', '1440x900'].map(vp => ({ vp, virtual: true }));

// the observers the serial b1-energy-hold.mjs installed, unchanged: they read performance.now(), which is virtual here
const OBSERVE = () => {
  const L = window.__log = { msgs: [], phases: [], doneAt: null, go3: null };
  const rig = document.querySelector('#mainRig');
  new MutationObserver(() => { const t = document.querySelector('#eCapT').textContent, on = document.querySelector('#eCap').classList.contains('on');
    if (on && t && (!L.msgs.length || L.msgs[L.msgs.length - 1].m !== t)) L.msgs.push({ m: t, t: performance.now(), act: rig.dataset.act, emo: rig.dataset.emo }); })
    .observe(document.querySelector('#eCapT'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => L.phases.push({ ph: rig.dataset.aphase || '-', t: performance.now() })).observe(rig, { attributes: true, attributeFilter: ['data-aphase'] });
  new MutationObserver(() => { if (!L.doneAt && document.querySelector('#stage').classList.contains('done')) L.doneAt = performance.now(); }).observe(document.querySelector('#stage'), { attributes: true });
  const iv = setInterval(() => { if (window.__dusk.S.step === 3 && !L.go3) { L.go3 = performance.now(); clearInterval(iv); } }, 20);
};

export async function hold(t) {
  const virtual = !!t.page.__ptestVirtual;
  await dusk.open(t);
  await dusk.energy(t, { question: 'will i get the job?' });
  await t.runFor(400);
  await t.page.evaluate(OBSERVE);
  const t0 = await t.page.evaluate(() => performance.now());
  await dusk.press(t);
  await t.runUntil(() => window.__log.doneAt, { step: 100, max: 40000 }); await t.runFor(400);   // virtual: fake clock; real-time case: wall clock
  await dusk.release(t);
  await t.runUntil(() => window.__log.go3, { step: 100, max: 8000 });
  const L = await t.page.evaluate(() => ({ ...window.__log, deck: window.__dusk.S.deck.length, step: window.__dusk.S.step }));
  const M = L.msgs, dw = M.slice(0, -1).map((m, i) => M[i + 1].t - m.t);
  const s = x => +((x - t0) / 1000).toFixed(3);
  const r = { lines: M.length, distinct: new Set(M.map(m => m.m)).size, immediateRepeats: M.filter((m, i) => i && m.m === M[i - 1].m).length,
    dwellMin: Math.round(Math.min(...dw)), dwellMax: Math.round(Math.max(...dw)), doneAt: s(L.doneAt), cutAt: s(L.go3), deck: L.deck, step: L.step,
    log: M.map((m, i) => `${String(i + 1).padStart(2)} t=${s(m.t).toFixed(3)}s ${m.act}/${m.emo} "${m.m}"`) };
  t.check('9-11 lines', r.lines >= 9 && r.lines <= 11, r.lines);
  t.check('dwell 2750-3250ms', r.dwellMin >= 2750 - (virtual ? 0 : 30) && r.dwellMax <= 3250 + (virtual ? 0 : 60), [r.dwellMin, r.dwellMax]);
  t.check('no immediate repeats', r.immediateRepeats === 0);
  t.check('done at 30.0-30.3s', r.doneAt >= 30.0 && r.doneAt <= 30.3 + (virtual ? 0 : 0.3), r.doneAt);
  t.check('cut reached with 78 cards', r.step === 3 && r.deck === 78, [r.step, r.deck]);
  return r;
}
export const fn = t => t.c.virtual === false ? t.realTime('30s-hold', () => hold(t), { claim: 'a continuous hold fills in 30.0-30.6s real; dwells 2750-3250ms' }) : hold(t);

export const bench = { key: 'b', name: 'b-hold-log', title: '30s hold + message log, 4 viewports', cases, fn, opts: { timeout: 120000 } };

if (import.meta.url === `file://${process.argv[1]}`) {
  const cs = process.env.REALTIME ? [{ vp: '390x844', virtual: false }] : cases;
  const rep = await runMatrix(cs, fn, { name: bench.name + (process.env.REALTIME ? '-realtime' : ''), ...bench.opts });
  for (const r of rep.results) if (r.value) { console.log(`${r.id}: ${r.value.lines} lines, dwell ${r.value.dwellMin}-${r.value.dwellMax}ms, done ${r.value.doneAt}s, cut ${r.value.cutAt}s`); console.log('  ' + r.value.log.join('\n  ')); }
  process.exit(rep.ok ? 0 : 1);
}
