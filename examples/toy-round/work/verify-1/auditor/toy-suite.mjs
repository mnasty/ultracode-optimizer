// the toy round's full regression (the auditor runs it): FILE=<built html> node toy-suite.mjs
import { runMatrix, cross } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
const FILE = process.env.FILE; if (!FILE) { console.error('set FILE'); process.exit(2); }
const rep = await runMatrix(cross({ vp: ['360x640', '1440x900'] }).map(c => ({ ...c, virtual: true })), async t => {
  await t.page.goto('file://' + FILE); await t.runFor(200);
  const g = await t.page.evaluate(() => { const b = document.getElementById('go').getBoundingClientRect();
    return { h1: document.getElementById('title').textContent, bw: b.width, bh: b.height, count: document.getElementById('count').textContent, hs: document.documentElement.scrollWidth - innerWidth }; });
  t.check('T1 lowercase heading', g.h1 === g.h1.toLowerCase() && /welcome to the toy/.test(g.h1), g.h1);
  t.check('T2 button >= 44x44', g.bw >= 44 && g.bh >= 44, [g.bw, g.bh]);
  t.check('T3 count on load', g.count === '3 items', g.count);
  await t.page.click('#go'); const after = await t.page.$eval('#count', e => e.textContent);
  t.check('T3 start still works', after === 'started', after);
  t.check('no h-scroll', g.hs <= 0, g.hs);
  return g;
}, { name: 'toy-suite', dir: new URL('./out/suite', import.meta.url).pathname, quiet: true });
console.log(rep.results.map(r => (r.ok ? 'ok ' : 'FAIL ') + r.id + ' ' + (r.checks || []).filter(k => !k.ok).map(k => k.name).join(', ')).join('\n'));
import("fs").then(fs => { fs.writeFileSync(new URL("./suite-report.json", import.meta.url), JSON.stringify(rep, null, 1)); process.exit(rep.ok ? 0 : 1); });
