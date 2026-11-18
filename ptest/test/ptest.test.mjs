// node --test /Users/mick/dev/web/uc-optimizer/ptest/test/*.test.mjs   (a bare directory argument does not work on this Node)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  runMatrix, pickKnee, decodePng, contactSheet, caseId, cross, vp, resolveConcurrency, readCalibration, sysSnapshot,
  chromium, installVirtualTime, runFor, freezeAt, markAnimations, bboxAudit, contrastAt, realTimeConfirm, REALTIME_LOG, OUT_DIR,
} from '../ptest.mjs';

const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fx = n => pathToFileURL(path.join(FX, n)).href;
const Q = { quiet: true };

test('cross / caseId / vp', () => {
  const cs = cross({ vp: ['390x844', '1440x900'] }, { state: ['idle', 'done'] });
  assert.equal(cs.length, 4);
  assert.deepEqual(cs[1], { vp: '390x844', state: 'done' });
  assert.equal(caseId({ vp: '390x844', state: 'idle', dpr: 2, rm: true }), '390x844-dpr2-rm-idle');
  assert.equal(caseId({ name: 'My Case!' }), 'my-case');
  assert.deepEqual(vp('360x640'), { width: 360, height: 640 });
});

test('pickKnee: max throughput, but back off when a lower level is within 5% and the higher costs >25% more per case', () => {
  const L = [{ c: 1, throughput: 1, perCaseMs: 1000 }, { c: 4, throughput: 3.8, perCaseMs: 1050 }, { c: 8, throughput: 6.0, perCaseMs: 1330 }, { c: 12, throughput: 6.2, perCaseMs: 1930 }, { c: 16, throughput: 6.1, perCaseMs: 2600 }];
  assert.equal(pickKnee(L).knee, 8);
  const L2 = [{ c: 1, throughput: 1, perCaseMs: 1000 }, { c: 8, throughput: 7.5, perCaseMs: 1060 }, { c: 16, throughput: 14, perCaseMs: 1140 }];
  assert.equal(pickKnee(L2).knee, 16);
  // failures disqualify a level
  assert.equal(pickKnee([{ c: 1, throughput: 1, perCaseMs: 1, failures: 0 }, { c: 2, throughput: 9, perCaseMs: 1, failures: 1 }]).knee, 1);
});

test('resolveConcurrency: opts > env > default (cpu count, 5 contexts per browser); calibration only on request', () => {
  const saved = { c: process.env.PTEST_CONCURRENCY, b: process.env.PTEST_BROWSERS, u: process.env.PTEST_USE_CALIBRATION };
  delete process.env.PTEST_CONCURRENCY; delete process.env.PTEST_BROWSERS; delete process.env.PTEST_USE_CALIBRATION;
  try {
    const cpus = os.cpus().length, d = resolveConcurrency({});
    assert.equal(d.value, Math.max(2, cpus));
    assert.equal(d.browsers, Math.ceil(Math.max(2, cpus) / 5));
    assert.match(d.source, /^default/);
    assert.deepEqual(resolveConcurrency({ concurrency: 3 }), { value: 3, source: 'opts.concurrency', browsers: 1 });
    assert.equal(resolveConcurrency({ concurrency: 12 }).browsers, 3);
    assert.equal(resolveConcurrency({ concurrency: 12, browsers: 4 }).browsers, 4);
    process.env.PTEST_CONCURRENCY = '5';
    assert.equal(resolveConcurrency({}).value, 5);
    assert.match(resolveConcurrency({}).source, /env/);
    assert.equal(resolveConcurrency({ concurrency: 7 }).value, 7, 'opts beats env');
    process.env.PTEST_BROWSERS = '3';
    assert.equal(resolveConcurrency({}).browsers, 3);
    delete process.env.PTEST_CONCURRENCY; delete process.env.PTEST_BROWSERS;
    // a stale or contaminated calibration is never used, even on request; the default comes back
    process.env.PTEST_USE_CALIBRATION = '1';
    const cal = readCalibration();
    if (!cal || cal.stale || cal.contaminated) assert.match(resolveConcurrency({}).source, /^default/);
    else assert.match(resolveConcurrency({}).source, /^calibration/);
  } finally {
    for (const [k, v] of [['PTEST_CONCURRENCY', saved.c], ['PTEST_BROWSERS', saved.b], ['PTEST_USE_CALIBRATION', saved.u]]) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  }
});

