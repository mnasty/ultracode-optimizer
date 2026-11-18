// (c) peak screenshots of all 15 moon actions at 2 viewports via freezeAt (virtual time: no waiting on the wall clock)
import path from 'node:path';
import { runMatrix, dusk, contactSheet, OUT_DIR } from '../ptest.mjs';

// the 15 lines, in the prototype's ACT_OF order (verified against window.__dusk.ACT_OF in fn)
export const MSGS = ['Aligning the stars...', 'Chatting with local spirits...', 'Hitting the blunt..', 'Examining sextant...', 'Lighting incense..', 'Consulting moon phases...',
  'Channeling cosmic energy...', 'Packing a bowl..', 'Sipping tea..', 'Tuning crystal vibrations...', 'Summoning the major arcana...', 'Checking astrological charts...',
  'Distilling wisdom..', 'Warding off evil..', 'Replenishing dried sage..'];
export const cases = ['390x844', '1440x900'].flatMap(vp => MSGS.map((msg, k) => ({ vp, dpr: 2, virtual: true, seed: 1, act: k, name: `${vp}-${String(k).padStart(2, '0')}-${msg.replace(/\W+/g, '').slice(0, 12).toLowerCase()}`, msg })));
const DWELL = 2750;

export async function fn(t) {
  await dusk.open(t);
  await dusk.energy(t);
  await t.runFor(1800);                                            // landed, rest face, no demo wobble mid-shot
  const known = await t.page.evaluate(m => m in window.__dusk.ACT_OF, t.c.msg);
  t.check('line is in ACT_OF', known, t.c.msg); if (!known) return null;
  await t.mark();                                                  // time zero for freezeAt; idle animations alive now are not reported
  const T = await t.page.evaluate(([msg, dwell]) => {
    const d = window.__dusk, rig = d.main;
    d.setCap(msg.toLowerCase()); d.playAct(rig, msg, dwell); clearTimeout(rig._leadT); // no lead-out: we hold the peak
    return d.actTiming(d.ACT_OF[msg], dwell);
  }, [t.c.msg, DWELL]);
  const at = T.in + T.peak / 2;
  // virtual time: advances the clock `at` ms past the mark (the app's timers run: eye swaps, prop classes), then pauses every
  // animation in place. That is the frame real playback shows at that moment (verify/v2-peak-equiv.mjs)
  const frozen = await t.freezeAt(at, { onlyNew: true });
  t.check('the clock moved to the peak', frozen.advancedMs === Math.round(at), frozen.advancedMs);
  t.check('the action animated something', frozen.length > 0, frozen.length);
  const face = await t.page.evaluate(() => { const rig = document.querySelector('#mainRig'); const on = k => [...rig.querySelectorAll('.fv-' + k + '.on')].map(g => g.dataset.v)[0] || null; return { act: rig.dataset.act, eyes: on('e'), mouth: on('m') }; });
  const clip = await t.page.evaluate(() => { const r = document.querySelector('#mainRig').getBoundingClientRect(), c = document.querySelector('#eCap').getBoundingClientRect();
    const top = Math.max(0, Math.min(r.top, c.top) - 8); return { x: Math.max(0, r.left - 70), y: top, width: Math.min(innerWidth - Math.max(0, r.left - 70), r.width + 140), height: r.bottom - top + 30 }; });
  const png = await t.shot(`peak-${at}ms`, { clip });
  const pr = await t.page.evaluate(k => { const p = document.querySelector(`#mainRig .pr[data-k="${k}"]`); return p ? +getComputedStyle(p).opacity : null; }, await t.page.evaluate(m => window.__dusk.ACT_OF[m], t.c.msg));
  t.check('prop fully visible at the peak', pr === null || pr > 0.95, pr);
  return { png, at, timing: T, frozen: frozen.length, propOpacity: pr, face };
}

export async function after(rep) { // one contact sheet per viewport
  const out = [];
  for (const vp of ['390x844', '1440x900']) {
    const items = rep.results.filter(r => r.ok && r.case.vp === vp).map(r => ({ path: r.value.png, label: `${r.case.msg.toLowerCase()} @${r.value.at}ms eyes ${r.value.face && r.value.face.eyes}` }));
    if (items.length) out.push(await contactSheet(items, path.join(rep.dir, `sheet-${vp}.png`), { thumb: vp === '390x844' ? 220 : 260, cols: 5, title: `action peaks ${vp} (dwell ${DWELL}ms, clock run to in + peak/2, then frozen)` }));
  }
  return out;
}

export const bench = { key: 'c', name: 'c-action-peaks', title: '15 action peaks x 2 viewports via freezeAt', cases, fn, after, opts: { timeout: 60000 } };

if (import.meta.url === `file://${process.argv[1]}`) {
  const rep = await runMatrix(cases, fn, { name: bench.name, ...bench.opts });
  console.log('sheets:', (await after(rep)).join(' '));
  process.exit(rep.ok ? 0 : 1);
}
