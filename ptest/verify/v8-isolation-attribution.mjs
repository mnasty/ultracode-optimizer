// V8: contexts are isolated (storage, IndexedDB, app state, clocks) and failures/page errors land on the right case, in case order,
// while cases finish out of order (random real delays).
import { runMatrix, dusk, sleepReal } from '../ptest.mjs';
const KINDS = ['ok', 'pageerror', 'console', 'check', 'throw', 'timeout', 'ok-real'];
const cases = Array.from({ length: 21 }, (_, i) => ({ name: `k${String(i).padStart(2, '0')}-${KINDS[i % KINDS.length]}`, kind: KINDS[i % KINDS.length], virtual: KINDS[i % KINDS.length] !== 'ok-real', vp: i % 2 ? '390x844' : '1440x900' }));
const rep = await runMatrix(cases, async t => {
  const id = t.id, kind = t.c.kind;
  await dusk.open(t);
  const before = await t.page.evaluate(async () => {
    const idb = await new Promise(res => { const r = indexedDB.open('ptest-iso', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { const tx = r.result.transaction('s').objectStore('s').get('tok'); tx.onsuccess = () => res(tx.result ?? null); tx.onerror = () => res('err'); }; r.onerror = () => res('open-err'); });
    return { ls: localStorage.getItem('tok'), ss: sessionStorage.getItem('tok'), idb, q: window.__dusk.S.question, date: Date.now() };
  });
  await t.page.evaluate(async id => { localStorage.setItem('tok', id); sessionStorage.setItem('tok', id); window.__dusk.S.question = id;
    await new Promise(res => { const r = indexedDB.open('ptest-iso', 1); r.onsuccess = () => { const tx = r.result.transaction('s', 'readwrite'); tx.objectStore('s').put(id, 'tok'); tx.oncomplete = res; }; }); }, id);
  await sleepReal(Math.round(Math.random() * 1500));                 // let other cases interleave
  await t.runFor(300);
  if (kind === 'pageerror') { await t.page.evaluate(id => setTimeout(() => { throw new Error('planted pageerror ' + id); }, 50), id); await t.runFor(100); if (!t.page.__ptestVirtual) await sleepReal(200); }
  if (kind === 'console') await t.page.evaluate(id => console.error('planted console ' + id), id);
  if (kind === 'check') t.check('planted check', false, id);
  if (kind === 'throw') throw new Error('planted throw ' + id);
  if (kind === 'timeout') await new Promise(() => {});
  const after = await t.page.evaluate(async () => {
    const idb = await new Promise(res => { const r = indexedDB.open('ptest-iso', 1); r.onsuccess = () => { const tx = r.result.transaction('s').objectStore('s').get('tok'); tx.onsuccess = () => res(tx.result ?? null); }; });
    return { ls: localStorage.getItem('tok'), ss: sessionStorage.getItem('tok'), idb, q: window.__dusk.S.question };
  });
  return { before, after, nodeNow: Date.now() };
}, { name: 'v8-isolation', timeout: 15000 });
let bad = [];
rep.results.forEach((r, i) => {
  const c = cases[i], id = r.id;
  if (r.i !== i || r.case !== c) bad.push(`${i}: out of order (${r.i})`);
  const errs = [...(r.pageErrors || []), ...(r.consoleErrors || []), r.error || ''].join(' ');
  const foreign = cases.map((_, j) => `k${String(j).padStart(2, '0')}-`).filter(p => !id.startsWith(p) && errs.includes(p));
  if (foreign.length) bad.push(`${id}: carries another case's error ${foreign}`);
  const expectFail = { pageerror: /planted pageerror/, check: /planted check/, throw: /planted throw/, timeout: /timeout after 15000ms/ }[c.kind];
  if (expectFail) { if (r.ok || !expectFail.test(r.error)) bad.push(`${id}: expected failure ${expectFail}, got ok=${r.ok} ${r.error}`); }
  else if (!r.ok) bad.push(`${id}: unexpected failure ${r.error}`);
  if (c.kind === 'console' && !(r.consoleErrors || []).some(e => e.includes(id))) bad.push(`${id}: console error not captured`);
  if (c.kind !== 'pageerror' && (r.pageErrors || []).length) bad.push(`${id}: stray page errors ${r.pageErrors}`);
  if (r.value) {
    const { before: b, after: a } = r.value;
    if (b.ls || b.ss || b.idb || b.q) bad.push(`${id}: saw leaked state before writing ${JSON.stringify(b)}`);
    if (a.ls !== id || a.ss !== id || a.idb !== id || a.q !== id) bad.push(`${id}: state after ${JSON.stringify(a)}`);
    const virt = c.virtual; const off = Math.abs(b.date - r.value.nodeNow);
    if (!virt && off > 120000) bad.push(`${id}: real case sees a fake Date (${new Date(b.date).toISOString()})`);
    if (virt && new Date(b.date).toISOString().slice(11, 16) !== new Date(Date.parse('2026-10-27T23:30:00') + 600).toISOString().slice(11, 16)) bad.push(`${id}: virtual case Date ${new Date(b.date).toISOString()}`);
  }
});
const order = [...rep.results].sort((x, y) => (x.startMs + x.ms) - (y.startMs + y.ms)).map(r => r.i);
console.log('finish order:', order.join(','));
console.log(bad.length ? 'PROBLEMS:\n  ' + bad.join('\n  ') : `ALL GOOD: ${rep.results.length} cases, isolation + attribution correct`);
process.exit(0);
