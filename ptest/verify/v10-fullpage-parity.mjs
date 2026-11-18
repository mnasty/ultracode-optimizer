// V10: fastScreenshot vs page.screenshot, fullPage, on the prototype (virtual time, so nothing moves between shots)
import fs from 'node:fs';
import { runMatrix, dusk, fastScreenshot, decodePng } from '../ptest.mjs';
const rep = await runMatrix(['390x844', '1440x900'].flatMap(vp => [1, 2].flatMap(dpr => [0, 6].map(step => ({ vp, dpr, step, virtual: true })))), async t => {
  await dusk.open(t); await dusk.jump(t, t.c.step, { settle: 2500 });
  await t.page.evaluate(() => window.scrollTo(0, 120)); await t.frames(2);
  const out = {};
  for (const [k, o] of [['viewport', {}], ['fullPage', { fullPage: true }]]) {
    const A = decodePng(await fastScreenshot(t.page, o)); const B = decodePng(await t.page.screenshot(o)); const B2 = decodePng(await t.page.screenshot(o));
    const dif = (X, Y) => { if (X.width !== Y.width || X.height !== Y.height) return `size ${X.width}x${X.height} vs ${Y.width}x${Y.height}`; let n = 0, y0 = 1e9, y1 = -1; for (let i = 0; i < X.data.length; i += 4) if (Math.abs(X.data[i] - Y.data[i]) + Math.abs(X.data[i + 1] - Y.data[i + 1]) + Math.abs(X.data[i + 2] - Y.data[i + 2]) > 30) { n++; const y = Math.floor(i / 4 / X.width); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return n ? `${(100 * n / (X.width * X.height)).toFixed(2)}% px differ, rows ${y0}-${y1}` : 0; };
    out[k] = { fastVsPw: dif(A, B), pwVsPw: dif(B, B2), size: `${A.width}x${A.height}` };
  }
  return out;
}, { name: 'v10-fullpage', quiet: true });
for (const r of rep.results) console.log(r.id, r.ok ? JSON.stringify(r.value) : r.error);
process.exit(0);
