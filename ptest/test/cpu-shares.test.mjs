// node --test /Users/mick/dev/web/uc-optimizer/ptest/test/cpu-shares.test.mjs
// a pool follows the governor's cpu share (an injected governor state: the real split over the real lease files, with a
// scripted allowance), falls back to its own controller when no share is published, and PTEST_CPU_SHARES=0 turns following off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { poolLeases } from '../../governor/governor.mjs';
import { splitShares } from '../../governor/policy.mjs';

const freshLeases = tag => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ptest-share-' + tag + '-')); process.env.PTEST_LEASE_DIR = d; return d; };
const load = async () => import('../ptest.mjs?' + Math.random()); // LEASE_DIR is read at import: a fresh module per lease dir
const wait = ms => new Promise(r => setTimeout(r, ms));
const Q = { quiet: true, adaptMs: 150 };
const idle = () => ({ strained: false, cpuBusyPct: 20, pressureLevel: 1 });
const busy = () => ({ strained: true, cpuBusyPct: 97, pressureLevel: 1 });
// the governor's state as the daemon publishes it: allowance T (scripted), split over the live leases in dir. tickMs: publish
// on a tick like the daemon (every reader sees the same snapshot until the next one), else on every read
const fakeGov = (dir, Tof, seen = [], tickMs = 0) => {
  let snap = null;
  const make = () => {
    const leases = poolLeases(dir), T = Tof();
    seen.push(...leases.map(l => ({ ...l, at: Date.now() })));
    return { t: Date.now(), level: 'ok', reasons: [], cpu: { allowance: T, shares: splitShares(T, leases), busyPct: 60, targetPct: 85, pools: leases.length } };
  };
  return () => { if (!tickMs || !snap || Date.now() - snap.t >= tickMs) snap = make(); return snap; };
};
// scripted phases count from the moment the pool runs (its lease first shows a page running), so a slow Chrome launch on a
// loaded machine doesn't shift them
const fromRun = dir => { let t1 = null; return () => { if (t1 == null && poolLeases(dir).some(l => l.active > 0)) t1 = Date.now(); return t1 == null ? 0 : Date.now() - t1; }; };
const cases = (n, p) => Array.from({ length: n }, (_, i) => ({ name: p + i }));

