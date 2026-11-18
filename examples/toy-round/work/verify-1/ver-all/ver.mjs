import { runMatrix, cross } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
import fs from 'fs';
const R='/Users/mick/dev/web/uc-optimizer/examples/toy-round/';
const D=R+'work/verify-1/ver-all';
const FILES={ base: R+'base.html', built: R+'work/repair-1-clerk/built.html', variant: D+'/variant-4items.html' };
const cases = cross({ vp: ['320x568','360x640','390x844','768x1024','1440x900'] }, { f: ['base','built','variant'] }).map(c => ({ ...c, virtual: true }));
const rep = await runMatrix(cases, async t => {
  await t.page.goto('file://' + FILES[t.c.f]); await t.runFor(200);
  const g = await t.page.evaluate(() => {
    const out = {};
    const props=['color','background-color','border','padding','font-family','font-size','line-height','font-weight','font-style','text-transform','display','vertical-align','text-align','letter-spacing','margin','text-wrap','min-height','min-width','width','height','cursor','border-radius','box-shadow','opacity'];
    for (const el of document.querySelectorAll('body, main, main *')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const k = el.id || el.tagName.toLowerCase()+[...el.parentNode.children].indexOf(el);
      out[k] = { x:r.x, y:r.y, w:r.width, h:r.height, text: el.children.length ? null : el.textContent, style: Object.fromEntries(props.map(p=>[p,cs[p]])) };
    }
    const h=document.getElementById('title'); const rg=document.createRange(); rg.selectNodeContents(h);
    out._h1lines=[...rg.getClientRects()].length;
    const b = document.getElementById('go'), br=b.getBoundingClientRect(), tn=document.createRange(); tn.selectNodeContents(b); const tr=tn.getBoundingClientRect();
    out._btnText = { top: tr.top-br.top, bottom: br.bottom-tr.bottom, left: tr.left-br.left, right: br.right-tr.right };
    out._hs = document.documentElement.scrollWidth - innerWidth;
    out._countLoad = document.getElementById('count').textContent;
    out._countBelowList = document.getElementById('count').getBoundingClientRect().top >= document.getElementById('list').getBoundingClientRect().bottom;
    out._liCount = document.querySelectorAll('#list li').length;
    out._title = document.title;
    return out;
  });
  await t.shot('load', { clip: { x:0, y:0, width: Math.min(800, +t.c.vp.split('x')[0]), height: 420 } });
  await t.page.click('#go'); await t.runFor(50);
  g._after = await t.page.$eval('#count', e => e.textContent);
  await t.page.tap?.('#go').catch(()=>{});
  g._errors = { pe: t.errors.pageErrors.map(String), ce: t.errors.consoleErrors.map(String) };
  t.check('no page/console errors', !g._errors.pe.length && !g._errors.ce.length, g._errors);
  return g;
}, { name: 'ver-all', dir: D+'/out', quiet: true, failOnConsoleError: true });
fs.writeFileSync(D+'/out/ver.json', JSON.stringify(rep.results.map(r=>({id:r.id, ok:r.ok, c:r.case, value:r.value, err:r.error, checks:r.checks})), null, 1));
console.log(rep.results.map(r => (r.ok?'ok ':'FAIL ')+r.id).join('\n'), 'wall', rep.wallMs);
