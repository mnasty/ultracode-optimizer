// the governor's decisions on synthetic histories (no machine needed)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assess, fanTarget, DEFAULTS, cpuBusy, splitShares, cpuAllowance, CPU } from '../policy.mjs'

const GB = 2 ** 30
const base = { pressureLevel: 1, ramAvailBytes: 6 * GB, vmDiskFreeBytes: 50 * GB, swapUsedBytes: 0, procs: 800, userProcs: 450, maxproc: 4000, maxprocperuid: 2666,
  cpuBusyPct: 30, thermalPressure: 0, cpuMaxC: 55, fans: [{ id: 0, rpm: 2000, min: 1500, max: 4300 }, { id: 1, rpm: 2100, min: 1500, max: 4700 }] }
const hist = (n, f) => Array.from({ length: n }, (_, i) => ({ ...base, t: 1e12 + i * 1000, ...f(i) }))

test('an ordinary busy machine is ok, even with heavy paging (paging is welcome)', () => {
  const a = assess(hist(20, i => ({ pressureLevel: 2, ramAvailBytes: 0.4 * GB, swapUsedBytes: (2 + i * 0.05) * GB, cpuBusyPct: 85 })))
  assert.equal(a.level, 'ok', a.reasons.join('; '))
})

test('critical memory pressure sheds', () => {
  const a = assess(hist(5, () => ({ pressureLevel: 4 })))
  assert.equal(a.level, 'shed'); assert.match(a.reasons.join(), /critical/)
})

test('a nearly full disk holds (swap can\'t absorb the drain) and sheds when no swap file fits', () => {
  // ram and disk draining at 50 MB/s each with 4 GB of disk left: 60 s ahead needs > the room left
  const hold = assess(hist(30, i => ({ ramAvailBytes: (1.5 - i * 0.02) * GB, vmDiskFreeBytes: (4 - i * 0.05) * GB })))
  assert.notEqual(hold.level, 'ok', 'should stop spawning'); assert.match(hold.reasons.join(), /disk|headroom/)
  const shed = assess(hist(5, () => ({ vmDiskFreeBytes: 0.6 * GB })))
  assert.equal(shed.level, 'shed'); assert.match(shed.reasons.join(), /swap file/)
})

test('memory+swap headroom scales its need with the live drain rate (no fixed floor beyond one swap file)', () => {
  const slow = assess(hist(30, i => ({ ramAvailBytes: 2 * GB, vmDiskFreeBytes: (20 - i * 0.01) * GB })))
  assert.equal(slow.level, 'ok')
  const fast = assess(hist(30, i => ({ ramAvailBytes: 2 * GB, vmDiskFreeBytes: (20 - i * 0.4) * GB }))) // 400 MB/s -> 24 GB in 60 s
  assert.notEqual(fast.level, 'ok', fast.reasons.join('; '))
})

test('the 2026-10-31 crash, replayed: a respawn storm filling the process table holds, then sheds, before the table is full', () => {
  const storm = hist(30, i => ({ procs: 2400 + i * 50, ramAvailBytes: 0.15 * GB, vmDiskFreeBytes: 8 * GB, pressureLevel: 2 }))
  const levels = storm.map((_, k) => assess(storm.slice(0, k + 1)).level)
  const firstStop = levels.findIndex(l => l !== 'ok'), firstShed = levels.indexOf('shed')
  assert.ok(firstStop >= 0 && storm[firstStop].procs < 3800, `stops spawning at ${storm[firstStop]?.procs} procs`)
  assert.ok(firstShed >= 0 && storm[firstShed].procs < 4000, `sheds at ${storm[firstShed]?.procs} procs`)
})

test('per-user process headroom is watched too', () => {
  const a = assess(hist(5, () => ({ userProcs: 2600 })))
  assert.notEqual(a.level, 'ok'); assert.match(a.reasons.join(), /per-user/)
})

test('thermal: heavy holds, trapping sheds, maxed fans at the hot end hold', () => {
  assert.equal(assess(hist(3, () => ({ thermalPressure: 2 }))).level, 'hold')
  assert.equal(assess(hist(3, () => ({ thermalPressure: 3 }))).level, 'shed')
  const hot = assess(hist(3, () => ({ cpuMaxC: 92, fans: [{ rpm: 4290, min: 1500, max: 4300 }] })))
  assert.equal(hot.level, 'hold'); assert.match(hot.reasons.join(), /full speed/)
  assert.equal(assess(hist(3, () => ({ cpuMaxC: 92, fans: [{ rpm: 3000, min: 1500, max: 4300 }] }))).level, 'ok', 'fans still have room: the curve handles it')
})