test('sysSnapshot reads memory pressure and swap', () => {
  const s = sysSnapshot();
  assert.ok(s.freeMemPct != null && s.swapUsedMB != null && s.pageouts != null, JSON.stringify(s));
});

test('runMatrix: results in case order, failures collected, timeouts, page/console errors, soft checks, retries', async () => {
  const cases = [
    { name: 'slow-ok', ms: 400 }, { name: 'throws', ms: 10 }, { name: 'fast-ok', ms: 10 }, { name: 'timeout', ms: 5000 },
    { name: 'pageerror', url: fx('errors.html') }, { name: 'softcheck', ms: 1 }, { name: 'flaky', flaky: true },
  ];
  let flakyRuns = 0;
  const rep = await runMatrix(cases, async t => {
    if (t.c.url) { await t.page.goto(t.c.url); await t.page.waitForTimeout(100); return 'loaded'; }
    if (t.c.flaky) { flakyRuns++; if (flakyRuns === 1) throw new Error('first try fails'); return 'second try'; }
    await new Promise(r => setTimeout(r, t.c.ms));
    if (t.c.name === 'throws') throw new Error('nope');
    if (t.c.name === 'softcheck') { t.check('one is one', 1 === 1); t.check('two is three', 2 === 3, { got: 2 }); return 'kept going'; }
    return t.c.name;
  }, { ...Q, concurrency: 4, timeout: 1500, retries: 1 });
  assert.deepEqual(rep.results.map(r => r.id), cases.map(c => c.name));
  const by = Object.fromEntries(rep.results.map(r => [r.id, r]));
  assert.equal(by['slow-ok'].ok, true); assert.equal(by['slow-ok'].value, 'slow-ok');
  assert.equal(by['throws'].ok, false); assert.match(by['throws'].error, /nope/); assert.equal(by['throws'].attempts, 2);
  assert.equal(by['timeout'].ok, false); assert.match(by['timeout'].error, /timeout after 1500ms/);
  assert.equal(by['pageerror'].ok, false); assert.match(by['pageerror'].error, /boom from page/);
  assert.ok(by['pageerror'].consoleErrors.some(e => /boom from console/.test(e)));
  assert.equal(by['softcheck'].ok, false); assert.match(by['softcheck'].error, /two is three/); assert.equal(by['softcheck'].value, 'kept going');
  assert.equal(by['flaky'].ok, true); assert.equal(by['flaky'].attempts, 2);
  assert.equal(rep.failed, 4);
});

test('runMatrix: per-case context options (viewport, dpr, touch, reducedMotion, colorScheme)', async () => {
  const rep = await runMatrix([{ vp: '360x640', dpr: 2, touch: true, rm: true, colorScheme: 'light' }, { vp: '1440x900' }], async t => {
    await t.page.setContent('<p>x</p>');
    return t.page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, touch: navigator.maxTouchPoints > 0, rm: matchMedia('(prefers-reduced-motion: reduce)').matches, light: matchMedia('(prefers-color-scheme: light)').matches }));
  }, { ...Q, concurrency: 2 });
  assert.deepEqual(rep.results[0].value, { w: 360, h: 640, dpr: 2, touch: true, rm: true, light: true });
  assert.deepEqual(rep.results[1].value, { w: 1440, h: 900, dpr: 1, touch: false, rm: false, light: false });
});

