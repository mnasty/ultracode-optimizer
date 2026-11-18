// V9 (usability): a new test written from README.md only. During a hold, at each of the first three lines (mid-peak), the
// caption text has enough contrast against the real sky behind it, the caption does not overlap anything, and a contact sheet.
import path from 'node:path';
import { runMatrix, cross, dusk, formatAudit, contactSheet } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';

const cases = cross({ vp: ['360x640', '390x844', '1024x768', '1920x1080'] }, { tod: ['night', 'evening'] }).map(c => ({ ...c, virtual: true }));
const rep = await runMatrix(cases, async t => {
  await dusk.open(t, { query: '?tod=' + t.c.tod });
  await dusk.energy(t);
  await dusk.press(t);
  const out = [];
  for (let k = 0; k < 3; k++) {
    await t.runFor(k === 0 ? 1500 : 3000);                                     // mid-line (each line ~3s)
    const ct = await t.contrast('#eCapT');
    const a = await t.audit({ root: '#s2', pairsSkip: [['#eCap', '#eCap .cap-plate']] });
    t.check(`line ${k + 1} contrast`, ct.pass, ct);
    t.check(`line ${k + 1} no overlaps`, !a.counts.overlap, formatAudit(a));
    out.push({ ratio: ct.ratio, need: ct.need, findings: a.findings.length, png: await t.shot(`line${k + 1}`) });
  }
  await dusk.release(t);
  return out;
}, { name: 'v9-caption' });
for (const r of rep.results) console.log(r.id, r.value ? r.value.map(v => `${v.ratio}/${v.need} f${v.findings}`).join('  ') : r.error);
console.log(await contactSheet(rep.results.filter(r => r.value).flatMap(r => r.value.map((v, k) => ({ path: v.png, label: `${r.id} l${k + 1} ${v.ratio}` }))), path.join(rep.dir, 'sheet.png'), { thumb: 180, cols: 6 }));
process.exit(rep.ok ? 0 : 1);
