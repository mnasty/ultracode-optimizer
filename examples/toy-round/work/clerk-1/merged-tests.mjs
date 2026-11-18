// clerk-1: the three charms' targeted tests (t1, t2, t3; bodies copied verbatim) as suites in ONE ptest pool.
// FILE=<built html> node merged-tests.mjs
import { runSuites, cross, VIEWPORTS_11 } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const FILE = process.env.FILE; if (!FILE) { console.error('set FILE'); process.exit(2); }
const OUT = new URL('./out', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const BASE = '/Users/mick/dev/web/uc-optimizer/examples/toy-round/base.html';
const src = readFileSync(FILE, 'utf8');
const VAR = OUT + '/t3-variant.html';
writeFileSync(VAR, src.replace('<li>three</li>', '<li>three</li><li>four</li>'));

const t1 = { name: 't1', opts: { dir: OUT + '/t1' }, cases: ['360x640', '1440x900'].map(vp => ({ vp, virtual: true })), fn: async t => {
  await t.page.goto('file://' + FILE); await t.runFor(200);
  const g = await t.page.evaluate(() => ({ h1: document.getElementById('title').textContent, lede: document.getElementById('lede').textContent,
    btn: document.getElementById('go').textContent, hs: document.documentElement.scrollWidth - innerWidth }));
  t.check('T1 h1 exact lowercase words', g.h1 === 'welcome to the toy', g.h1);
  t.check('other text unchanged', g.lede === "a tiny page for testing the mayor's round engine." && g.btn === 'start', g);
  t.check('no h-scroll', g.hs <= 0, g.hs);
  await t.shot('h1', { clip: { x: 0, y: 0, width: Math.min(700, +t.c.vp.split('x')[0]), height: 120 } });
  return g;
} };

const t2 = { name: 't2', opts: { dir: OUT + '/t2' }, cases: cross({ vp: VIEWPORTS_11 }, { build: ['new', 'base'] }).map(c => ({ ...c, virtual: true })), fn: async t => {
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
} };

const t3 = { name: 't3', opts: { dir: OUT + '/t3' }, cases: [ { vp: '360x640', variant: 'built', file: FILE, want: '3 items' }, { vp: '360x640', variant: 'four', file: VAR, want: '4 items' } ].map(c => ({ ...c, virtual: true })), fn: async t => {
  await t.page.goto('file://' + t.c.file); await t.runFor(200);
  const before = await t.page.$eval('#count', e => e.textContent);
  t.check('count on load', before === t.c.want, before);
  await t.page.click('#go'); const after = await t.page.$eval('#count', e => e.textContent);
  t.check('start writes started', after === 'started', after);
  return { before, after };
} };

const rep = await runSuites([t1, t2, t3], { name: 'clerk-1-targeted', failOnConsoleError: true, quiet: true, out: OUT + '/report.json' });
for (const r of rep.results) console.log((r.ok ? 'ok ' : 'FAIL ') + r.id + ' ' + JSON.stringify(r.value) + ' pgErr=' + (r.pageErrors || []).length + ' conErr=' + (r.consoleErrors || []).length + ' ' + (r.checks || []).filter(k => !k.ok).map(k => k.name + ':' + k.detail).join(', '));
const hard = /3 items/.test(src);
console.log('hardcoded "3 items" in source:', hard);
console.log(`TOTAL ${rep.passed}/${rep.cases} passed, wall ${rep.wallMs} ms; suites: ` + Object.values(rep.suites).map(s => `${s.name} ${s.passed}/${s.cases}`).join(', '));
process.exit(rep.ok && !hard ? 0 : 1);
