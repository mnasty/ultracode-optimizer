// node --test /Users/mick/dev/web/uc-optimizer/ptest/test/adaptive.test.mjs
// the adaptive controller and the machine-wide page budget (lease files). Each test uses its own lease dir, so a real run
// elsewhere on the machine cannot change the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const freshLeases = (tag) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ptest-lease-' + tag + '-')); process.env.PTEST_LEASE_DIR = d; return d; };
const load = async () => import('../ptest.mjs?' + Math.random()); // LEASE_DIR is read at import: a fresh module per lease dir
const wait = ms => new Promise(r => setTimeout(r, ms));
const Q = { quiet: true, adaptMs: 150 };
const idle = () => ({ strained: false, cpuBusyPct: 20, pressureLevel: 1 });
const busy = () => ({ strained: true, cpuBusyPct: 97, pressureLevel: 1 });

test('ramps up on an idle machine from a low start, within the budget and the work left', async () => {
  freshLeases('up'); const { runMatrix } = await load();
  const cases = Array.from({ length: 60 }, (_, i) => ({ name: 'u' + i }));
  const rep = await runMatrix(cases, async () => { await wait(300); }, { ...Q, adapt: true, concurrency: 2, browsers: 1, budget: 12, strained: idle });
  assert.equal(rep.passed, 60);
  assert.ok(rep.peakConcurrency > 2, 'grew from 2: ' + JSON.stringify(rep.adapt));
  assert.ok(rep.peakConcurrency <= 12, 'never above the budget: ' + rep.peakConcurrency);
  assert.ok(rep.adapt.every(a => a.to <= 12) && rep.adapt.some(a => /headroom/.test(a.why)), JSON.stringify(rep.adapt));
});

test('cuts on a strained machine and never ramps up while strained', async () => {
  freshLeases('down'); const { runMatrix } = await load();
  const cases = Array.from({ length: 40 }, (_, i) => ({ name: 'd' + i }));
  const rep = await runMatrix(cases, async () => { await wait(300); }, { ...Q, adapt: true, concurrency: 8, browsers: 1, budget: 20, strained: busy });
  assert.equal(rep.passed, 40);
  assert.ok(rep.finalConcurrency < 8, 'cut from 8: ' + JSON.stringify(rep.adapt));
  assert.ok(rep.adapt.every(a => a.to < a.from), 'only cuts: ' + JSON.stringify(rep.adapt));
});

test('pinned (opts.concurrency without adapt) keeps the old behaviour: no controller', async () => {
  freshLeases('pin'); const { runMatrix } = await load();
  const rep = await runMatrix(Array.from({ length: 20 }, (_, i) => ({ name: 'p' + i })), async () => { await wait(200); }, { quiet: true, concurrency: 3, browsers: 1, strained: idle });
  assert.equal(rep.adaptive, false); assert.deepEqual(rep.adapt, []); assert.equal(rep.finalConcurrency, 3);
});

test('shares the budget with other runs\' leases, and grows into the space when they leave', async () => {
  const dir = freshLeases('share'); const { runMatrix } = await load();
  const fake = (n, pages) => { const f = path.join(dir, `${process.pid}-fake${n}.json`); fs.writeFileSync(f, JSON.stringify({ pid: process.pid, name: 'other' + n, pages, t: Date.now() })); return f; };
  const f1 = fake(1, 9), f2 = fake(2, 9); // two other runs hold 18 of 20: fair share = floor(20 / 3) = 6
  const keep = setInterval(() => { for (const f of [f1, f2]) if (fs.existsSync(f)) { const l = JSON.parse(fs.readFileSync(f)); l.t = Date.now(); fs.writeFileSync(f, JSON.stringify(l)); } }, 300);
  setTimeout(() => { fs.unlinkSync(f1); fs.unlinkSync(f2); }, 2500); // they finish
  const cases = Array.from({ length: 120 }, (_, i) => ({ name: 's' + i }));
  const rep = await runMatrix(cases, async () => { await wait(250); }, { ...Q, adapt: true, concurrency: 12, browsers: 1, budget: 20, strained: idle });
  clearInterval(keep);
  assert.equal(rep.passed, 120);
  const early = rep.adapt.filter(a => a.at < 2300);
  assert.ok(rep.concurrency === 12 && rep.startConcurrency <= 6 && early.every(a => a.to <= 6), `asked for 12, started at the fair share (${rep.startConcurrency} <= 6) and held it while two others ran: ` + JSON.stringify(rep.adapt));
  assert.ok(rep.peakConcurrency > 6, 'grew past 6 once they left: ' + JSON.stringify(rep.adapt));
});

test('never ramps up while a real-time case runs', async () => {
  freshLeases('rt'); const { runMatrix } = await load();
  const cases = [{ name: 'rt', realtime: true }, ...Array.from({ length: 30 }, (_, i) => ({ name: 'v' + i }))];
  const rep = await runMatrix(cases, async t => { await wait(t.c.name === 'rt' ? 3000 : 200); }, { ...Q, adapt: true, concurrency: 2, browsers: 1, budget: 12, strained: idle });
  assert.equal(rep.passed, 31);
  assert.ok(rep.adapt.filter(a => a.to > a.from).every(a => a.at > 3000), 'no increase before the real-time case finished: ' + JSON.stringify(rep.adapt));
});

test('adds browsers as the limit grows', async () => {
  freshLeases('pool'); const { runMatrix } = await load();
  const rep = await runMatrix(Array.from({ length: 60 }, (_, i) => ({ name: 'b' + i })), async () => { await wait(300); }, { ...Q, adapt: true, concurrency: 2, browsers: 1, budget: 12, contextsPerBrowser: 2, maxBrowsers: 3, strained: idle });
  assert.equal(rep.passed, 60);
  assert.ok(rep.browsers > 1 && rep.browsers <= 3, 'browsers ' + rep.browsers + ' at peak ' + rep.peakConcurrency);
});

test('two real processes share one budget and the survivor grows (real cpu probe, no hooks)', async () => {
  const dir = freshLeases('procs');
  const worker = path.join(HERE, 'fixtures', 'adaptive-worker.mjs');
  const env = { ...process.env, PTEST_LEASE_DIR: dir, PTEST_BUDGET: '8' };
  const run = (n, count) => new Promise((res, rej) => { const p = spawn(process.execPath, [worker, String(count), 'w' + n], { env, stdio: ['ignore', 'pipe', 'inherit'] }); let out = ''; p.stdout.on('data', d => out += d); p.on('exit', c => c === 0 ? res(JSON.parse(out.trim().split('\n').pop())) : rej(new Error('worker exit ' + c))); });
  let maxSum = 0; const sample = setInterval(() => { let s = 0; for (const f of fs.readdirSync(dir)) { try { s += JSON.parse(fs.readFileSync(path.join(dir, f))).pages; } catch { } } maxSum = Math.max(maxSum, s); }, 100);
  const [a, b] = await Promise.all([run(1, 40), run(2, 140)]);
  clearInterval(sample);
  assert.equal(a.passed, 40); assert.equal(b.passed, 140);
  assert.ok(maxSum <= 8 + 2, `the two leases together stayed near the budget of 8: max sum ${maxSum}`); // +2: one tick of lag either way
  assert.ok(b.peak >= a.peak, `the longer run grew once the short one left: a ${JSON.stringify(a)} b ${JSON.stringify(b)}`);
});
