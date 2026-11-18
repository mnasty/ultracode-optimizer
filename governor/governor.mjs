#!/usr/bin/env node
/* uc-optimizer governor (macOS only): one machine-wide watcher shared by every ptest pool, gate and agent.

   Every second it samples memory, swap room, the process table, cpu, temperatures and fans (sample.mjs), decides a level
   (policy.mjs: ok | hold | shed, with reasons), and publishes it to ~/.uc-optimizer/governor.json. With it goes the cpu
   allowance (policy.mjs cpuAllowance): one machine-wide page budget from the live cpu busy %, split among the live ptest
   pools by their leases (cpu: { allowance, shares: { <leaseId>: n }, busyPct, targetPct, ... }). While uc-optimizer
   work is running (fresh leases from ptest pools or gates) it writes the fan request the root fan helper applies
   (install-fan-control.sh); with no work, or once the dies are cool, the request is null and the fans are automatic.

   It starts on demand (ensureGovernor, from ptest and gate) and exits after 10 idle minutes, leaving the fans automatic.

   CLI: node governor.mjs daemon | status | watch | stop */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sample, ensureNative } from './sample.mjs'
import { assess, fanTarget, DEFAULTS, cpuBusy, cpuAllowance, CPU } from './policy.mjs'

export const DIR = process.env.UC_GOVERNOR_DIR || path.join(os.homedir(), '.uc-optimizer')
export const STATE = path.join(DIR, 'governor.json')
export const FAN_REQUEST = path.join(DIR, 'fan-request.json')
export const LOG = path.join(DIR, 'governor.log.jsonl')
export const PID = path.join(DIR, 'governor.pid')
export const LEASE_DIR = process.env.PTEST_LEASE_DIR || path.join(os.tmpdir(), 'ptest-leases')
export const FAN_HELPER = '/Library/LaunchDaemons/com.uc-optimizer.fand.plist'
const SELF = fileURLToPath(import.meta.url)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const writeAtomic = (f, data) => { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f) }

/** the published state, or null if the governor isn't running (older than maxAgeMs) */
export function readState(maxAgeMs = 5000) {
  try { const s = JSON.parse(fs.readFileSync(STATE, 'utf8')); return Date.now() - s.t <= maxAgeMs ? s : null } catch { return null }
}

/** live uc-optimizer work: fresh lease files from ptest pools and gates */
export function activity(dir = LEASE_DIR, now = Date.now()) {
  let runs = 0, pages = 0, gates = 0
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      let l; try { l = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
      if (!l || !alive(l.pid) || now - l.t > 15000) continue
      if (l.kind === 'gate') gates++; else { runs++; pages += Math.max(0, +l.pages || 0) }
    }
  } catch { }
  return { runs, pages, gates, active: runs + gates > 0 }
}

/** the live ptest pools' leases, for the cpu split: [{ id, pid, name, pages, active, want, pinned }]. A lease without an id
    (an older ptest that doesn't follow shares) counts as pinned: fixed consumption of its pages */
export function poolLeases(dir = LEASE_DIR, now = Date.now()) {
  const out = []
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue
      let l; try { l = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
      if (!l || l.kind === 'gate' || !alive(l.pid) || now - l.t > 15000) continue
      const pages = Math.max(0, +l.pages || 0)
      out.push({ id: l.id || f.slice(0, -5), pid: l.pid, name: l.name, pages, active: l.active ?? pages, want: l.id ? Math.max(0, +l.want || 0) : pages, pinned: !l.id || !!l.pinned })
    }
  } catch { }
  return out
}

// in-process fallback when no governor daemon is publishing (e.g. it failed to start): same policy, own history
let localHist = []
export function currentSync(opts = {}) {
  const s = readState()
  if (s) return s
  const smp = sample(); localHist.push(smp)
  localHist = localHist.filter(h => smp.t - h.t <= (opts.cfg || DEFAULTS).windowS * 1000)
  return { t: smp.t, source: 'local', ...assess(localHist, opts.cfg || DEFAULTS) }
}

