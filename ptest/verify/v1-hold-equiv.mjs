// V1: a full 30s hold, REAL time vs VIRTUAL time, same viewport (390x844), same seeded Math.random (so the bag order and dwell
// jitter are identical). Compares message sequence, dwells, action phases, progress curve (#ePct), the rAF-painted --p curve,
// seed regeneration count, final hex length, done/cut times, completion state.
import fs from 'node:fs';
import { runMatrix, dusk } from '../ptest.mjs';

const SEED = `(() => { let s = 0x9e3779b9; Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const g = crypto.getRandomValues.bind(crypto); window.__seedCalls = 0; crypto.getRandomValues = a => { if (a && a.length >= 48) window.__seedCalls++; return g(a); }; })();`;
const OBSERVE = () => {
  const L = window.__L = { msgs: [], phases: [], pct: [], vis: [], emo: [], pressAt: null, doneAt: null, go3: null };
  const rig = document.querySelector('#mainRig'), stage = document.querySelector('#stage');
  document.addEventListener('pointerdown', () => { if (L.pressAt == null) L.pressAt = performance.now(); }, true);
  new MutationObserver(() => { const t = document.querySelector('#eCapT').textContent, on = document.querySelector('#eCap').classList.contains('on');
    if (on && t && (!L.msgs.length || L.msgs[L.msgs.length - 1].m !== t)) L.msgs.push({ m: t, t: performance.now(), act: rig.dataset.act, emo: rig.dataset.emo }); })
    .observe(document.querySelector('#eCapT'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => L.phases.push({ ph: rig.dataset.aphase || '-', act: rig.dataset.act || '-', t: performance.now() })).observe(rig, { attributes: true, attributeFilter: ['data-aphase', 'data-act'] });
  new MutationObserver(() => L.emo.push({ e: rig.dataset.emo, t: performance.now() })).observe(rig, { attributes: true, attributeFilter: ['data-emo'] });
  new MutationObserver(() => L.pct.push({ p: +document.querySelector('#ePct').textContent, t: performance.now() })).observe(document.querySelector('#ePct'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(() => { if (!L.doneAt && stage.classList.contains('done')) L.doneAt = performance.now(); }).observe(stage, { attributes: true });
  const iv = setInterval(() => { L.vis.push({ v: +getComputedStyle(stage).getPropertyValue('--p'), t: performance.now() }); if (window.__dusk.S.step === 3 && !L.go3) { L.go3 = performance.now(); clearInterval(iv); } }, 50);
};

async function hold(t) {
  await t.page.addInitScript(SEED);
  await dusk.open(t);
  await dusk.energy(t, { question: 'will i get the job?' });
  await t.runFor(400);
  await t.page.evaluate(OBSERVE);
  await dusk.press(t);
  await t.runUntil(() => window.__L.doneAt, { step: 100, max: 45000 }); await t.runFor(400);
  await dusk.release(t);
  await t.runUntil(() => window.__L.go3, { step: 100, max: 10000 });
  return t.page.evaluate(() => { const d = window.__dusk, st = document.querySelector('#stage');
    return { ...window.__L, seedCalls: window.__seedCalls, seedLen: d.S.seed.length, deck: d.S.deck.length, step: d.S.step, firstCard: d.S.deck[0] && (d.S.deck[0].name || d.S.deck[0].id), emoNow: document.querySelector('#mainRig').dataset.emo }; });
}
const fn = t => t.c.virtual === false ? t.realTime('v1-hold-equiv', () => hold(t), { claim: 'real 30s hold matches the virtual one (seeded)' }) : hold(t);
const cases = [{ name: 'real', vp: '390x844', virtual: false }, { name: 'virt-a', vp: '390x844', virtual: true }, { name: 'virt-b', vp: '390x844', virtual: true }];
const rep = await runMatrix(cases, fn, { name: 'v1-hold-equiv', timeout: 240000 });
const R = Object.fromEntries(rep.results.map(r => [r.id, r.value]));
fs.writeFileSync(new URL('./v1-hold-equiv.json', import.meta.url), JSON.stringify({ rep: rep.results.map(r => ({ id: r.id, ok: r.ok, error: r.error, ms: r.ms })), R }, null, 1));
const sum = L => {
  const p0 = L.pressAt, rel = x => x == null ? null : +((x - p0)).toFixed(1);
  const msgs = L.msgs.map(m => ({ m: m.m, t: rel(m.t), act: m.act, emo: m.emo }));
  const dw = msgs.slice(1).map((m, i) => +(m.t - msgs[i].t).toFixed(1));
  // per line: time from line start to its 'out' phase
  const outs = msgs.map((m, i) => { const nx = msgs[i + 1] ? msgs[i + 1].t : Infinity; const o = L.phases.find(p => p.ph === 'out' && rel(p.t) >= m.t && rel(p.t) < nx); return o ? +(rel(o.t) - m.t).toFixed(1) : null; });
  const pctAt = {}; for (const q of L.pct) if (!(q.p in pctAt)) pctAt[q.p] = rel(q.t);
  return { lines: msgs.length, msgs, dw, outs, pctAt, vis: L.vis.map(v => [rel(v.t), v.v]), doneAt: rel(L.doneAt), go3: rel(L.go3), seedCalls: L.seedCalls, seedLen: L.seedLen, deck: L.deck, step: L.step, firstCard: L.firstCard, emoSeq: L.emo.filter(e => e.t >= p0).map(e => e.e) };
};
const S = Object.fromEntries(Object.entries(R).filter(([, v]) => v).map(([k, v]) => [k, sum(v)]));
for (const [k, s] of Object.entries(S)) {
  console.log(`\n== ${k}: ${s.lines} lines, done ${s.doneAt}ms, cut ${s.go3}ms, seedLen ${s.seedLen}, deck ${s.deck}, step ${s.step}, seedCalls ${s.seedCalls}, firstCard ${s.firstCard}`);
  console.log('  msgs  ' + s.msgs.map(m => `${m.t}:${m.act}/${m.emo}`).join(' '));
  console.log('  dwell ' + s.dw.join(' '));
  console.log('  out@  ' + s.outs.join(' '));
  console.log('  emo   ' + s.emoSeq.join(' '));
}
const a = S.real, b = S['virt-a'], c = S['virt-b'];
if (a && b) {
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  console.log('\n== real vs virtual');
  console.log('  same text sequence:', same(a.msgs.map(m => m.m), b.msgs.map(m => m.m)), '| same acts:', same(a.msgs.map(m => m.act), b.msgs.map(m => m.act)), '| same emos:', same(a.msgs.map(m => m.emo), b.msgs.map(m => m.emo)));
  console.log('  line start diffs (real - virt ms):', a.msgs.map((m, i) => b.msgs[i] ? +(m.t - b.msgs[i].t).toFixed(0) : 'x').join(' '));
  console.log('  out-phase diffs:', a.outs.map((o, i) => o != null && b.outs[i] != null ? +(o - b.outs[i]).toFixed(0) : 'x').join(' '));
  const pd = Object.keys(b.pctAt).map(p => [p, a.pctAt[p] != null ? a.pctAt[p] - b.pctAt[p] : null]).filter(x => x[1] != null);
  const absd = pd.map(x => Math.abs(x[1]));
  console.log(`  progress curve: ${pd.length} percents, real-virt diff mean ${(pd.reduce((s, x) => s + x[1], 0) / pd.length).toFixed(1)}ms, max |diff| ${Math.max(...absd).toFixed(1)}ms; pct 50 real ${a.pctAt[50]} virt ${b.pctAt[50]}`);
  const interp = (arr, t) => { for (let i = 1; i < arr.length; i++) if (arr[i][0] >= t) { const [t0, v0] = arr[i - 1], [t1, v1] = arr[i]; return v0 + (v1 - v0) * (t - t0) / ((t1 - t0) || 1); } return arr[arr.length - 1][1]; };
  const vd = [5000, 10000, 15000, 20000, 25000, 29000].map(tt => [tt, +interp(a.vis, tt).toFixed(4), +interp(b.vis, tt).toFixed(4)]);
  console.log('  --p (rAF lerp) at t: ' + vd.map(([tt, x, y]) => `${tt}:${x}/${y}`).join(' '));
  console.log(`  done ${a.doneAt} vs ${b.doneAt}; cut ${a.go3} vs ${b.go3}; seedLen ${a.seedLen}/${b.seedLen}; seedCalls ${a.seedCalls}/${b.seedCalls}; deck ${a.deck}/${b.deck}; final emo seq same: ${same(a.emoSeq, b.emoSeq)}`);
}
if (b && c) console.log('  virt-a vs virt-b identical (msgs, outs, pctAt):', JSON.stringify([b.msgs, b.outs, b.pctAt]) === JSON.stringify([c.msgs, c.outs, c.pctAt]));
process.exit(0);
