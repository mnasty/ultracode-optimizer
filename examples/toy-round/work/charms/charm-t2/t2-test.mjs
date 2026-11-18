// T2: .cta >= 44x44 at every viewport; look otherwise unchanged (same padding/border/colors/font). FILE=<built html> node t2-test.mjs
import { runMatrix, cross, VIEWPORTS_11 } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
const FILE = process.env.FILE; if (!FILE) { console.error('set FILE'); process.exit(2); }
const BASE = '/Users/mick/dev/web/uc-optimizer/examples/toy-round/base.html';
const rep = await runMatrix(cross({ vp: VIEWPORTS_11 }, { build: ['new', 'base'] }).map(c => ({ ...c, virtual: true })), async t => {
  await t.page.goto('file://' + (t.c.build === 'new' ? FILE : BASE)); await t.runFor(200);
  const g = await t.page.evaluate(() => { const e = document.getElementById('go'), b = e.getBoundingClientRect(), s = getComputedStyle(e);
    return { w: b.width, h: b.height, x: b.x, y: b.y, pad: s.padding, border: s.border, color: s.color, bg: s.backgroundColor, font: s.font, text: e.textContent,
      listTop: document.getElementById('list').getBoundingClientRect().top, hs: document.documentElement.scrollWidth - innerWidth }; });
  if (t.c.build === 'new') {
    t.check('>= 44x44', g.w >= 44 && g.h >= 44, [g.w, g.h]);
    t.check('look unchanged (padding/border/colors/font/text)', g.pad === '6px 10px' && g.border === '1px solid rgb(242, 234, 211)' && g.color === 'rgb(242, 234, 211)' && g.bg === 'rgba(0, 0, 0, 0)' && g.text === 'start', JSON.stringify(g));
    t.check('no h-scroll', g.hs <= 0, g.hs);
  }
  const b = await t.page.$eval('#go', e => { const r = e.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 }; });
  await t.shot('cta', { clip: b });
  return g;
}, { name: 't2', dir: new URL('./out/t2', import.meta.url).pathname, quiet: true });
console.log(rep.results.map(r => (r.ok ? 'ok ' : 'FAIL ') + r.id + ' ' + JSON.stringify({ w: r.value?.w, h: r.value?.h, y: r.value?.y, listTop: r.value?.listTop }) + ' ' + (r.checks || []).filter(k => !k.ok).map(k => k.name + ':' + k.detail).join(', ')).join('\n'));
process.exit(rep.ok ? 0 : 1);
