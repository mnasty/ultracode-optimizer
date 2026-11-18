// V4: one parallel run of benchmarks a and b at the default concurrency (same as `ptest.mjs bench a b --parallel-only`, but the
// reports go to verify/ instead of appending to bench-results.json).
import { runMatrix, sysSnapshot } from '../ptest.mjs';
const keys = process.argv.slice(2).length ? process.argv.slice(2) : ['a', 'b'];
const FILES = { a: 'a-energy-audit.mjs', b: 'b-hold-log.mjs', c: 'c-action-peaks.mjs', d: 'd-smoke-walk.mjs' };
for (const k of keys) {
  const { bench } = await import(new URL('../examples/' + FILES[k], import.meta.url).href);
  const s0 = sysSnapshot();
  const rep = await runMatrix(bench.cases, bench.fn, { ...bench.opts, name: `verify-${bench.name}-parallel`, progress: false, out: new URL(`./out-v4/${bench.name}.json`, import.meta.url).pathname });
  console.log(`SPEED ${bench.name}: ${rep.passed}/${rep.cases} wall ${(rep.wallMs / 1000).toFixed(1)}s sum ${(rep.sumMs / 1000).toFixed(1)}s speedup ${rep.speedup}x conc ${rep.concurrency}x${rep.browsers} launch ${rep.launchMs} close ${rep.closeMs} maxCase ${Math.max(...rep.results.map(r => r.ms))}ms load ${s0.load1}->${rep.sys.load1} cpu ${rep.sys.cpuBusyPct}% swapDelta ${rep.sys.swapUsedDeltaMB}MB backoffs ${rep.backoffs.length}`);
}
process.exit(0);
