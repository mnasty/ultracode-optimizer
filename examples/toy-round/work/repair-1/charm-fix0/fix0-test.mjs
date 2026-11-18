// LOOK-1: h1 wraps balanced at 360 (not 'toy' alone), one line at 1440. FILE=<built html> node fix0-test.mjs
import { runMatrix, cross } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
const FILE = process.env.FILE; if (!FILE) { console.error('set FILE'); process.exit(2); }
const rep = await runMatrix(cross({ vp: ['360x640', '1440x900'] }).map(c => ({ ...c, virtual: true })), async t => {
  await t.page.goto('file://' + FILE); await t.runFor(200);
  const g = await t.page.evaluate(() => {
    const h = document.getElementById('title'), r = document.createRange(), tn = h.firstChild, words = [];
    let i = 0; for (const w of tn.textContent.split(' ')) { r.setStart(tn, i); r.setEnd(tn, i + w.length); words.push([w, Math.round(r.getBoundingClientRect().top)]); i += w.length + 1; }
    const lines = {}; for (const [w, top] of words) (lines[top] ||= []).push(w);
    return { wrap: getComputedStyle(h).textWrap || getComputedStyle(h).textWrapStyle, lines: Object.values(lines).map(l => l.join(' ')), hs: document.documentElement.scrollWidth - innerWidth };
  });
  t.check('text-wrap balance', /balance/.test(g.wrap), g.wrap);
  if (t.c.vp === '360x640') t.check('two lines, last line not a lone word', g.lines.length === 2 && g.lines[1].split(' ').length > 1, g.lines);
  else t.check('one line at 1440', g.lines.length === 1, g.lines);
  t.check('no h-scroll', g.hs <= 0, g.hs);
  const hb = await t.page.$eval('#title', e => { const r = e.getBoundingClientRect(); return { x: Math.max(0, r.x - 8), y: 0, width: r.width + 16, height: r.bottom + 8 }; });
  await t.shot('h1', { clip: hb });
  return g;
}, { name: 'fix0', dir: new URL('./out', import.meta.url).pathname, quiet: true });
console.log(rep.results.map(r => (r.ok ? 'ok ' : 'FAIL ') + r.id + ' ' + JSON.stringify(r.value) + ' ' + (r.checks || []).filter(k => !k.ok).map(k => k.name + ':' + JSON.stringify(k.detail)).join(', ')).join('\n'));
process.exit(rep.ok ? 0 : 1);
