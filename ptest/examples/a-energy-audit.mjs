// (a) energy-screen bbox audit: 11 viewports x 3 states (idle, holding mid-action, done) = 33 cases, virtual time.
// node examples/a-energy-audit.mjs            (auto concurrency)    PTEST_CONCURRENCY=1 node examples/a-energy-audit.mjs  (serial)
import { runMatrix, cross, dusk, VIEWPORTS_11, formatAudit } from '../ptest.mjs';

export const cases = cross({ vp: VIEWPORTS_11 }, { state: ['idle', 'hold', 'done'] }).map(c => ({ ...c, virtual: true }));

export async function fn(t) {
  await dusk.open(t, { query: '?tod=night' });
  await dusk.energy(t);
  await t.runFor(1200);                                           // she lands, says hello, settles
  if (t.c.state !== 'idle') {
    await dusk.press(t);
    if (t.c.state === 'hold') {                                   // the first line's action, frozen half-way through its peak
      await t.runFor(50);
      const T = await t.page.evaluate(() => { const d = window.__dusk, act = d.main.el.dataset.act; return { act, ...d.actTiming(act, 3000) }; });
      await t.runFor(T.in + T.peak / 2 - 50);
      t.check('holding', await t.page.evaluate(() => document.querySelector('#stage').classList.contains('holding')));
    } else {
      const v = await t.runUntil(() => document.querySelector('#stage').classList.contains('done'), { step: 100, max: 40000 });
      t.check('done within 30.0-30.5s virtual', v >= 29900 && v <= 30500, v);
      await t.runFor(800);
    }
  }
  const audit = await t.audit({ root: '#s2', pairsSkip: [['#eCap', '#eCap .cap-plate']] });
  await t.shot(t.c.state);
  if (t.c.state !== 'idle') await dusk.release(t);
  return { counts: audit.counts, findings: audit.findings.length, sample: audit.findings.slice(0, 3).map(f => `${f.type}: ${f.a || ''}${f.b ? ' ~ ' + f.b : ''} ${f.detail || ''}`) };
}

export const bench = { key: 'a', name: 'a-energy-audit', title: 'energy bbox audit, 11 viewports x 3 states', cases, fn, opts: { timeout: 120000 } };

if (import.meta.url === `file://${process.argv[1]}`) {
  const rep = await runMatrix(cases, fn, { name: bench.name, ...bench.opts });
  for (const r of rep.results) if (r.ok) console.log(`${r.id.padEnd(22)} findings ${r.value.findings} ${JSON.stringify(r.value.counts)}`);
  process.exit(rep.ok ? 0 : 1);
}
