// ensureViewport: a page that lays out smaller than its viewport (seen under load: 87 px short) is put back before any capture,
// keeping touch/mobile/dpr; a page that cannot be put back makes the capture throw; a page at its size is left alone.
// The shrink is simulated with a device-metrics override from a second CDP session (the page then lays out 87 px short).
// node --test /Users/mick/dev/web/uc-optimizer/ptest/test/viewport-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runMatrix, fastScreenshot, ensureViewport, decodePng, OUT_DIR } from '../ptest.mjs';

const DIR = path.join(OUT_DIR, 'selftest-viewport');
const PAGE = '<meta name="viewport" content="width=device-width"><body style="margin:0;height:3000px;background:linear-gradient(#f00,#00f)">';
const shrink = async page => { const vp = page.viewportSize(), s = await page.context().newCDPSession(page);
  await s.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height - 87, deviceScaleFactor: 1, mobile: false }); };
const jpegSize = buf => { for (let i = 2; i < buf.length;) { const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)]; i += 2 + buf.readUInt16BE(i + 2); } return null; };
const pngSize = b => { const p = decodePng(b); return [p.width, p.height]; };

test('a page smaller than its viewport is put back before fastScreenshot and t.shot (desktop, dpr 2, phone)', async () => {
  const rep = await runMatrix([
    { name: 'desk', vp: '1440x900', want: [1440, 900] },
    { name: 'dpr2', vp: '390x844', dpr: 2, want: [780, 1688] },
    { name: 'phone', vp: '390x844', touch: true, isMobile: true, want: [390, 844] },
  ], async t => {
    const { page } = t; await page.setContent(PAGE);
    const coarse0 = await page.evaluate(() => matchMedia('(pointer:coarse)').matches);
    await shrink(page); const shrunk = await page.evaluate(() => innerHeight);
    const fast = pngSize(await fastScreenshot(page));
    await shrink(page); await ensureViewport(page); // a test that reads positions before it captures calls the guard first (b11-sky-z8lib discMeasure)
    const after = await page.evaluate(() => [innerWidth, innerHeight, matchMedia('(pointer:coarse)').matches]); // right after the put-back
    await shrink(page); const ev = await t.shot('ev', { evidence: true }); // (the simulating session may re-assert itself later: only the capture counts)
    return { coarse0, shrunk, fast, ev, evSize: jpegSize(fs.readFileSync(ev)), after };
  }, { quiet: true, dir: DIR });
  for (const [i, r] of rep.results.entries()) {
    assert.ok(r.ok, r.id + ': ' + r.error);
    const v = r.value, vp = rep.results[i] && ['1440x900', '390x844', '390x844'][i].split('x').map(Number);
    assert.equal(v.shrunk, vp[1] - 87, r.id + ': the simulation shrank the page');
    assert.deepEqual(v.fast, [[1440, 900], [780, 1688], [390, 844]][i], r.id + ' fastScreenshot size');
    assert.match(path.basename(v.ev), /--ev\.jpg$/);
    assert.deepEqual(v.evSize, vp, r.id + ' evidence jpeg at CSS size');
    assert.deepEqual(v.after.slice(0, 2), vp, r.id + ': the page is back at its viewport');
    assert.equal(v.after[2], v.coarse0, r.id + ': touch emulation kept');
  }
});

test('a page at its viewport is left alone; one that cannot be put back makes the capture throw', async () => {
  const rep = await runMatrix([{ name: 'ok', vp: '800x600' }, { name: 'stuck', vp: '800x600' }], async t => {
    const { page, c } = t; await page.setContent(PAGE);
    const orig = page.setViewportSize.bind(page); let resizes = 0;
    page.setViewportSize = async s => { resizes++; if (c.name !== 'stuck') return orig(s); }; // stuck: the resize never applies
    if (c.name === 'stuck') await shrink(page);
    let size = null, err = null;
    try { size = pngSize(await fastScreenshot(page)); } catch (e) { err = String(e.message); }
    return { resizes, size, err };
  }, { quiet: true, dir: DIR });
  const [ok, stuck] = rep.results.map(r => r.value);
  assert.deepEqual(ok, { resizes: 0, size: [800, 600], err: null });
  assert.equal(stuck.size, null);
  assert.match(stuck.err, /the page is 800x513, smaller than its viewport 800x600, after a resize to put it back/);
});
