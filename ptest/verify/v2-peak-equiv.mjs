// V2: action peaks. REAL playback paused at ~in+peak/2 vs VIRTUAL (A) README/example-c pattern: playAct + freezeAt(at) without
// advancing the clock, and (B) playAct + t.runFor(at) + freezeAt(null). Pre-existing animations are paused at currentTime 0 in
// every mode so the idle bob/blinks are identical. Pixel diff on the rig clip + the JS-driven face state.
import fs from 'node:fs'; import path from 'node:path';
import { runMatrix, dusk, decodePng, contactSheet } from '../ptest.mjs';
const ACTS = (process.env.ACTS || 'Examining sextant...,Sipping tea..,Channeling cosmic energy...,Tuning crystal vibrations...,Warding off evil..,Aligning the stars...,Hitting the blunt..,Lighting incense..').split(',');
const VPS = (process.env.VPS || '390x844').split(',');
const DWELL = 3000;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out-v2');
const STATE = () => { const rig = document.querySelector('#mainRig'); const on = k => [...rig.querySelectorAll('.fv-' + k + '.on')].map(g => g.dataset.v).join('|');
  return { act: rig.dataset.act, aphase: rig.dataset.aphase, eyes: on('e'), mouth: on('m'), brows: on('b') }; };
async function setup(t) {
  await dusk.open(t); await dusk.energy(t); await t.runFor(1800);
  // baseline: every animation alive now paused at 0 (identical in every mode), then remembered
  await t.page.evaluate(() => { document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }); window.__ptestMarked = new WeakSet(document.getAnimations()); });
  return t.page.evaluate(() => { const r = document.querySelector('#mainRig').getBoundingClientRect(), c = document.querySelector('#eCap').getBoundingClientRect();
    const top = Math.max(0, Math.min(r.top, c.top) - 8); return { x: Math.max(0, Math.round(r.left - 70)), y: Math.round(top), width: Math.round(Math.min(innerWidth - Math.max(0, r.left - 70), r.width + 140)), height: Math.round(r.bottom - top + 30) }; });
}
const play = (t, msg) => t.page.evaluate(([msg, dwell]) => { const d = window.__dusk; d.setCap(msg.toLowerCase()); d.playAct(d.main, msg, dwell); clearTimeout(d.main._leadT); window.__actStart = performance.now(); return d.actTiming(d.ACT_OF[msg], dwell); }, [msg, DWELL]);
async function realCase(t) {
  return t.realTime('peak-' + t.c.msg, async () => {
    const clip = await setup(t);
    const T = await play(t, t.c.msg); const at = T.in + T.peak / 2;
    const e = await t.page.evaluate(at => new Promise(res => { const f = () => { const e = performance.now() - window.__actStart; if (e >= at - 8) { document.getAnimations().forEach(a => a.pause()); res(+e.toFixed(1)); } else requestAnimationFrame(f); }; requestAnimationFrame(f); }), at);
    const st = await t.page.evaluate(STATE);
    const png = await t.shot('real', { clip, dir: OUT });
    return { at, e, st, png, clip };
  }, { claim: 'real playback paused at in+peak/2 for pixel comparison' });
}
async function virtCase(t, at, mode) {
  const clip = await setup(t);
  await play(t, t.c.msg);
  if (mode === 'A') await t.freezeAt(at, { onlyNew: true });
  else { await t.runFor(at); await t.freezeAt(null); }
  const st = await t.page.evaluate(STATE);
  const png = await t.shot('virt' + mode, { clip, dir: OUT });
  return { at, st, png, clip };
}
const slugm = m => m.replace(/\W+/g, '').slice(0, 10).toLowerCase();
// phase 1: real
const realCases = VPS.flatMap(vp => ACTS.map(msg => ({ name: `real-${vp}-${slugm(msg)}`, vp, msg, virtual: false })));
const r1 = await runMatrix(realCases, realCase, { name: 'v2-peak-real', timeout: 120000 });
const E = Object.fromEntries(r1.results.filter(r => r.ok).map(r => [r.case.vp + '|' + r.case.msg, r.value]));
// phase 2: virtual A and B, seeked to the real elapsed time
const vCases = VPS.flatMap(vp => ACTS.flatMap(msg => E[vp + '|' + msg] ? ['A', 'B'].map(mode => ({ name: `v${mode}-${vp}-${slugm(msg)}`, vp, msg, mode, virtual: true })) : []));
const r2 = await runMatrix(vCases, t => virtCase(t, Math.round(E[t.c.vp + '|' + t.c.msg].e), t.c.mode), { name: 'v2-peak-virt', timeout: 60000 });
const diff = (p, q) => { const A = decodePng(fs.readFileSync(p)), B = decodePng(fs.readFileSync(q)); if (A.width !== B.width || A.height !== B.height) return { sizeMismatch: [A.width, A.height, B.width, B.height] };
  let n = 0, big = 0, sum = 0; for (let i = 0; i < A.data.length; i += 4) { const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2])); sum += d; if (d > 24) n++; if (d > 96) big++; }
  const px = A.width * A.height; return { pctOver24: +(100 * n / px).toFixed(2), pctOver96: +(100 * big / px).toFixed(2), meanDiff: +(sum / px).toFixed(2) }; };
const rows = [], sheet = [];
for (const vp of VPS) for (const msg of ACTS) {
  const re = E[vp + '|' + msg]; if (!re) { rows.push({ vp, msg, error: 'real failed' }); continue; }
  const g = m => (r2.results.find(r => r.case.vp === vp && r.case.msg === msg && r.case.mode === m) || {}).value;
  const A = g('A'), B = g('B');
  rows.push({ vp, msg, at: re.at, realElapsed: re.e, real: re.st, A: A && A.st, B: B && B.st, diffA: A && diff(re.png, A.png), diffB: B && diff(re.png, B.png) });
  sheet.push({ path: re.png, label: `${slugm(msg)} REAL @${re.e} ${re.st.eyes}/${re.st.mouth}` }); if (A) sheet.push({ path: A.png, label: `A freezeAt eyes ${A.st.eyes}/${A.st.mouth}` }); if (B) sheet.push({ path: B.png, label: `B runFor eyes ${B.st.eyes}/${B.st.mouth}` });
}
for (const r of rows) console.log(r.error ? `${r.vp} ${r.msg}: ${r.error}` : `${r.vp} ${slugm(r.msg).padEnd(11)} at ${r.at} real@${r.realElapsed} | real ${r.real.eyes}/${r.real.mouth}/${r.real.brows} A ${r.A && `${r.A.eyes}/${r.A.mouth}/${r.A.brows}`} B ${r.B && `${r.B.eyes}/${r.B.mouth}/${r.B.brows}`} | diff A ${JSON.stringify(r.diffA)} B ${JSON.stringify(r.diffB)}`);
fs.writeFileSync(path.join(OUT, 'v2.json'), JSON.stringify(rows, null, 1));
console.log('sheet', await contactSheet(sheet, path.join(OUT, 'sheet-v2.png'), { cols: 6, thumb: 200, title: 'real vs freezeAt-only (A) vs runFor+freeze (B)' }));
process.exit(0);
