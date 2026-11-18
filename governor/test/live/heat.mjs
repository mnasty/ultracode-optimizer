// live end-to-end: a real ptest workload (the golden dusk page, screenshots at several viewports) for DURATION_S seconds,
// while the governor runs; prints what the governor and the fans did. Not a unit test: run it by hand.
import { runMatrix, cross, DUSK_URL } from '../../../ptest/ptest.mjs'
const DUR = +(process.env.DURATION_S || 180) * 1000, t0 = Date.now()
const cases = cross({ vp: ['1440x900', '1920x1080', '390x844', '800x1280'] }, { tod: ['noon', 'golden', 'night'] }, { k: Array.from({ length: 60 }, (_, i) => i) })
const rep = await runMatrix(cases, async t => {
  if (Date.now() - t0 > DUR) return 'skipped'
  await t.page.goto(DUSK_URL + `?city=new-york&tod=${t.c.tod}`)
  for (let i = 0; i < 4; i++) { await t.page.screenshot({ type: 'jpeg', quality: 50 }); await t.page.waitForTimeout(150) }
}, { name: 'heat', quiet: true, timeout: 60000 })
console.log(JSON.stringify({ passed: rep.passed, cases: rep.cases, wallS: Math.round(rep.wallMs / 1000), peak: rep.peakConcurrency, browsers: rep.browsers, governor: rep.governor, adaptTail: rep.adapt.slice(-4).map(a => `${a.from}->${a.to} ${a.why}`) }))