/** start the shared daemon if it isn't publishing; returns once it is (or after 5 s, falling back to local sampling) */
export async function ensureGovernor() {
  if (process.platform !== 'darwin') throw new Error('uc-optimizer governor: macOS only')
  if (readState()) return true
  ensureNative()
  const child = spawn(process.execPath, [SELF, 'daemon'], { detached: true, stdio: 'ignore', env: { ...process.env } })
  child.unref()
  for (let i = 0; i < 50; i++) { await sleep(100); if (readState()) return true }
  return false
}

/** wait until the machine can take new processes (level ok). logs why it waits, every 30 s */
export async function admit({ who = 'work', log = console.log, pollMs = 1000, state = currentSync } = {}) {
  let st = state()
  if (st.level === 'ok') return st
  log(`[governor] ${who}: waiting to start new processes (${st.level}: ${st.reasons.join('; ')})`)
  let last = Date.now()
  while (st.level !== 'ok') {
    await sleep(pollMs); st = state()
    if (Date.now() - last > 30000) { log(`[governor] ${who}: still waiting (${st.level}: ${st.reasons.join('; ')})`); last = Date.now() }
  }
  log(`[governor] ${who}: resources ok, starting`)
  return st
}

/** a lease that marks live work (for the fan curve and for idle exit) without holding pages */
export function gateLease(name) {
  try { fs.mkdirSync(LEASE_DIR, { recursive: true }) } catch { }
  const file = path.join(LEASE_DIR, `gate-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`)
  const write = () => { try { fs.writeFileSync(file, JSON.stringify({ pid: process.pid, name, kind: 'gate', pages: 0, t: Date.now() })) } catch { } }
  write(); const timer = setInterval(write, 2000); timer.unref()
  const close = () => { clearInterval(timer); try { fs.unlinkSync(file) } catch { } }
  process.once('exit', close)
  return { file, close }
}

async function daemon({ tickMs = 1000, idleExitMs = 10 * 60 * 1000, cfg = { ...DEFAULTS, cpu: CPU } } = {}) {
  fs.mkdirSync(DIR, { recursive: true })
  try { const other = +fs.readFileSync(PID, 'utf8'); if (other && other !== process.pid && alive(other)) return } catch { }
  fs.writeFileSync(PID, String(process.pid))
  let hist = [], fan = { frac: null, cool: 0 }, cpuSt = null, lastCpuLog = 0, lastLevel = null, lastLog = 0, idleSince = Date.now(), stopping = false
  const finish = () => { if (stopping) return; stopping = true; try { writeAtomic(FAN_REQUEST, JSON.stringify({ frac: null, t: Date.now(), why: 'governor stopped' })) } catch { }
    try { if (+fs.readFileSync(PID, 'utf8') === process.pid) fs.unlinkSync(PID) } catch { } }
  process.on('SIGTERM', () => { finish(); process.exit(0) }); process.on('SIGINT', () => { finish(); process.exit(0) }); process.on('exit', finish)
  while (!stopping) {
    const t0 = Date.now()
    try {
      const s = sample(); hist.push(s); hist = hist.filter(h => s.t - h.t <= Math.max(cfg.windowS, 120) * 1000)
      const a = assess(hist, cfg), act = activity()
      fan = fanTarget(s, act.active, fan, cfg)
      const leases = poolLeases()
      const cpu = cpuAllowance(cpuSt, { t: s.t, busyPct: cpuBusy(hist, cfg.cpu), level: a.level, leases, cpus: os.cpus().length }, cfg.cpu); cpuSt = cpu.state
      const { state: _cs, ...cpuPub } = cpu; cpuPub.leaseDir = path.resolve(LEASE_DIR) // pools follow shares only from a daemon that reads their lease dir
      const state = { t: s.t, pid: process.pid, level: a.level, reasons: a.reasons, metrics: a.metrics, activity: act, cpu: cpuPub,
        fan: { frac: fan.frac, helperInstalled: fs.existsSync(FAN_HELPER), curve: { coolC: cfg.coolC, hotC: cfg.hotC } } }
      writeAtomic(STATE, JSON.stringify(state))
      writeAtomic(FAN_REQUEST, JSON.stringify({ frac: fan.frac, t: s.t }))
      if (a.level !== lastLevel || s.t - lastLog > 60000) {
        try { if (fs.statSync(LOG).size > 5 * 2 ** 20) fs.renameSync(LOG, LOG + '.1') } catch { }
        fs.appendFileSync(LOG, JSON.stringify({ t: s.t, level: a.level, reasons: a.reasons, procs: s.procs, ramAvailGB: +(s.ramAvailBytes / 2 ** 30).toFixed(2),
          vmDiskFreeGB: +(s.vmDiskFreeBytes / 2 ** 30).toFixed(1), swapUsedGB: +(s.swapUsedBytes / 2 ** 30).toFixed(2), pressure: s.pressureLevel,
          cpuMaxC: s.cpuMaxC, thermal: s.thermalPressure, fanFrac: fan.frac, activity: act }) + '\n')
        lastLevel = a.level; lastLog = s.t
      }
      if (cpu.why !== 'hold' || (leases.length && s.t - lastCpuLog > 30000)) { // the cpu allowance: every change, and every 30 s while pools run
        fs.appendFileSync(LOG, JSON.stringify({ t: s.t, cpu: { allowance: cpu.allowance, why: cpu.why, busyPct: cpu.busyPct, pagesLive: cpu.pagesLive, wantTotal: cpu.wantTotal, pools: cpu.pools, shares: cpu.shares } }) + '\n')
        lastCpuLog = s.t
      }
      if (act.active) idleSince = s.t
      else if (s.t - idleSince > idleExitMs) break
    } catch (e) { try { fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), error: String(e && e.message || e) }) + '\n') } catch { } }
    await sleep(Math.max(50, tickMs - (Date.now() - t0)))
  }
  finish()
}