test('fan curve: automatic when idle or cool, ramps with temperature, fast up, gentle down, auto again after a cool streak', () => {
  assert.equal(fanTarget({ cpuMaxC: 90 }, false).frac, null, 'no uc work: automatic')
  assert.equal(fanTarget({ cpuMaxC: 40 }, true).frac, null, 'cool (below coolC 45): automatic')
  const mid = fanTarget({ cpuMaxC: 65 }, true); assert.equal(mid.frac, 0.5) // halfway from 45 to 85
  const full = fanTarget({ cpuMaxC: 88 }, true, mid); assert.equal(full.frac, 1, 'up at once')
  const down = fanTarget({ cpuMaxC: 70 }, true, full); assert.ok(down.frac > 0.4 && down.frac < 1, 'down gently: ' + down.frac)
  let st = { frac: 0.2, cool: 0 }
  for (let i = 0; i < DEFAULTS.fanAutoAfterTicks; i++) st = fanTarget({ cpuMaxC: 40 }, true, st)
  assert.equal(st.frac, null, 'back to automatic after the cool streak')
})

// the cpu allowance: one machine-wide page budget from the live cpu, split among the pools
const L = (id, want, pages = 0, extra = {}) => ({ id, want, pages, active: pages, pinned: false, ...extra })
const sum = o => Object.values(o).reduce((a, b) => a + b, 0)

test('split: max-min fair water-filling by want, the leftover to those that want more, never more than wanted', () => {
  assert.deepEqual(splitShares(10, [L('a', 100), L('b', 100), L('c', 100), L('d', 100)]), { a: 3, b: 3, c: 2, d: 2 })
  const s = splitShares(12, [L('small', 2), L('mid', 4), L('big', 100)])
  assert.deepEqual(s, { small: 2, mid: 4, big: 6 }, 'the small ones get what they want, the big one the rest')
  assert.equal(sum(splitShares(9, [L('x', 50), L('y', 50)])), 9, 'the whole allowance is given out')
  assert.deepEqual(splitShares(20, [L('a', 3), L('b', 5)]), { a: 3, b: 5 }, 'no more than the want, even with room left')
})

test('split: pinned pools are fixed consumption first; every following pool gets at least 1', () => {
  const s = splitShares(10, [L('pin', 0, 6, { pinned: true }), L('a', 100), L('b', 100)])
  assert.deepEqual(s, { pin: 6, a: 2, b: 2 })
  const over = splitShares(4, [L('pin', 0, 8, { pinned: true }), L('a', 100), L('b', 100)])
  assert.equal(over.a, 1); assert.equal(over.b, 1, 'pinned pools use it all: the others still make progress (1 each)')
})

test('cpu busy is smoothed over the window', () => {
  const h = [10, 50, 100, 90, 80].map((c, i) => ({ t: 1e12 + i * 1000, cpuBusyPct: c }))
  assert.equal(cpuBusy(h), Math.round((50 + 100 + 90 + 80) / 4), 'the last 3 s (4 samples)')
  assert.equal(cpuBusy([{ t: 1, cpuBusyPct: null }]), null)
})

test('allowance: starts at the cpu count (the machine\'s own capacity) with no history, and splits it at once', () => {
  const r = cpuAllowance(null, { t: 0, busyPct: null, leases: [L('a', 200), L('b', 200), L('c', 200), L('d', 200)], cpus: 10 })
  assert.equal(r.allowance, 10); assert.match(r.why, /cpu count/)
  assert.equal(sum(r.shares), 10, 'four pools together start at 10 pages, not 4 x 10')
  assert.equal(cpuAllowance(null, { t: 0, busyPct: 30, leases: [], cpus: 16 }).allowance, 16, 'another machine: its own count')
})

test('allowance: saturated cuts to 0.8 x the pages running, at most once per window', () => {
  let r = cpuAllowance(null, { t: 0, busyPct: 50, leases: [L('a', 100, 10)], cpus: 10 })
  r = cpuAllowance(r.state, { t: 1000, busyPct: 97, leases: [L('a', 100, 10)], cpus: 10 })
  assert.equal(r.allowance, 8); assert.match(r.why, /saturated/)
  const again = cpuAllowance(r.state, { t: 2000, busyPct: 97, leases: [L('a', 100, 8)], cpus: 10 })
  assert.equal(again.allowance, 8, 'no second cut inside the smoothing window')
  const later = cpuAllowance(again.state, { t: 1000 + CPU.cutEveryMs, busyPct: 97, leases: [L('a', 100, 8)], cpus: 10 })
  assert.equal(later.allowance, 6, 'still saturated a window later: cut again')
  const one = cpuAllowance({ ...later.state, T: 1 }, { t: 1e6, busyPct: 99, leases: [L('a', 100, 1)], cpus: 10 })
  assert.equal(one.allowance, 1, 'never below 1')
})

