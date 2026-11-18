// t.shot(label, { evidence: true }): a JPEG at CSS-pixel scale with the right pixels, on every capture path
// (dpr 1 CDP: viewport scrolled, clip, fullPage; dpr 2 and engine 'playwright': page.screenshot), contactSheet takes the .jpg files,
// and PTEST_SHOTS=full turns it back into the full-size PNG.
// node --test /Users/mick/dev/web/uc-optimizer/ptest/test/evidence-shot.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runMatrix, decodePng, contactSheet, OUT_DIR } from '../ptest.mjs';

const DIR = path.join(OUT_DIR, 'selftest-evidence');
// red for page y 0..300, blue below, 2000 px tall; scrolled to y 150
const PAGE = '<body style="margin:0;height:2000px;background:linear-gradient(#f00 0 300px,#00f 300px)">';
const setup = async t => { await t.page.setContent(PAGE); await t.page.evaluate(() => window.scrollTo(0, 150)); };

function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'JPEG magic');
  for (let i = 2; i < buf.length;) {
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  throw new Error('no SOF marker');
}
// decode in Chrome, return [r,g,b] at each CSS point
const pixels = (page, file, pts) => page.evaluate(async ({ b64, pts }) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  return pts.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)]);
}, { b64: fs.readFileSync(file).toString('base64'), pts });
const RED = p => p[0] > 200 && p[1] < 60 && p[2] < 60, BLUE = p => p[2] > 200 && p[0] < 60 && p[1] < 60;

const CASES = [
  // [name, vp, dpr, opts, expected CSS size, [[x,y,colour]...]]
  ['dpr1-viewport', '800x600', 1, {}, [800, 600], [[5, 5, RED], [5, 400, BLUE]]],
  ['dpr1-clip', '800x600', 1, { clip: { x: 10, y: 100, width: 200, height: 100 } }, [200, 100], [[5, 10, RED], [5, 90, BLUE]]],
  ['dpr1-full', '800x600', 1, { fullPage: true }, [800, 2000], [[5, 5, RED], [5, 1000, BLUE]]],
  ['dpr2-viewport', '390x844', 2, {}, [390, 844], [[5, 5, RED], [5, 400, BLUE]]],
  ['dpr2-clip', '390x844', 2, { clip: { x: 10, y: 100, width: 200, height: 100 } }, [200, 100], [[5, 10, RED], [5, 90, BLUE]]],
  ['dpr2-full', '390x844', 2, { fullPage: true }, [390, 2000], [[5, 5, RED], [5, 1000, BLUE]]],
  ['playwright-engine', '800x600', 1, { engine: 'playwright' }, [800, 600], [[5, 5, RED], [5, 400, BLUE]]],
];

test('evidence shots: JPEG at CSS scale with the right pixels on every capture path; contactSheet takes them', async () => {
  const rep = await runMatrix(CASES.map(([name, vp, dpr, o, size, pts]) => ({ name, vp, dpr, o, size, pts })), async t => {
    await setup(t);
    const p = await t.shot('ev', { evidence: true, ...t.c.o });
    return { p, size: jpegSize(fs.readFileSync(p)), px: await pixels(t.page, p, t.c.pts.map(([x, y]) => [x, y])) };
  }, { quiet: true, dir: DIR });
  for (const [i, r] of rep.results.entries()) {
    assert.ok(r.ok, r.id + ': ' + r.error);
    const c = rep.results.length && CASES[i];
    assert.match(path.basename(r.value.p), /--ev\.jpg$/, r.id);
    assert.deepEqual(r.value.size, c[4], r.id + ' size');
    c[5].forEach(([x, y, want], k) => assert.ok(want(r.value.px[k]), `${r.id} pixel ${x},${y} = ${r.value.px[k]}`));
  }
  assert.equal(rep.pageErrors?.length || 0, 0);
  const sheet = await contactSheet(rep.results.map(r => r.value.p), path.join(DIR, 'sheet.png'), { thumb: 100 });
  const s = decodePng(fs.readFileSync(sheet));
  assert.ok(s.width >= 300 && s.height > 50, `${s.width}x${s.height}`);
});

test('PTEST_SHOTS=full: an evidence shot is the full-size PNG again', async () => {
  process.env.PTEST_SHOTS = 'full';
  try {
    const rep = await runMatrix([{ name: 'full-dpr2', vp: '390x844', dpr: 2 }], async t => { await setup(t); return t.shot('ev', { evidence: true }); }, { quiet: true, dir: DIR });
    const r = rep.results[0]; assert.ok(r.ok, r.error);
    assert.match(path.basename(r.value), /--ev\.png$/);
    const px = decodePng(fs.readFileSync(r.value));
    assert.deepEqual([px.width, px.height], [780, 1688], 'device pixels');
  } finally { delete process.env.PTEST_SHOTS; }
});
