// node ptest.mjs bench [a b c d] [--realtime-baseline] [--parallel-only] [--serial-only]
// each benchmark: the same cases + fn run serial (concurrency 1, 1 browser) and parallel (auto), virtual time.
// --realtime-baseline also runs them on the wall clock (virtual:false), serial and parallel: the old way, measured.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMatrix, resolveConcurrency, PTEST_DIR, sysSnapshot } from '../ptest.mjs';

const FILES = { a: 'a-energy-audit.mjs', b: 'b-hold-log.mjs', c: 'c-action-peaks.mjs', d: 'd-smoke-walk.mjs' };
const fmt = ms => (ms / 1000).toFixed(1) + 's';

export async function runBenchmarks(args = []) {
  const keys = args.filter(a => FILES[a]); const sel = keys.length ? keys : Object.keys(FILES);
  const withReal = args.includes('--realtime-baseline'), onlyPar = args.includes('--parallel-only'), onlySer = args.includes('--serial-only');
  const rows = [];
  for (const k of sel) {
    const { bench } = await import(pathToFileURL(path.join(PTEST_DIR, 'examples', FILES[k])).href);
    const modes = [];
    if (withReal) modes.push(['serial-real', { concurrency: 1, browsers: 1 }, false], ['parallel-real', { profile: 'realtime' }, false]);
    if (!onlyPar) modes.push(['serial-virtual', { concurrency: 1, browsers: 1 }, true]);
    if (!onlySer) modes.push(['parallel-virtual', {}, true]);
    for (const [mode, o, virtual] of modes) {
      const cases = bench.cases.map(c => ({ ...c, virtual }));
      console.log(`\n=== ${bench.name} [${mode}] ${cases.length} cases ===`);
      const s0 = sysSnapshot();
      const rep = await runMatrix(cases, bench.fn, { ...bench.opts, ...o, name: `${bench.name}-${mode}`, progress: false, timeout: virtual ? bench.opts.timeout : Math.max(bench.opts.timeout, 180000) });
      let afterMs = 0;
      if (bench.after && mode === 'parallel-virtual') { const t = performance.now(); await bench.after(rep); afterMs = Math.round(performance.now() - t); }
      rows.push({ key: k, bench: bench.name, title: bench.title, mode, cases: cases.length, passed: rep.passed, wallMs: rep.wallMs, sumMs: rep.sumMs, speedup: rep.speedup, concurrency: rep.concurrency, concurrencySource: rep.concurrencySource,
        browsers: rep.browsers, backoffs: rep.backoffs.length, afterMs, firstError: rep.failed ? rep.results.find(r => !r.ok).error : null, sys: { load1Before: s0.load1, ...rep.sys } });
    }
  }
  console.log('\n=== benchmark summary ===');
  console.log('bench            mode              cases pass  wall      sum-of-cases  speed-up  conc  browsers  cpu%  load    swapDelta');
  for (const r of rows) console.log(`${r.bench.padEnd(17)}${r.mode.padEnd(18)}${String(r.cases).padEnd(6)}${String(r.passed).padEnd(6)}${fmt(r.wallMs).padEnd(10)}${fmt(r.sumMs).padEnd(14)}${(r.speedup + 'x').padEnd(10)}${String(r.concurrency).padEnd(6)}${String(r.browsers).padEnd(10)}${String(r.sys.cpuBusyPct).padEnd(6)}${String(Math.round(r.sys.load1)).padEnd(8)}${r.sys.swapUsedDeltaMB}MB`);
  for (const k of sel) {
    const R = rows.filter(r => r.key === k), g = m => R.find(r => r.mode === m);
    const sv = g('serial-virtual'), pv = g('parallel-virtual'), sr = g('serial-real');
    if (sv && pv) console.log(`${R[0].bench}: serial ${fmt(sv.wallMs)} -> parallel ${fmt(pv.wallMs)} = ${(sv.wallMs / pv.wallMs).toFixed(2)}x faster at concurrency ${pv.concurrency}${sr ? `; vs the old way (serial, real time) ${fmt(sr.wallMs)}: ${(sr.wallMs / pv.wallMs).toFixed(1)}x` : ''}`);
  }
  const file = path.join(PTEST_DIR, 'bench-results.json');
  let hist = []; try { hist = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
  hist.push({ at: new Date().toISOString(), concurrency: resolveConcurrency(), rows });
  fs.writeFileSync(file, JSON.stringify(hist, null, 1));
  console.log(`wrote ${file}`);
  return rows;
}
