// one adaptive run in its own process (for adaptive.test.mjs): node adaptive-worker.mjs <cases> <name>
import { runMatrix } from '../../ptest.mjs';
const n = +process.argv[2] || 40, name = process.argv[3] || 'w';
const rep = await runMatrix(Array.from({ length: n }, (_, i) => ({ name: name + '-' + i })), async () => { await new Promise(r => setTimeout(r, 300)); },
  { quiet: true, adapt: true, concurrency: 2, browsers: 1, adaptMs: 200 });
console.log(JSON.stringify({ passed: rep.passed, peak: rep.peakConcurrency, final: rep.finalConcurrency, adapt: rep.adapt.map(a => [a.at, a.from, a.to, a.why.slice(0, 40)]) }));
process.exit(0);
