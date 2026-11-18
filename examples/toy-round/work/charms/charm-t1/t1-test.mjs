// T1: h1 is lowercase, same words, and the h1 is the only visible change. FILE=<built html> node t1-test.mjs
import { runMatrix } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
const FILE = process.env.FILE; if (!FILE) { console.error('set FILE'); process.exit(2); }
const rep = await runMatrix(['360x640', '1440x900'].map(vp => ({ vp, virtual: true })), async t => {
  await t.page.goto('file://' + FILE); await t.runFor(200);
  const g = await t.page.evaluate(() => ({ h1: document.getElementById('title').textContent, lede: document.getElementById('lede').textContent,
    btn: document.getElementById('go').textContent, hs: document.documentElement.scrollWidth - innerWidth }));
  t.check('T1 h1 exact lowercase words', g.h1 === 'welcome to the toy', g.h1);
  t.check('other text unchanged', g.lede === "a tiny page for testing the mayor's round engine." && g.btn === 'start', g);
  t.check('no h-scroll', g.hs <= 0, g.hs);
  await t.shot('h1', { clip: { x: 0, y: 0, width: Math.min(700, +t.c.vp.split('x')[0]), height: 120 } });
  return g;
}, { name: 't1', dir: new URL('./out/t1', import.meta.url).pathname, failOnConsoleError: true });
process.exit(rep.ok ? 0 : 1);