test('virtual time: timers, Date, rAF, WAAPI finished, CSS transition + animation ends follow page.clock', async () => {
  const rep = await runMatrix([{ name: 'timers', virtual: { time: '2026-10-27T23:30:00Z' } }], async t => {
    await t.page.goto(fx('timers.html'));
    const d0 = await t.page.evaluate(() => Date.now());
    const r0 = Date.now();
    await t.runFor(2000);
    const real = Date.now() - r0;
    const R = await t.page.evaluate(() => ({ ...window.R, rafT: undefined, now: Date.now(), loopCT: document.getElementById('loop').getAnimations()[0].currentTime }));
    return { R, d0, real };
  }, { ...Q, concurrency: 1 });
  const { R, d0, real } = rep.results[0].value;
  assert.equal(d0, Date.parse('2026-10-27T23:30:00Z'), 'Date starts at the installed time');
  assert.equal(R.now - d0, 2000, 'Date advanced exactly 2000ms');
  assert.equal(R.iv, 20, 'setInterval(100) fired 20 times');
  assert.deepEqual(R.chain, [0, 250, 500, 750, 1000, 1250], 'setTimeout chain on exact virtual times');
  assert.ok(Math.abs(R.raf - 125) <= 2, 'rAF ~ every 16ms: ' + R.raf);
  assert.equal(R.waapiDone, 1000, 'Element.animate finished promise at virtual 1000ms');
  assert.equal(R.trStart, 500); assert.ok(R.trEnd >= 800 && R.trEnd <= 800 + 40, 'transitionend ~800: ' + R.trEnd);
  assert.equal(R.cssStart, 200); assert.ok(R.cssEnd >= 1200 && R.cssEnd <= 1200 + 40, 'animationend ~1200: ' + R.cssEnd);
  assert.ok(Math.abs(R.loopCT - 2000) <= 40, 'infinite CSS animation currentTime follows virtual time: ' + R.loopCT);
  assert.ok(real < 1500, '2s of virtual time ran in ' + real + 'ms real');
});

test('virtual time: a 60s minute-tick runs in well under a second', async () => {
  const rep = await runMatrix([{ name: 'minute', virtual: { time: '2026-10-27T23:30:00Z' } }], async t => {
    await t.page.goto(fx('timers.html'));
    const r0 = Date.now(); await t.runFor(60000); const real = Date.now() - r0;
    return { real, clock: await t.page.evaluate(() => document.getElementById('clock').textContent) };
  }, { ...Q, concurrency: 1 });
  const v = rep.results[0].value;
  assert.equal(v.clock, '2026-10-27T23:31:00.000Z');
  assert.ok(v.real < 3000, '60s virtual took ' + v.real + 'ms real');
});

test('freezeAt: pause + seek all animations, by ms and by %, onlyNew after markAnimations', async () => {
  const rep = await runMatrix([{ name: 'freeze' }], async t => {
    await t.page.setContent(`<style>@keyframes s{from{transform:translateX(0)}to{transform:translateX(100px)}}#a{animation:s 1000ms linear forwards}#b{animation:s 2000ms linear infinite}</style><div id=a>a</div><div id=b>b</div>`);
    await t.page.waitForTimeout(50);
    const tx = id => t.page.evaluate(id => new DOMMatrix(getComputedStyle(document.getElementById(id)).transform).m41, id);
    await t.freezeAt(500); const a500 = await tx('a'), b500 = await tx('b');
    await t.freezeAt('25%', { selector: '#a' }); const a25 = await tx('a');
    await t.mark();
    await t.page.evaluate(() => document.getElementById('a').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400 }));
    await t.freezeAt(200, { onlyNew: true });
    const op = await t.page.evaluate(() => +getComputedStyle(document.getElementById('a')).opacity);
    const b2 = await tx('b');
    return { a500, b500, a25, op, b2 };
  }, { ...Q, concurrency: 1 });
  const v = rep.results[0].value;
  assert.ok(Math.abs(v.a500 - 50) < 0.5, 'a at 500ms = 50px: ' + v.a500);
  assert.ok(Math.abs(v.b500 - 25) < 0.5, 'b at 500ms = 25px: ' + v.b500);
  assert.ok(Math.abs(v.a25 - 25) < 0.5, 'a at 25% = 25px: ' + v.a25);
  assert.ok(Math.abs(v.op - 0.5) < 0.02, 'new animation seeked to 200/400: ' + v.op);
  assert.ok(Math.abs(v.b2 - 25) < 0.5, 'marked animation left where it was: ' + v.b2);
});