test('allowance: headroom grows by 25% (at least 1), at most every 2 s, once a pool has run its whole share for a full window', () => {
  const st = { T: 8, lastGrowT: -Infinity, lastCutT: -Infinity, idleSince: null, fullSince: null }
  // feed one tick a second; returns the allowance after each
  const run = (s0, ticks, leases, busy = 60, t0 = 10000) => { let s = s0; const out = []; for (let k = 0; k < ticks; k++) { const r = cpuAllowance(s, { t: t0 + k * 1000, busyPct: busy, leases: typeof leases === 'function' ? leases(s) : leases, cpus: 10 }); s = r.state; out.push(r.allowance) } return { out, s } }
  const both = s => [L('a', 100, splitShares(s.T, [L('a', 100), L('b', 100)]).a), L('b', 100, splitShares(s.T, [L('a', 100), L('b', 100)]).b)] // pools at their shares
  const g = run(st, 12, both)
  assert.deepEqual(g.out.slice(0, 4), [8, 8, 8, 10], 'waits a full 3 s window at the share, then + ceil(8 x 0.25)')
  assert.deepEqual(g.out.slice(4, 8), [10, 10, 10, 13], 'the new shares need their own window: + ceil(10 x 0.25) 4 s later')
  assert.deepEqual(run(st, 6, [L('a', 100, 2), L('b', 100, 2)]).out, [8, 8, 8, 8, 8, 8], 'pools still ramping to their share: hold')
  assert.deepEqual(run(st, 6, [L('a', 100, 4, { active: 0 }), L('b', 100, 4, { active: 0 })], 30).out, [8, 8, 8, 8, 8, 8], 'pools still launching Chrome (limit at the share, nothing running yet, cpu low): hold')
  assert.deepEqual(run(st, 6, [L('a', 4, 4), L('b', 4, 4)]).out, [8, 8, 8, 8, 8, 8], 'nobody wants more: hold')
  assert.equal(run(st, 6, [L('a', 5, 4), L('b', 4, 4)]).out[5], 9, 'never above the total want')
  assert.equal(run({ ...st, T: 1 }, 4, [L('a', 100, 1)], 10).out[3], 2, 'at least +1')
  assert.deepEqual(run(st, 6, both, 85).out, [8, 8, 8, 8, 8, 8], 'between 75 and 92: hold')
})

test('split: the leftover stays with the pools that already hold it (no rotation of shares between ticks)', () => {
  const a = splitShares(5, [L('a', 30, 1), L('b', 30, 2), L('c', 30, 1), L('d', 30, 1)])
  assert.equal(a.b, 2, 'b keeps its second page: ' + JSON.stringify(a))
  const again = splitShares(5, [L('a', 31, 1), L('b', 29, 2), L('c', 30, 1), L('d', 30, 1)])
  assert.equal(again.b, 2, 'even when another pool now wants more: ' + JSON.stringify(again))
})

test('allowance: hold never grows, shed cuts x 0.75; no pools for 30 s resets to the cpu count', () => {
  const st = { T: 12, lastGrowT: -Infinity, lastCutT: -Infinity, idleSince: null }, lz = [L('a', 100, 6), L('b', 100, 6)]
  assert.equal(cpuAllowance(st, { t: 10000, busyPct: 20, level: 'hold', leases: lz, cpus: 10 }).allowance, 12)
  const sh = cpuAllowance(st, { t: 10000, busyPct: 20, level: 'shed', leases: lz, cpus: 10 })
  assert.equal(sh.allowance, 9); assert.match(sh.why, /shed/)
  let r = cpuAllowance(st, { t: 10000, busyPct: 20, leases: [], cpus: 10 })
  assert.equal(r.allowance, 12, 'a short gap between pools keeps what was learnt')
  r = cpuAllowance(r.state, { t: 10000 + CPU.idleResetMs, busyPct: 20, leases: [], cpus: 10 })
  assert.equal(r.allowance, 10, 'a long idle spell starts again from the cpu count')
})
