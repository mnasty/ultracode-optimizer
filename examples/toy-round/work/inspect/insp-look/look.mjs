import { runMatrix, cross } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
const R='/Users/mick/dev/web/uc-optimizer/examples/toy-round/';
const FILES={ base: R+'base.html', built: R+'work/clerk-1/built.html' };
const D='/Users/mick/dev/web/uc-optimizer/examples/toy-round/work/inspect/insp-look/out';
const cases = cross({ vp: ['360x640','1440x900'] }, { f: ['base','built'] }).map(c => ({ ...c, virtual: true }));
const rep = await runMatrix(cases, async t => {
  await t.page.goto('file://' + FILES[t.c.f]); await t.runFor(200);
  const g = await t.page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('main *')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      out[el.id || el.tagName.toLowerCase()+[...el.parentNode.children].indexOf(el)] = { x:r.x, y:r.y, w:r.width, h:r.height, text: el.children.length ? null : el.textContent,
        style: ['color','background-color','border','padding','font-family','font-size','line-height','font-weight','text-transform','display','vertical-align','text-align','letter-spacing'].map(p=>cs[p]).join('|') };
    }
    const b = document.getElementById('go'), br=b.getBoundingClientRect(), tn=document.createRange(); tn.selectNodeContents(b); const tr=tn.getBoundingClientRect();
    out._btnText = { top: tr.top-br.top, bottom: br.bottom-tr.bottom, left: tr.left-br.left, right: br.right-tr.right };
    out._hs = document.documentElement.scrollWidth - innerWidth;
    return out;
  });
  await t.shot('load');
  await t.page.click('#go'); await t.runFor(50);
  g._after = await t.page.$eval('#count', e => e.textContent);
  await t.shot('clicked');
  g._errors = { pe: t.errors.pageErrors.map(String), ce: t.errors.consoleErrors.map(String) };
  return g;
}, { name: 'look', dir: D, quiet: true });
import fs from 'fs'; fs.writeFileSync(D+'/look.json', JSON.stringify(rep.results.map(r=>({id:r.id, ok:r.ok, value:r.value, err:r.error})), null, 1));
console.log(rep.results.map(r => (r.ok?'ok ':'FAIL ')+r.id).join('\n'), rep.wallMs ?? '');
