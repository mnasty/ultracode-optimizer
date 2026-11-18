// V5: why does browser close take 7-10s after some matrices? close time by workload
import { runMatrix, dusk } from '../ptest.mjs';
const { fn: holdFn } = await import('../examples/b-hold-log.mjs');
const W = {
  open: async t => { await dusk.open(t); },
  energy: async t => { await dusk.open(t); await dusk.energy(t); },
  holdDone: async t => { await dusk.open(t); await dusk.energy(t); await dusk.press(t); await t.runFor(31000); },
  holdCut: holdFn,
  openReal: async t => { await dusk.open(t); },
};
for (const [k, f] of Object.entries(W)) {
  const rep = await runMatrix([{ vp: '390x844', virtual: k !== 'openReal' }], f, { name: 'v5-' + k, quiet: true, timeout: 120000 });
  console.log(`${k.padEnd(9)} ok=${rep.ok} case ${rep.results[0].ms}ms close ${rep.closeMs}ms ${rep.ok ? '' : rep.results[0].error}`);
}
process.exit(0);
