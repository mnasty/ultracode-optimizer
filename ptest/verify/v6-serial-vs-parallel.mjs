// V6: the energy bbox audit (example a's flow, Math.random seeded so the first line/action is the same in every run), run
// serial (concurrency 1, 1 browser) and parallel (default) twice: findings must be identical per case.
import fs from 'node:fs';
import { runMatrix, cross, dusk, VIEWPORTS_11 } from '../ptest.mjs';
const SEED = `(() => { let s = 0x2545F491; Math.random = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })();`;
const cases = cross({ vp: VIEWPORTS_11 }, { state: ['idle', 'hold', 'done'] }).map(c => ({ ...c, virtual: true }));
async function fn(t) {
  await t.page.addInitScript(SEED);
  await dusk.open(t, { query: '?tod=night' }); await dusk.energy(t); await t.runFor(1200);
  let act = null;
  if (t.c.state !== 'idle') {
    await dusk.press(t);
    if (t.c.state === 'hold') { await t.runFor(50); const T = await t.page.evaluate(() => { const d = window.__dusk, act = d.main.el.dataset.act; return { act, ...d.actTiming(act, 3000) }; }); act = T.act; await t.runFor(T.in + T.peak / 2 - 50); }
    else { await t.runUntil(() => document.querySelector('#stage').classList.contains('done'), { step: 100, max: 40000 }); await t.runFor(800); }
  }
  const a = await t.audit({ root: '#s2', pairsSkip: [['#eCap', '#eCap .cap-plate']], listItems: true, ...(process.env.STRICT ? { minTarget: 64, minFont: 16, minGap: 24, textGap: 16, iconPairs: true } : {}) });
  const st = await t.page.evaluate(() => ({ step: window.__dusk.S.step, p: window.__dusk.progress, vnow: Math.round(performance.now()) }));
  return { act, st, counts: a.counts, findings: a.findings.map(f => [f.type, f.a, f.b, f.detail, JSON.stringify(f.box)].join(' | ')), items: a.itemList.map(i => `${i.kind}:${i.label}:${JSON.stringify(i.box)}`) };
}
const mode = process.argv[2] || 'all';
const runs = {};
if (mode === 'all' || mode === 'serial') runs.serial = await runMatrix(cases, fn, { name: 'v6-serial', concurrency: 1, browsers: 1, progress: false, timeout: 120000 });
runs.par1 = await runMatrix(cases, fn, { name: 'v6-par1', progress: false, timeout: 120000 });
runs.par2 = await runMatrix(cases, fn, { name: 'v6-par2', progress: false, timeout: 120000 });
fs.writeFileSync(new URL(process.env.STRICT ? './v6-strict.json' : './v6.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.results.map(x => ({ id: x.id, ok: x.ok, error: x.error, value: x.value }))])), null, 1));
const base = runs.serial ? 'serial' : 'par1';
for (const k of Object.keys(runs)) if (k !== base) {
  let same = 0, diff = [];
  runs[base].results.forEach((r, i) => { const q = runs[k].results[i]; const A = JSON.stringify(r.value && [r.value.act, r.value.st, r.value.findings]), B = JSON.stringify(q.value && [q.value.act, q.value.st, q.value.findings]);
    const Ai = JSON.stringify(r.value && r.value.items), Bi = JSON.stringify(q.value && q.value.items);
    if (A === B && Ai === Bi) same++; else diff.push({ id: r.id, findingsSame: A === B, itemsSame: Ai === Bi, base: r.value && { act: r.value.act, st: r.value.st, n: r.value.findings.length, f: r.value.findings.slice(0, 3) }, other: q.value && { act: q.value.act, st: q.value.st, n: q.value.findings.length, f: q.value.findings.slice(0, 3) } }); });
  console.log(`\n${base} vs ${k}: ${same}/${cases.length} identical (findings + item boxes)`);
  for (const d of diff) console.log(JSON.stringify(d));
}
console.log('\nfinding counts per case (' + base + '):', runs[base].results.map(r => `${r.id}:${r.value ? r.value.findings.length : 'ERR'}`).join(' '));
process.exit(0);
