// the root fan helper, run unprivileged with --dry (prints the SMC writes instead of doing them, on a simulated fan state).
// UCSMC_TEST_TEMP / UCSMC_TEST_TEMP_FILE / UCSMC_TEST_TP stand in for the dies and thermal pressure, UCSMC_TEST_FANS for the fans'
// current mode:target (another controller), UCSMC_TEST_COOL_TICKS for the cool-down; the tool honours them only with --dry.
// Its own heat curve is always on: 50 C = each fan's minimum, 80 C = full speed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ensureNative } from '../sample.mjs'

ensureNative() // a fresh checkout has no binary yet

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'native', 'ucsmc')
const fans = JSON.parse(execFileSync(BIN, ['sense'], { encoding: 'utf8' })).fans
const AUTO = fans.map(() => '0:0').join(',')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const frac = (w, i = 0) => +((Buffer.from(w.bytes).readFloatLE(0) - fans[i].min) / (fans[i].max - fans[i].min)).toFixed(3)

// run the helper for ms; step(dir) may change the request or the temperature mid-run
async function drive({ temp, tp = 0, req, state = AUTO, ms = 1600, coolTicks, step }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fand-')), rf = path.join(d, 'req.json'), tf = path.join(d, 'temp')
  const setReq = f => fs.writeFileSync(rf, JSON.stringify({ frac: f, t: Date.now() })), setTemp = c => fs.writeFileSync(tf, String(c))
  if (req !== undefined) setReq(req); setTemp(temp)
  const env = { ...process.env, UCSMC_TEST_TEMP_FILE: tf, UCSMC_TEST_TP: String(tp), UCSMC_TEST_FANS: state, ...(coolTicks ? { UCSMC_TEST_COOL_TICKS: String(coolTicks) } : {}) }
  const p = spawn(BIN, ['--dry', 'fand', rf], { env })
  let out = '', err = ''; p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b)
  await sleep(ms); if (step) await step({ setReq, setTemp })
  const errBeforeStop = err
  p.kill('SIGTERM'); await new Promise(r => p.on('exit', r))
  const writes = out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  const tg = writes.filter(w => w.write === 'F0Tg')
  return { first: tg[0] ? frac(tg[0]) : null, last: tg.length ? frac(tg.at(-1)) : null, writes, err, errBeforeStop, autoAt: writes.findIndex(w => w.write === 'F0Md' && w.bytes[0] === 0) }
}

test('a request above the heat curve is applied as is (cool dies)', async () => {
  const r = await drive({ temp: 35, req: 0.1 }); assert.equal(r.first, 0.1, r.err)
})
test('hot dies: a too-low request is raised to the helper\'s own curve', async () => {
  const r = await drive({ temp: 72, req: 0.1 }); assert.ok(Math.abs(r.first - 22 / 30) < 0.01, r.first + ' ' + r.err)
})
test('hot dies turn the fans on with no request at all (whatever is running)', async () => {
  const r = await drive({ temp: 70 }); assert.ok(Math.abs(r.first - 20 / 30) < 0.01, r.first + ' ' + r.err)
  assert.ok(r.writes.some(w => w.write === 'F0Md' && w.bytes[0] === 1), 'forced mode written')
})
test('cool dies and no request: nothing is written (macOS keeps the fans)', async () => {
  const r = await drive({ temp: 40 }); assert.equal(r.writes.length, 0, JSON.stringify(r.writes))
})
test('macOS thermal pressure heavy forces full speed; moderate at least half', async () => {
  assert.equal((await drive({ temp: 45, tp: 2, req: 0 })).first, 1)
  assert.equal((await drive({ temp: 45, tp: 1, req: 0.2 })).first, 0.5)
})
test('very hot: full speed whatever was asked', async () => {
  assert.equal((await drive({ temp: 92, req: 0.3 })).first, 1)
})
test('another controller forcing more (e.g. Macs Fan Control at max) is left alone', async () => {
  const r = await drive({ temp: 70, req: 0.3, state: fans.map(f => '1:' + f.max).join(',') })
  assert.equal(r.writes.length, 0, JSON.stringify(r.writes)); assert.match(r.err, /another controller/)
})
test('another controller forcing less than the heat needs is raised', async () => {
  const r = await drive({ temp: 75, state: fans.map(f => '1:' + f.min).join(',') }); assert.ok(r.first > 0.8, String(r.first))
})
test('once cool, the fans it forced go back to macOS after the cool-down (and not before)', async () => {
  const r = await drive({ temp: 70, ms: 1500, coolTicks: 3, step: async ({ setTemp }) => { setTemp(40); await sleep(1500) } })
  const early = x => /fan 0 automatic/.test(x.errBeforeStop) // handed back while still running
  assert.ok(!early(r), 'not handed back within 1.5 s of cooling (cool-down 3 s): ' + r.err)
  const r2 = await drive({ temp: 70, ms: 1500, coolTicks: 2, step: async ({ setTemp }) => { setTemp(40); await sleep(3500) } })
  assert.ok(early(r2), 'handed back after the cool-down, before the stop: ' + r2.err)
})
test('stopping the helper hands back the fans it forced', async () => {
  const r = await drive({ temp: 70 }); assert.ok(r.autoAt > 0, r.err)
})
