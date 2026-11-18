// ptest under the resource governor: admission, hold, shed (a fake governor drives the levels; cpu is reported idle)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptest-gov-leases-')); process.env.PTEST_LEASE_DIR = dir;
const { runMatrix } = await import('../ptest.mjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const idle = () => ({ strained: false, cpuBusyPct: 20, pressureLevel: 1 });
const Q = { quiet: true, adaptMs: 300 };
const G = level => ({ t: Date.now(), level, reasons: level === 'ok' ? [] : [`${level}: test`] });

test('a pool does not start any browser while the governor says hold, and starts once it is ok', async () => {
  const t0 = Date.now(); const gov = () => G(Date.now() - t0 < 2000 ? 'hold' : 'ok');
  const rep = await runMatrix([{ name: 'a' }, { name: 'b' }], async () => { await wait(50); }, { ...Q, adapt: true, concurrency: 2, browsers: 1, governor: gov, strained: idle });
  assert.equal(rep.passed, 2);
  assert.ok(rep.governor.admitWaitMs >= 1800, 'waited for ok: ' + rep.governor.admitWaitMs);
});

test('hold: no growth even with an idle cpu and work queued', async () => {
  const rep = await runMatrix(Array.from({ length: 30 }, (_, i) => ({ name: 'h' + i })), async () => { await wait(250); },
    { ...Q, adapt: true, concurrency: 2, browsers: 1, governor: (() => { let n = 0; return () => G(n++ === 0 ? 'ok' : 'hold'); })(), strained: idle });
  assert.equal(rep.peakConcurrency, 2, 'held at the start value: ' + rep.peakConcurrency);
  assert.ok(rep.governor.levels.hold > 0);
});

test('shed: the limit is cut and idle browsers are closed', async () => {
  const t0 = Date.now(); const gov = () => G(Date.now() - t0 > 2500 ? 'shed' : 'ok');
  const rep = await runMatrix(Array.from({ length: 80 }, (_, i) => ({ name: 's' + i })), async () => { await wait(300); },
    { ...Q, adapt: true, concurrency: 8, browsers: 4, contextsPerBrowser: 2, governor: gov, strained: idle });
  assert.equal(rep.passed, 80);
  assert.ok(rep.adapt.some(a => /governor shed/.test(a.why)), 'cut by the governor');
  assert.ok(rep.finalConcurrency < 8, 'final ' + rep.finalConcurrency);
  assert.ok(rep.browsersLive < rep.browsers, `browsers closed: ${rep.browsersLive} live of ${rep.browsers}`);
});

test('ok: grows past the old fixed caps (no page budget, no browser cap) while the cpu has room', async () => {
  const rep = await runMatrix(Array.from({ length: 200 }, (_, i) => ({ name: 'g' + i })), async () => { await wait(400); },
    { ...Q, adapt: true, concurrency: 4, browsers: 1, contextsPerBrowser: 4, governor: () => G('ok'), strained: idle });
  assert.equal(rep.passed, 200);
  assert.ok(rep.peakConcurrency > 20, 'grew beyond the old 2 x cores budget: ' + rep.peakConcurrency);
  assert.ok(rep.browsers > Math.ceil(os.cpus().length / 3), 'more browsers than the old cap: ' + rep.browsers);
});