test('follows the share: starts at it, cuts to it at once, grows toward it (+25% per tick at most), ignores its own cpu reading', async () => {
  const dir = freshLeases('follow'); const { runMatrix } = await load();
  const since = fromRun(dir), T = () => { const e = since(); return e < 2500 ? 6 : e < 5000 ? 2 : 12; };
  const lines = [], orig = console.log; console.log = (...a) => { lines.push(a.join(' ')); };
  let rep; try {
    rep = await runMatrix(cases(150, 'f'), async () => { await wait(250); }, { adaptMs: 150, progress: false, adapt: true, concurrency: 2, browsers: 1, governor: fakeGov(dir, T), strained: busy });
  } finally { console.log = orig; }
  assert.equal(rep.passed, 150);
  assert.equal(rep.governor.cpuShares.startShare, 6); assert.equal(rep.startConcurrency, 6, 'asked for 2, started at the share of 6');
  const sh = rep.adapt.filter(a => a.via === 'share');
  assert.ok(rep.adapt.every(a => a.via === 'share'), 'no local cpu cut although the injected cpu reads 97%: ' + JSON.stringify(rep.adapt));
  assert.ok(sh.some(a => a.from === 6 && a.to === 2), 'the share fell 6 -> 2: one cut, at once: ' + JSON.stringify(sh));
  const ups = sh.filter(a => a.to > a.from);
  assert.ok(ups.length >= 2 && ups.every(a => a.to <= a.from + Math.max(1, Math.ceil(a.from * 0.25)) && a.to <= a.share), 'grows toward 12 in +25% steps: ' + JSON.stringify(ups));
  assert.equal(rep.peakConcurrency, 12, 'reached the share');
  assert.ok(sh.every(a => a.to <= a.share), 'never above the share');
  const log = lines.filter(l => l.startsWith('[ptest] share:'));
  assert.ok(log.length === sh.length && log.every(l => /^\[ptest\] share: concurrency \d+ -> \d+ \(governor allowance \d+ over \d+ pools?, cpu \d+%\)$/.test(l)), log.join('\n'));
  assert.ok(lines.some(l => /concurrency 6 \(adaptive start\) \(the governor's cpu share, in \d+ ms\)/.test(l)), 'the start line names the share');
});

test('two pools split one allowance, and the one left grows into the whole of it', async () => {
  const dir = freshLeases('two'); const { runMatrix } = await load();
  const gov = fakeGov(dir, () => 8, [], 1000); // a daemon tick of 1 s: both pools register inside one tick
  let maxSum = 0, maxPages = 0; const probe = setInterval(() => { const ls = poolLeases(dir); maxSum = Math.max(maxSum, ls.reduce((a, l) => a + l.active, 0)); maxPages = Math.max(maxPages, ls.reduce((a, l) => a + l.pages, 0)); }, 50);
  const [a, b] = await Promise.all([
    runMatrix(cases(24, 'a'), async () => { await wait(250); }, { ...Q, adapt: true, concurrency: 10, browsers: 1, governor: gov, strained: idle }),
    runMatrix(cases(120, 'b'), async () => { await wait(250); }, { ...Q, adapt: true, concurrency: 10, browsers: 1, governor: gov, strained: idle }),
  ]);
  clearInterval(probe);
  assert.equal(a.passed + b.passed, 144);
  assert.ok(a.startConcurrency + b.startConcurrency <= 8 && a.startConcurrency >= 3 && b.startConcurrency >= 3, `started at their shares: ${a.startConcurrency} + ${b.startConcurrency}`);
  assert.ok(maxSum <= 8, 'the two pools together never ran more pages than the allowance: ' + maxSum);
  assert.ok(maxPages <= 8 + 1, 'their limits stayed within one tick of lag of it: ' + maxPages); // a pool whose want fell holds its limit one tick
  assert.equal(b.peakConcurrency, 8, 'the survivor grew to the whole allowance: ' + JSON.stringify(b.adapt));
});

test('a case timeout still cuts locally (x 0.75) under a share, then holds for 3 ticks', async () => {
  const dir = freshLeases('tmo'); const { runMatrix } = await load();
  const rep = await runMatrix(cases(40, 't'), async t => { await wait(t.i % 10 === 3 ? 1500 : 200); }, { ...Q, adapt: true, concurrency: 8, browsers: 1, timeout: 600, governor: fakeGov(dir, () => 8), strained: idle });
  const cut = rep.adapt.find(a => a.via === 'local' && /timeout/.test(a.why));
  assert.ok(cut && cut.to === Math.floor(cut.from * 0.75), 'timeout cut: ' + JSON.stringify(rep.adapt));
  assert.equal(rep.failed, 4);
});

test('no shares published (an older daemon): the controller works as before, with no wait at the start', async () => {
  freshLeases('old'); const { runMatrix } = await load();
  const rep = await runMatrix(cases(60, 'o'), async () => { await wait(300); }, { ...Q, adapt: true, concurrency: 2, browsers: 1, budget: 12, governor: () => ({ t: Date.now(), level: 'ok', reasons: [] }), strained: idle });
  assert.equal(rep.passed, 60);
  assert.equal(rep.governor.cpuShares.startShare, null); assert.ok(rep.governor.cpuShares.shareWaitMs < 50, 'no wait: ' + rep.governor.cpuShares.shareWaitMs);
  assert.ok(rep.peakConcurrency > 2 && rep.adapt.every(a => a.via === 'local') && rep.adapt.some(a => /headroom/.test(a.why)), JSON.stringify(rep.adapt));
});

test('a daemon that reads another lease dir is ignored at once (no wait), and the own controller decides', async () => {
  freshLeases('otherdir'); const { runMatrix } = await load();
  const gov = () => ({ t: Date.now(), level: 'ok', reasons: [], cpu: { allowance: 5, shares: { other: 5 }, busyPct: 50, pools: 1, leaseDir: '/somewhere/else' } });
  const rep = await runMatrix(cases(20, 'od'), async () => { await wait(100); }, { ...Q, adapt: true, concurrency: 3, browsers: 1, governor: gov, strained: busy });
  assert.equal(rep.passed, 20); assert.equal(rep.governor.cpuShares.startShare, null);
  assert.ok(rep.governor.cpuShares.shareWaitMs < 50, 'no wait: ' + rep.governor.cpuShares.shareWaitMs);
  assert.ok(rep.adapt.some(a => a.via === 'local' && /strained/.test(a.why)), JSON.stringify(rep.adapt));
});

test('a cpu block from our daemon without a share for this pool yet (a late lease): waits about 2 s at most, then falls back', async () => {
  const dir = freshLeases('miss'); const { runMatrix } = await load();
  const gov = () => ({ t: Date.now(), level: 'ok', reasons: [], cpu: { allowance: 5, shares: { other: 5 }, busyPct: 50, pools: 1, leaseDir: dir } });
  const rep = await runMatrix(cases(20, 'm'), async () => { await wait(100); }, { ...Q, adapt: true, concurrency: 3, browsers: 1, governor: gov, strained: busy });
  assert.equal(rep.passed, 20); assert.equal(rep.governor.cpuShares.startShare, null);
  assert.ok(rep.governor.cpuShares.shareWaitMs >= 1900 && rep.governor.cpuShares.shareWaitMs < 3000, 'bounded wait: ' + rep.governor.cpuShares.shareWaitMs);
  assert.ok(rep.adapt.some(a => a.via === 'local' && /strained/.test(a.why)), 'its own controller cut on the cpu: ' + JSON.stringify(rep.adapt));
});

test('PTEST_CPU_SHARES=0: shares are ignored, the lease says pinned, the old controller decides', async () => {
  const dir = freshLeases('off'); const { runMatrix } = await load();
  const seen = []; process.env.PTEST_CPU_SHARES = '0';
  let rep; try {
    rep = await runMatrix(cases(40, 'x'), async () => { await wait(250); }, { ...Q, adapt: true, concurrency: 8, browsers: 1, governor: fakeGov(dir, () => 20, seen), strained: busy });
  } finally { delete process.env.PTEST_CPU_SHARES; }
  assert.equal(rep.passed, 40);
  assert.equal(rep.governor.cpuShares.followed, false); assert.equal(rep.governor.cpuShares.startShare, null); assert.equal(rep.startConcurrency, 8);
  assert.ok(rep.adapt.length && rep.adapt.every(a => a.via === 'local' && a.to < a.from), 'only its own strain cuts: ' + JSON.stringify(rep.adapt));
  assert.ok(seen.length && seen.every(l => l.pinned), 'the governor sees it as fixed consumption');
});

test('a real-time case pins the lease while it runs (the governor counts it as fixed), and the share never cuts it meanwhile', async () => {
  const dir = freshLeases('rt'); const { runMatrix } = await load();
  const seen = []; let rtOn = null, rtOff = null;
  const cs = [{ name: 'rt', realtime: true }, ...cases(30, 'v')];
  const rep = await runMatrix(cs, async t => { if (t.c.name === 'rt') { rtOn = Date.now(); await wait(2500); rtOff = Date.now(); } else await wait(200); },
    { ...Q, adapt: true, concurrency: 4, browsers: 1, governor: fakeGov(dir, () => (rtOn == null || Date.now() - rtOn < 300 ? 4 : 2), seen), strained: idle });
  assert.equal(rep.passed, 31);
  const during = seen.filter(l => rtOn && l.at - rtOn > 700 && l.at < rtOff - 300);
  assert.ok(during.length && during.every(l => l.pinned), 'pinned during the real-time case: ' + JSON.stringify(during.slice(0, 3)));
  const r0 = rep.results[0], rtEnd = r0.startMs + r0.ms; // the report's 'at' and startMs count from the same pool start
  assert.ok(rep.adapt.every(a => a.to >= a.from || a.at >= rtEnd - 50), `no share cut while it ran (until ${rtEnd} ms): ` + JSON.stringify(rep.adapt));
  assert.ok(rep.adapt.some(a => a.via === 'share' && a.to === 2), 'cut to the share once it ended: ' + JSON.stringify(rep.adapt));
});

test('the lease stays fresh while the browsers launch slowly (the governor and the other pools drop a lease older than 15 s)', async () => {
  const dir = freshLeases('beat'); const { runMatrix } = await load();
  const { chromium } = await import('playwright-core'); const orig = chromium.launch;
  chromium.launch = async function (...a) { await wait(17000); return orig.apply(this, a); }; // a launch on a loaded machine
  let fresh = 0, probes = 0; const t0 = Date.now();
  const probe = setInterval(() => { if (Date.now() - t0 > 15500 && Date.now() - t0 < 16800) { probes++; if (poolLeases(dir).length === 1) fresh++; } }, 200);
  let rep; try {
    rep = await runMatrix(cases(4, 'l'), async () => { await wait(50); }, { ...Q, adapt: true, concurrency: 2, browsers: 1, governor: fakeGov(dir, () => 2), strained: idle });
  } finally { chromium.launch = orig; clearInterval(probe); }
  assert.equal(rep.passed, 4);
  assert.ok(probes > 0 && fresh === probes, `the lease was live 15.5-16.8 s into a 17 s launch: ${fresh}/${probes}`);
});

test('a pool that follows shares holds when its share is missing for a while (no fallback to its own cpu reading)', async () => {
  const dir = freshLeases('gap'); const { runMatrix } = await load();
  const t0 = Date.now(), inner = fakeGov(dir, () => 6);
  // 1.5-3 s: a cpu block without this pool's share; 3-4.5 s: no cpu block at all (a state older than 5 s: the local fallback)
  const gov = () => { const g = inner(), e = Date.now() - t0; return e > 1500 && e < 3000 ? { ...g, cpu: { ...g.cpu, shares: {} } } : e >= 3000 && e < 4500 ? { t: g.t, level: 'ok', reasons: [] } : g; };
  const rep = await runMatrix(cases(80, 'g'), async () => { await wait(250); }, { ...Q, adapt: true, concurrency: 2, browsers: 1, governor: gov, strained: busy });
  assert.equal(rep.passed, 80); assert.equal(rep.startConcurrency, 6);
  assert.ok(rep.adapt.every(a => a.via === 'share'), 'no local cut on the 97% cpu reading during the gap: ' + JSON.stringify(rep.adapt));
});

test('a share missing for more than 15 s: the own controller of the pool takes over again', async () => {
  const dir = freshLeases('lost'); const { runMatrix } = await load();
  const since = fromRun(dir), inner = fakeGov(dir, () => 4);
  const gov = () => { const g = inner(); return since() > 1000 ? { t: g.t, level: 'ok', reasons: [] } : g; }; // the daemon is gone after 1 s of running
  const rep = await runMatrix(cases(600, 'z'), async () => { await wait(150); }, { ...Q, adapt: true, concurrency: 2, browsers: 1, governor: gov, strained: busy });
  assert.equal(rep.passed, 600); assert.equal(rep.startConcurrency, 4);
  const firstLocal = rep.adapt.find(a => a.via === 'local');
  const runStart = rep.results[0].startMs;
  assert.ok(firstLocal && /strained/.test(firstLocal.why), 'its own cpu reading cut once the share was gone: ' + JSON.stringify(rep.adapt));
  assert.ok(firstLocal.at - runStart >= 1000 + 14500, `not before 15 s without a share: ${firstLocal.at - runStart} ms after the first case`);
});