if (process.argv[1] === SELF) {
  const cmd = process.argv[2] || 'status'
  // the fan curve can be moved (e.g. a quieter or a cooler machine): UC_GOVERNOR_COOL_C / UC_GOVERNOR_HOT_C
  const cfg = { ...DEFAULTS, cpu: CPU, ...(process.env.UC_GOVERNOR_COOL_C ? { coolC: +process.env.UC_GOVERNOR_COOL_C } : {}), ...(process.env.UC_GOVERNOR_HOT_C ? { hotC: +process.env.UC_GOVERNOR_HOT_C } : {}) }
  if (cmd === 'daemon') daemon({ tickMs: +process.env.UC_GOVERNOR_TICK_MS || 1000, idleExitMs: +process.env.UC_GOVERNOR_IDLE_MS || 600000, cfg })
  else if (cmd === 'status') { const s = readState(); console.log(s ? JSON.stringify(s, null, 1) : 'governor not running') }
  else if (cmd === 'watch') { (async () => { await ensureGovernor(); for (;;) { const s = readState(); if (s) console.log(new Date(s.t).toLocaleTimeString(), s.level, `procs ${s.metrics.procs}/${s.metrics.maxproc}`, `ram ${(s.metrics.ramAvailBytes / 2 ** 30).toFixed(1)}G`, `disk ${(s.metrics.vmDiskFreeBytes / 2 ** 30).toFixed(0)}G`, `cpu ${s.metrics.cpuMaxC}C`, `fan ${s.fan.frac ?? 'auto'}`, s.cpu ? `cpu ${s.cpu.busyPct}% pages ${s.cpu.pagesLive}/${s.cpu.allowance} over ${s.cpu.pools} pool(s)` : '', s.reasons.join('; ')); await sleep(2000) } })() }
  else if (cmd === 'stop') { try { process.kill(+fs.readFileSync(PID, 'utf8'), 'SIGTERM'); console.log('stopped') } catch { console.log('not running') } }
  else { console.error('usage: governor.mjs daemon | status | watch | stop'); process.exit(2) }
}