test('bboxAudit: finds every planted defect and nothing on a clean page', async () => {
  const rep = await runMatrix([{ name: 'bad', vp: '390x844', url: fx('audit-bad.html') }, { name: 'good', vp: '390x844', url: fx('audit-good.html') }], async t => {
    await t.page.goto(t.c.url); return t.audit();
  }, { ...Q, concurrency: 2 });
  const bad = rep.results[0].value, good = rep.results[1].value;
  const has = (type, re) => bad.findings.some(f => f.type === type && re.test((f.a || '') + ' ~ ' + (f.b || '')));
  assert.ok(has('overlap', /#o1.*#o2|#o2.*#o1/), 'overlap o1/o2');
  assert.ok(has('smallTarget', /#small/), 'small target');
  assert.ok(has('smallTarget', /#hb/), 'small header button');
  assert.ok(has('clearance', /#b1.*#b2|#b2.*#b1/), 'buttons 4px apart');
  assert.ok(has('clearance', /#lbl.*#ico|#ico.*#lbl/), 'label 3px from icon');
  assert.ok(has('smallText', /#tiny/), 'small text');
  assert.ok(has('clippedText', /#clipped/), 'clipped text');
  assert.ok(has('underFixed', /#under/), 'under fixed header');
  assert.ok(bad.findings.some(f => f.type === 'hScroll'), 'horizontal scroll');
  assert.ok(!bad.findings.some(f => /screen reader|invisible|clip-path hidden/.test((f.a || '') + (f.b || ''))), 'hidden things ignored: ' + JSON.stringify(bad.findings.filter(f => /screen|invisible|clip-path/.test((f.a || '') + (f.b || '')))));
  assert.ok(!bad.findings.some(f => /#bg/.test((f.a || '') + (f.b || ''))), 'big decorative svg ignored');
  assert.deepEqual(good.findings, [], JSON.stringify(good.findings));
  assert.equal(good.ok, true);
});

test('contrastAt: real pixels behind the text', async () => {
  const rep = await runMatrix([{ name: 'contrast', vp: '800x400' }], async t => {
    await t.page.goto(fx('contrast.html'));
    return { black: await t.contrast('#black'), gray: await t.contrast('#gray'), onimg: await t.contrast('#onimg'), alpha: await t.contrast('#alpha') };
  }, { ...Q, concurrency: 1 });
  const v = rep.results[0].value;
  assert.ok(v.black.ratio > 20, 'black/white ~21: ' + v.black.ratio);
  assert.ok(Math.abs(v.gray.median - 4.48) < 0.1, '#777/white 4.48: ' + v.gray.median);
  assert.ok(v.onimg.ratio < 1.6 && v.onimg.best > 15, 'white over a black-white gradient: worst near 1, best near 21: ' + JSON.stringify(v.onimg));
  assert.ok(Math.abs(v.alpha.median - 3.95) < 0.25, 'rgba(0,0,0,.5) on white composites to #808080 (3.95): ' + v.alpha.median);
  assert.equal(v.black.pass, true); assert.equal(v.onimg.pass, false);
});

test('decodePng + shot + contactSheet', async () => {
  const dir = path.join(OUT_DIR, 'selftest');
  const rep = await runMatrix(['#ff0000', '#00ff00', '#0000ff'].map(c => ({ name: 'sw-' + c.slice(1), color: c, vp: '120x80' })), async t => {
    await t.page.setContent(`<body style="margin:0;background:${t.c.color}">`);
    return t.shot('swatch');
  }, { ...Q, concurrency: 3, dir });
  const pngs = rep.results.map(r => r.value);
  const px = decodePng(fs.readFileSync(pngs[0]));
  assert.equal(px.width, 120); assert.equal(px.height, 80);
  assert.deepEqual([...px.data.subarray(0, 4)], [255, 0, 0, 255]);
  assert.match(path.basename(pngs[1]), /^sw-00ff00--swatch\.png$/);
  const out = await contactSheet(pngs, path.join(dir, 'sheet.png'), { thumb: 100, title: 'self test' });
  const sheet = decodePng(fs.readFileSync(out));
  assert.ok(sheet.width >= 300 && sheet.height > 80, `${sheet.width}x${sheet.height}`);
});

test('realTimeConfirm logs a real-time check; t.realTime refuses a virtual case', async () => {
  const before = fs.existsSync(REALTIME_LOG) ? fs.readFileSync(REALTIME_LOG, 'utf8').split('\n').length : 0;
  const v = await realTimeConfirm('selftest/sleep-120', async () => { const s = Date.now(); await new Promise(r => setTimeout(r, 120)); return Date.now() - s; }, { claim: 'a 120ms sleep takes >= 120ms' });
  assert.ok(v >= 115);
  const lines = fs.readFileSync(REALTIME_LOG, 'utf8').trim().split('\n');
  assert.ok(lines.length >= before);
  assert.equal(JSON.parse(lines[lines.length - 1]).name, 'selftest/sleep-120');
  const rep = await runMatrix([{ name: 'v', virtual: true }], async t => t.realTime('x', async () => 1), { ...Q, concurrency: 1 });
  assert.match(rep.results[0].error, /real-time case/);
});

test('bboxAudit on the real prototype: no audit noise on the energy screen, and planted defects are found', async () => {
  const { dusk } = await import('../ptest.mjs');
  const rep = await runMatrix([{ name: 'dusk-390', vp: '390x844', virtual: true }, { name: 'dusk-1440', vp: '1440x900', virtual: true }], async t => {
    await dusk.open(t, { query: '?tod=night' }); await dusk.energy(t); await t.runFor(1200);
    const clean = await t.audit({ root: '#s2' });
    await t.page.addStyleTag({ content: '#infoBtn{min-height:0!important;height:30px!important;padding:0!important} #s2 .kick{font-size:10px!important} #h2e{position:relative!important;top:30px!important}' + (t.c.vp === '390x844' ? ' #s2 .kick{position:relative!important;left:600px!important}' : '') });
    await t.runFor(100);
    return { clean, planted: await t.audit({ root: '#s2' }) };
  }, { ...Q, concurrency: 2 });
  for (const r of rep.results) {
    assert.ok(r.ok, r.error);
    const { clean, planted } = r.value;
    // the prototype is rebuilt by other stages while this suite runs (e.g. 23:11: a card-back stack #sp 5.6 px under the moon),
    // so 'clean' is not asserted to be []; the guard is against audit NOISE (before tuning: 145 findings on this screen)
    if (clean.findings.length) console.log(`  [info] ${r.id}: the current prototype has ${clean.findings.length} audit finding(s): ` + clean.findings.slice(0, 3).map(f => `${f.type} ${f.a} ~ ${f.b || ''} ${f.detail}`).join('; '));
    assert.ok(clean.findings.length <= 6, r.id + ' audit noise on the real energy screen: ' + JSON.stringify(clean.findings.slice(0, 8)));
    const key = f => [f.type, f.a, f.b].join('|'), before = new Set(clean.findings.map(key));
    const has = (type, re) => planted.findings.some(f => f.type === type && !before.has(key(f)) && re.test((f.a || '') + ' ~ ' + (f.b || '')));
    assert.ok(has('smallTarget', /#infoBtn/), r.id + ' small info button');
    assert.ok(has('overlap', /h2#h2e.*span\.fq|span\.fq.*h2#h2e/), r.id + ' h2 pushed onto the question');
    if (r.id === 'dusk-390') assert.ok(has('clippedText', /p\.kick/), 'kick pushed out of its overflow:hidden box');
    else assert.ok(has('smallText', /p\.kick/), 'kick at 10px');
  }
});

test('fastScreenshot is pixel-identical to page.screenshot (viewport, clip, fullPage, dpr 2, scrolled)', async () => {
  const { fastScreenshot } = await import('../ptest.mjs');
  const rep = await runMatrix([{ name: 'dpr1', vp: '800x600' }, { name: 'dpr2', vp: '390x844', dpr: 2 }], async t => {
    await t.page.goto(fx('audit-good.html'));
    await t.page.evaluate(() => { document.body.style.height = '2000px'; document.body.style.background = 'linear-gradient(#123, #fc8)'; window.scrollTo(0, 150); });
    const out = [];
    for (const o of [{}, { clip: { x: 10, y: 40, width: 220, height: 130 } }, { fullPage: true }]) {
      await t.page.evaluate(() => { document.querySelector('h1').style.color = 'red'; }); // a change right before the capture is in it
      // Chrome itself alternates between two rasterizations of this gradient page, in BOTH engines (scratch/x13.mjs; the
      // verifier saw a fast fullPage shot differ from 3 page.screenshot captures in 1 of ~6 runs). So: 3 captures per engine, and
      // some fast capture must equal some page.screenshot capture. On the prototype itself the engines match (verify/v10).
      const As = [], Bs = [];
      for (let k = 0; k < 3; k++) { As.push(decodePng(await fastScreenshot(t.page, o))); Bs.push(decodePng(await t.page.screenshot(o))); }
      const dif = (A, B) => { if (A.data.length !== B.data.length) return Infinity; let n = 0; for (let i = 0; i < A.data.length; i++) if (A.data[i] !== B.data[i]) n++; return n; };
      out.push({ o: Object.keys(o)[0] || 'viewport', a: [As[0].width, As[0].height], b: [Bs[0].width, Bs[0].height], diff: Math.min(...As.flatMap(A => Bs.map(B => dif(A, B)))) });
      await t.page.evaluate(() => { document.querySelector('h1').style.color = ''; });
    }
    return out;
  }, { ...Q, concurrency: 2 });
  for (const r of rep.results) { assert.ok(r.ok, r.error); for (const x of r.value) { assert.deepEqual(x.a, x.b, r.id + ' ' + x.o); assert.equal(x.diff, 0, r.id + ' ' + x.o + ' differs'); } }
});

test('runMatrix: a crashed browser is relaunched, later cases still run', async () => {
  const rep = await runMatrix([{ name: 'killer' }, { name: 'after1' }, { name: 'after2' }], async t => {
    if (t.c.name === 'killer') { await t.browser.close(); throw new Error('closed my browser'); }
    await t.page.setContent('<p>alive</p>'); return t.page.textContent('p');
  }, { ...Q, concurrency: 1, browsers: 1 });
  assert.equal(rep.results[0].ok, false);
  assert.equal(rep.results[1].value, 'alive'); assert.equal(rep.results[2].value, 'alive');
});

test('runMatrix: a heavier case mix on an unstrained machine keeps concurrency (no back-off)', async () => {
  const cases = Array.from({ length: 40 }, (_, i) => ({ name: 'm' + i, ms: i < 16 ? 30 : 600 }));
  const rep = await runMatrix(cases, async t => { await new Promise(r => setTimeout(r, t.c.ms)); return 1; }, { ...Q, concurrency: 4, browsers: 1, strained: () => ({ strained: false, cpuBusyPct: 40, pressureLevel: 1 }) });
  assert.equal(rep.passed, 40);
  assert.deepEqual(rep.backoffs, [], 'the slowdown was the cases, not the machine: ' + JSON.stringify(rep.backoffs));
  assert.equal(rep.finalConcurrency, 4);
  // the real probe (no hook): the run completes, and any back-off it takes names a strained machine
  const real = await runMatrix(cases.map(c => ({ ...c, name: 'r' + c.name })), async t => { await new Promise(r => setTimeout(r, t.c.ms)); return 1; }, { ...Q, concurrency: 4, browsers: 1 });
  assert.equal(real.passed, 40);
  for (const b of real.backoffs) if (b.to != null) assert.ok(b.strain && b.strain.strained && typeof b.strain.cpuBusyPct === 'number', JSON.stringify(b));
});

test('runMatrix: live back-off on a throughput drop when the machine is strained, and restored when backing off does not help', async () => {
  const cases = Array.from({ length: 40 }, (_, i) => ({ name: 'c' + i, ms: i < 16 ? 30 : 600 }));
  const rep = await runMatrix(cases, async t => { await new Promise(r => setTimeout(r, t.c.ms)); return 1; }, { ...Q, concurrency: 4, browsers: 1, strained: () => ({ strained: true, cpuBusyPct: 97, pressureLevel: 1 }) });
  assert.equal(rep.passed, 40);
  assert.ok(rep.backoffs.some(b => b.to === 3), 'backed off 4 -> 3: ' + JSON.stringify(rep.backoffs));
  assert.ok(rep.backoffs.some(b => b.restored === 4), 'restored to 4 when 3 was no faster: ' + JSON.stringify(rep.backoffs));
  const steady = await runMatrix(Array.from({ length: 24 }, (_, i) => ({ name: 's' + i })), async () => { await new Promise(r => setTimeout(r, 100)); }, { ...Q, concurrency: 4, browsers: 1 });
  assert.deepEqual(steady.backoffs, [], 'no back-off on a steady run');
});

test('freezeAt under virtual time advances the clock, so JS-timer state matches real playback; seek:true does not', async () => {
  const page = `<style>#a{width:10px;height:10px}</style><div id=a class=rest></div><script>
    window.go = () => { document.getElementById('a').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100px)' }], { duration: 1000, fill: 'forwards' });
      setTimeout(() => { document.getElementById('a').className = 'wink'; }, 65); };</script>`;
  const rep = await runMatrix([{ name: 'fz-virtual', virtual: true }], async t => {
    await t.page.goto('data:text/html,' + encodeURIComponent(page));
    const tx = () => t.page.evaluate(() => ({ x: new DOMMatrix(getComputedStyle(document.getElementById('a')).transform).m41, cls: document.getElementById('a').className, v: performance.now() }));
    await t.mark(); const v0 = (await tx()).v;
    await t.page.evaluate(() => window.go());
    const f1 = await t.freezeAt(300); const s1 = await tx();
    const f2 = await t.freezeAt(600); const s2 = await tx();
    let late = null; try { await t.freezeAt(100); } catch (e) { late = e.message; }
    // pure seek (the old behaviour): CSS/WAAPI moves, JS timers do not
    await t.mark(); await t.page.evaluate(() => { document.getElementById('a').className = 'rest'; window.go(); });
    const f3 = await t.freezeAt(300, { seek: true, onlyNew: true }); const s3 = await tx();
    return { v0, f1: f1.advancedMs, s1, f2: f2.advancedMs, s2, late, f3: f3.advancedMs, s3, n1: f1.length };
  }, { ...Q, concurrency: 1 });
  const r = rep.results[0]; assert.ok(r.ok, r.error); const v = r.value;
  assert.equal(v.f1, 300); assert.equal(v.s1.v - v.v0, 300, 'clock moved 300'); assert.equal(v.s1.cls, 'wink', 'the 65ms setTimeout ran');
  assert.ok(Math.abs(v.s1.x - 30) < 0.6, 'animation at 300/1000: ' + v.s1.x); assert.equal(v.n1, 1);
  assert.equal(v.f2, 300, 'second freeze advanced the rest'); assert.ok(Math.abs(v.s2.x - 60) < 0.6, 'thawed and moved on to 600: ' + v.s2.x);
  assert.match(v.late, /already .* past the last mark/);
  assert.equal(v.f3, 0); assert.equal(v.s3.cls, 'rest', 'seek:true leaves JS timers alone'); assert.ok(Math.abs(v.s3.x - 30) < 0.6, 'seeked: ' + v.s3.x);
});

test('virtual time: an app error in a timer / rAF is a page error (as in real time) and the clock still runs the whole span', async () => {
  const fn = async t => {
    await t.page.setContent('<p>x</p>');
    const d0 = await t.page.evaluate(() => { setTimeout(() => { throw new Error('app timer error'); }, 100); requestAnimationFrame(() => { throw new Error('app raf error'); }); window.after = 0; setTimeout(() => { window.after = 1; }, 200); return Date.now(); });
    await t.runFor(300); if (!t.page.__ptestVirtual) await t.page.waitForTimeout(50);
    return { reached: true, after: await t.page.evaluate(() => window.after), dt: (await t.page.evaluate(() => Date.now())) - d0, pageErrors: [...t.errors.pageErrors] };
  };
  const cases = [{ name: 'virtual', virtual: true }, { name: 'real', virtual: false }];
  const tol = await runMatrix(cases, fn, { ...Q, concurrency: 2, failOnPageError: false });
  for (const r of tol.results) {
    assert.ok(r.ok, r.id + ' ' + r.error); assert.equal(r.value.after, 1, r.id + ' later timer ran');
    assert.ok(r.value.pageErrors.some(e => e === 'app timer error'), r.id + ' ' + JSON.stringify(r.value.pageErrors));
  }
  assert.equal(tol.results[0].value.dt, 300, 'virtual clock ran the full 300ms');
  const strict = await runMatrix(cases, fn, { ...Q, concurrency: 2 });
  for (const r of strict.results) { assert.equal(r.ok, false); assert.match(r.error, /page error: app (timer|raf) error/); assert.equal(r.value.reached, true, 'the case kept going'); }
});

test('seed makes Math.random repeatable; case.timeout overrides opts.timeout; wall time is measured before browser close', async () => {
  const rep = await runMatrix([{ name: 's1a', seed: 1 }, { name: 's1b', seed: 1 }, { name: 's2', seed: 2 }, { name: 'none' }, { name: 'short', timeout: 300, ms: 2000 }, { name: 'long', ms: 600 }], async t => {
    if (t.c.ms) { await new Promise(r => setTimeout(r, t.c.ms)); return 'slept'; }
    await t.page.goto('data:text/html,<script>window.R=[Math.random(),Math.random(),Math.random()]</script>');
    return t.page.evaluate(() => window.R);
  }, { ...Q, concurrency: 6, timeout: 1500 });
  const by = Object.fromEntries(rep.results.map(r => [r.id, r]));
  assert.deepEqual(by.s1a.value, by.s1b.value); assert.notDeepEqual(by.s1a.value, by.s2.value); assert.notDeepEqual(by.none.value, by.s1a.value);
  assert.equal(by.short.ok, false); assert.match(by.short.error, /timeout after 300ms/); assert.equal(by.long.ok, true);
  assert.ok(rep.wallMs <= rep.launchMs + rep.runMs + 5, JSON.stringify({ wall: rep.wallMs, launch: rep.launchMs, run: rep.runMs, close: rep.closeMs }));
  assert.ok(rep.closeMs <= 2600, 'close wait capped: ' + rep.closeMs);
});

test('virtual time: SVG <animate> (SMIL) and document.timeline.currentTime follow the fake clock', async () => {
  const rep = await runMatrix([{ name: 'smil', virtual: true }], async t => {
    await t.page.goto('data:text/html,' + encodeURIComponent('<svg width=50 height=50><rect id=r width=50 height=50 fill=red><animate attributeName="opacity" from="1" to="0" dur="1s" fill="freeze"/></rect></svg>'));
    const tl0 = await t.page.evaluate(() => document.timeline.currentTime);
    await t.runFor(500);
    const half = await t.page.evaluate(() => ({ op: +getComputedStyle(document.getElementById('r')).opacity, tl: document.timeline.currentTime }));
    await t.runFor(5000);
    return { tl0, half, end: await t.page.evaluate(() => +getComputedStyle(document.getElementById('r')).opacity) };
  }, { ...Q, concurrency: 1 });
  const r = rep.results[0]; assert.ok(r.ok, r.error); const v = r.value;
  assert.ok(Math.abs(v.half.op - 0.5) <= 0.04, 'SMIL fade at 500/1000 virtual: ' + v.half.op);
  assert.equal(Math.round(v.half.tl - v.tl0), 500, 'document.timeline advanced 500');
  assert.equal(v.end, 0, 'SMIL finished');
});

test('runSuites: several suites share one pool, keep their own ids, dirs, timeouts and after()', async () => {
  const { runSuites } = await import('../ptest.mjs');
  const dA = path.join(OUT_DIR, 'selftest-suiteA');
  const rep = await runSuites([
    { name: 'sa', cases: [{ vp: '200x100' }, { vp: '300x100' }], fn: async t => { await t.page.setContent('<p>a</p>'); return t.shot('x'); }, opts: { dir: dA }, after: sub => sub.results.map(r => r.id) },
    { name: 'sb', cases: [{ name: 'slow', ms: 800 }, { name: 'quick', ms: 1 }], fn: async t => { await new Promise(r => setTimeout(r, t.c.ms)); return t.c.ms; }, opts: { timeout: 400 } },
  ], { ...Q, concurrency: 4 });
  assert.equal(rep.cases, 4);
  assert.deepEqual(rep.suites.sa.afterValue, ['sa-200x100', 'sa-300x100']);
  assert.ok(rep.results[0].value.startsWith(dA + path.sep), rep.results[0].value);
  assert.equal(rep.suites.sb.failed, 1); assert.match(rep.suites.sb.results[0].error, /timeout after 400ms/); assert.equal(rep.suites.sb.results[1].ok, true);
  assert.equal(rep.suites.sa.ok, true);
});

test('installVirtualTime survives a slow machine: a 1.5 s stall before pauseAt still starts exactly at the set time', async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await (await b.newContext()).newPage();
    const orig = page.clock.pauseAt.bind(page.clock);
    page.clock.pauseAt = async t => { await new Promise(r => setTimeout(r, 1500)); return orig(t); }; // what load 200 did
    await installVirtualTime(page, { time: '2026-10-27T23:30:00Z' });
    await page.goto('data:text/html,<p>x</p>');
    assert.equal(await page.evaluate(() => Date.now()), Date.parse('2026-10-27T23:30:00Z'));
  } finally { await b.close(); }
});
