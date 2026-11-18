import { runMatrix, dusk } from '../ptest.mjs';
const { fn: holdFn } = await import('../examples/b-hold-log.mjs');
for (const [k, n, f] of [['open', 4, async t => { await dusk.open(t); }], ['holdCut', 1, holdFn], ['holdCut', 2, holdFn], ['holdCut', 4, holdFn], ['energy', 4, async t => { await dusk.open(t); await dusk.energy(t); await t.runFor(36000); }]]) {
  const cases = Array.from({ length: n }, (_, i) => ({ name: `c${i}`, vp: ['360x640', '390x844', '768x1024', '1440x900'][i], virtual: true }));
  const t0 = performance.now();
  const rep = await runMatrix(cases, f, { name: 'v5b', quiet: true, timeout: 120000 });
  console.log(`${k.padEnd(8)} n=${n} ok=${rep.ok} wall ${rep.wallMs} close ${rep.closeMs}ms cases ${rep.results.map(r => r.ms).join(',')}`);
}
process.exit(0);
