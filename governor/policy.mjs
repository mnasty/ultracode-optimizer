/* the governor's decisions, as pure functions of the sample history (so they are unit-tested without a machine).

   No fixed caps on browsers, pages or agents: every limit is derived from live signals and the system's own capacity.
   Paging is welcome (compressed memory and swap are fast on Apple silicon); the governor only steps in when the machine is
   about to run out:
     memory  headroom = reclaimable RAM (free + speculative + purgeable + inactive) + swap room (free disk on the VM volume).
             need = the largest one-tick drop seen, or the current drain rate over the look-ahead, or one swap file (the OS
             must be able to create the next one), whichever is larger.
             hold below 2 x need; shed below 1 x need, when macOS reports critical pressure, or when the disk can't take
             another swap file.
     procs   headroom = kern.maxproc - processes (and the per-user limit for ours). need = the largest step, the growth rate
             over the look-ahead, or 2% of the table, whichever is larger. hold below 2 x need; shed below 1 x need.
     thermal macOS thermal pressure: heavy -> hold, trapping or worse -> shed; and hold while the fans are already at full
             speed and the dies are still at or above the hot end of the fan curve.
   level: 'ok' (grow as cpu allows), 'hold' (start nothing new), 'shed' (cut back). */

export const DEFAULTS = {
  horizonS: 60,          // look-ahead for drain rates: how far ahead a new process must still fit
  windowS: 30,           // history window for rates and steps
  swapFileBytes: 2 ** 30, // macOS creates swap in 1 GiB files on Apple silicon
  procFloorFrac: 0.02,
  coolC: 45, hotC: 85,   // fan curve: automatic below coolC, full speed at hotC (85 C = 185 F); 45: ahead of macOS (its own start is about 57 C), for a closed lid in a dock
  fanDownPerTick: 0.03,  // fans speed up at once and slow down gently
  fanAutoAfterTicks: 30, // this many cool ticks in a row (or no work at all) hands the fans back to the system
}
const RANK = { ok: 0, hold: 1, shed: 2 }
const GB = b => (b / 2 ** 30).toFixed(1) + ' GB'

const memHeadroom = s => s.ramAvailBytes + s.vmDiskFreeBytes
const procHeadroom = s => s.maxproc - s.procs
const userHeadroom = s => (s.maxprocperuid && s.userProcs != null) ? s.maxprocperuid - s.userProcs : Infinity

/** slope (per second) of f over the samples, and the largest single-step drop */
function trend(win, f) {
  if (win.length < 2) return { rate: 0, step: 0 }
  const a = win[0], b = win[win.length - 1], dt = Math.max(1e-3, (b.t - a.t) / 1000)
  let step = 0
  for (let i = 1; i < win.length; i++) step = Math.max(step, f(win[i - 1]) - f(win[i]))
  return { rate: (f(a) - f(b)) / dt, step } // rate > 0: headroom is shrinking
}

export function assess(history, cfg = DEFAULTS) {
  const s = history[history.length - 1]
  if (!s) return { level: 'ok', reasons: ['no sample yet'], metrics: {} }
  const win = history.filter(h => s.t - h.t <= cfg.windowS * 1000)
  let level = 'ok'; const reasons = []
  const raise = (l, why) => { if (RANK[l] > RANK[level]) level = l; reasons.push(`${l}: ${why}`) }

  // memory + swap
  const H = memHeadroom(s), m = trend(win, memHeadroom)
  const memNeed = Math.max(m.step, Math.max(0, m.rate) * cfg.horizonS, cfg.swapFileBytes)
  if (s.pressureLevel >= 4) raise('shed', 'macOS memory pressure is critical')
  if (s.vmDiskFreeBytes < cfg.swapFileBytes) raise('shed', `only ${GB(s.vmDiskFreeBytes)} free on disk: no room for another swap file`)
  if (H < memNeed) raise('shed', `memory+swap headroom ${GB(H)} < need ${GB(memNeed)}`)
  else if (H < 2 * memNeed) raise('hold', `memory+swap headroom ${GB(H)} < 2 x need ${GB(memNeed)}`)
  // the disk alone must also absorb the swap the current drain implies
  const swapGrowth = Math.max(0, m.rate) * cfg.horizonS
  if (s.vmDiskFreeBytes >= cfg.swapFileBytes && s.vmDiskFreeBytes < 2 * cfg.swapFileBytes + swapGrowth)
    raise('hold', `disk ${GB(s.vmDiskFreeBytes)} can't absorb the swap growth of the next ${cfg.horizonS} s (${GB(swapGrowth)} + 2 swap files)`)

  // process table
  const P = procHeadroom(s), p = trend(win, procHeadroom)
  const procNeed = Math.max(p.step, Math.max(0, p.rate) * cfg.horizonS, Math.ceil(s.maxproc * cfg.procFloorFrac))
  if (P < procNeed) raise('shed', `process table: ${s.procs}/${s.maxproc}, headroom ${P} < need ${procNeed}`)
  else if (P < 2 * procNeed) raise('hold', `process table: ${s.procs}/${s.maxproc}, headroom ${P} < 2 x need ${procNeed}`)
  const U = userHeadroom(s)
  if (U !== Infinity) {
    const u = trend(win, userHeadroom), uNeed = Math.max(u.step, Math.max(0, u.rate) * cfg.horizonS, Math.ceil(s.maxprocperuid * cfg.procFloorFrac))
    if (U < uNeed) raise('shed', `per-user processes: ${s.userProcs}/${s.maxprocperuid}`)
    else if (U < 2 * uNeed) raise('hold', `per-user processes: ${s.userProcs}/${s.maxprocperuid}`)
  }

  // thermal
  const tp = s.thermalPressure ?? 0
  if (tp >= 3) raise('shed', `macOS thermal pressure ${['nominal', 'moderate', 'heavy', 'trapping', 'sleeping'][tp] || tp}`)
  else if (tp >= 2) raise('hold', 'macOS thermal pressure heavy')
  const fansMaxed = (s.fans || []).length > 0 && s.fans.every(f => f.max > 0 && f.rpm >= 0.95 * f.max)
  if (s.cpuMaxC >= cfg.hotC && fansMaxed) raise('hold', `dies at ${s.cpuMaxC} C with the fans already at full speed`)

  return {
    level, reasons,
    metrics: {
      memHeadroomBytes: H, memNeedBytes: memNeed, memDrainBytesPerS: Math.round(m.rate), pressureLevel: s.pressureLevel,
      ramAvailBytes: s.ramAvailBytes, vmDiskFreeBytes: s.vmDiskFreeBytes, swapUsedBytes: s.swapUsedBytes,
      procs: s.procs, maxproc: s.maxproc, procHeadroom: P, procNeed, userProcs: s.userProcs, maxprocperuid: s.maxprocperuid,
      thermalPressure: tp, cpuMaxC: s.cpuMaxC, cpuBusyPct: s.cpuBusyPct, fans: s.fans,
    },
  }
}

/** the fan request: a fraction of each fan's own range, or null for automatic. state carries the last value and the cool streak */
export function fanTarget(sample, active, state = { frac: null, cool: 0 }, cfg = DEFAULTS) {
  const T = sample?.cpuMaxC
  if (!active || T == null || T < 0) return { frac: null, cool: 0 }
  const want = Math.max(0, Math.min(1, (T - cfg.coolC) / (cfg.hotC - cfg.coolC)))
  if (want <= 0) {
    const cool = (state.cool || 0) + 1
    if (state.frac == null || cool >= cfg.fanAutoAfterTicks) return { frac: null, cool }
    return { frac: Math.max(0, state.frac - cfg.fanDownPerTick), cool }
  }
  const frac = state.frac == null || want >= state.frac ? want : Math.max(want, state.frac - cfg.fanDownPerTick)
  return { frac: +frac.toFixed(3), cool: 0 }
}

/* the cpu allowance: one machine-wide page budget for every live ptest pool, from the live cpu busy %, split among the pools.
   Every pool reading the same machine-wide cpu number on its own made them all cut together and all grow together (1->2->1->2
   swings, 38 Chromes at load 450 at a round's start). One decision for the machine, split fairly, ends that.
     start   no history (or 30 s with no pools): the cpu count, the machine's own capacity (not a constant)
     busy    the mean cpu busy % over the last smoothS seconds
     shed    level shed: T x 0.75
     saturated (busy >= saturatePct): T = max(1, floor(pages running x 0.8)), never above T
     headroom (busy < headroomPct, level ok) with a pool that has run its whole share for a full smoothing window and wants
             more: T + max(1, ceil(T x 0.25)), at most every growEveryMs, never above the total want
     otherwise hold. Cuts wait cutEveryMs after a cut, so the smoothed busy % sees the cut before the next one.
   The split is max-min fair water-filling by each pool's want (running + queued); pinned pools (fixed concurrency, PTEST_ADAPT=0,
   a real-time hold, a pool that doesn't follow shares, an old ptest's lease) count as fixed consumption first.
   No fixed caps: every number is a fraction of a live measurement or of the cpu count. */
export const CPU = {
  targetPct: 85,       // the busy % the band below aims at: grow under headroomPct, cut at saturatePct, hold between
  saturatePct: 92,
  headroomPct: 75,
  smoothS: 3,          // smoothing window for the busy %
  growEveryMs: 2000,
  growFrac: 0.25,
  cutEveryMs: 3000,    // one smoothing window between cuts
  saturateKeep: 0.8,
  shedKeep: 0.75,
  idleResetMs: 30000,  // with no pool for this long, the next burst starts from the cpu count again
}

/** the mean cpu busy % of the samples in the last smoothS seconds (null with none yet) */
export function cpuBusy(history, cfg = CPU) {
  const s = history[history.length - 1]
  if (!s) return null
  const w = history.filter(h => s.t - h.t <= cfg.smoothS * 1000 && h.cpuBusyPct != null)
  return w.length ? Math.round(w.reduce((a, h) => a + h.cpuBusyPct, 0) / w.length) : null
}

/** max-min fair split of T pages among the leases [{ id, want, pinned, pages }]: pinned leases keep their pages first, the
    rest is water-filled by want (nobody gets more than it wants; the leftover goes to those that want more and already hold
    the most, so shares don't rotate); every pool
    that follows shares gets at least 1 so it makes progress. returns { [id]: n } */
export function splitShares(T, leases) {
  const shares = {}
  let left = T
  for (const l of leases) if (l.pinned) { shares[l.id] = Math.max(0, +l.pages || 0); left -= shares[l.id] }
  left = Math.max(0, left)
  const rest = leases.filter(l => !l.pinned).map(l => ({ id: l.id, want: Math.max(0, +l.want || 0), pages: Math.max(0, +l.pages || 0) })).sort((a, b) => a.want - b.want || (a.id < b.id ? -1 : 1))
  while (rest.length && rest[0].want <= left / rest.length) { const a = rest.shift(); shares[a.id] = a.want; left -= a.want }
  if (rest.length) {
    const base = Math.floor(left / rest.length); let extra = left - base * rest.length
    // the leftover pages go to the pools that already hold the most, so they stay put tick to tick (a page that moves between
    // pools runs twice for a while: the cut pool's case is still running when the other one starts its next)
    rest.sort((a, b) => b.pages - a.pages || b.want - a.want || (a.id < b.id ? -1 : 1))
    for (const a of rest) { shares[a.id] = base + (extra > 0 ? 1 : 0); if (extra > 0) extra-- }
  }
  for (const l of leases) if (!l.pinned) shares[l.id] = Math.max(1, shares[l.id])
  return shares
}

/** one tick of the allowance. prev: the last returned state (or null); input: { t, busyPct, level, leases, cpus }.
    returns { state, allowance, shares, busyPct, targetPct, pagesLive, wantTotal, pools, why } */
export function cpuAllowance(prev, { t, busyPct, level = 'ok', leases = [], cpus = 1 }, cfg = CPU) {
  const st = { T: null, lastGrowT: -Infinity, lastCutT: -Infinity, idleSince: null, fullSince: null, ...(prev || {}) }
  const live = leases.length
  let why = 'hold'
  if (st.T == null || (!live && st.idleSince != null && t - st.idleSince >= cfg.idleResetMs)) {
    st.T = Math.max(1, cpus); st.lastGrowT = -Infinity; st.lastCutT = -Infinity; why = `start: the cpu count (${st.T})`
  }
  st.idleSince = live ? null : (st.idleSince ?? t)
  const pagesLive = leases.reduce((a, l) => a + Math.max(0, +(l.active ?? l.pages) || 0), 0)
  const wantTotal = leases.reduce((a, l) => a + Math.max(0, +(l.pinned ? l.pages : l.want) || 0), 0)
  const canCut = t - st.lastCutT >= cfg.cutEveryMs
  if (live && level === 'shed') {
    if (canCut && st.T > 1) { st.T = Math.max(1, Math.floor(st.T * cfg.shedKeep)); st.lastCutT = t; why = 'governor shed: x 0.75' }
  } else if (live && busyPct != null && busyPct >= cfg.saturatePct) {
    const to = Math.max(1, Math.floor(pagesLive * cfg.saturateKeep))
    if (canCut && to < st.T) { st.T = to; st.lastCutT = t; why = `saturated (cpu ${busyPct}%): ${pagesLive} pages running x 0.8` }
  } else if (live && level === 'ok' && busyPct != null && busyPct < cfg.headroomPct && t - st.lastGrowT >= cfg.growEveryMs && wantTotal > st.T) {
    // grow only once a pool has run its whole share for a full smoothing window: the busy % then measures those pages (a page
    // that has just started, or a Chrome still launching, doesn't load the cpu yet)
    if (st.fullSince != null && t - st.fullSince >= cfg.smoothS * 1000) {
      st.T = Math.min(wantTotal, st.T + Math.max(1, Math.ceil(st.T * cfg.growFrac))); st.lastGrowT = t; why = `headroom (cpu ${busyPct}%)`
    }
  }
  // since when a pool has run its whole share and wanted more (reset by every change of T: the new shares need their own window)
  const shNow = splitShares(st.T, leases)
  const full = leases.some(l => !l.pinned && l.want > shNow[l.id] && Math.min(+l.pages || 0, +(l.active ?? l.pages) || 0) >= shNow[l.id])
  st.fullSince = full && why === 'hold' ? (st.fullSince ?? t) : null
  return { state: st, allowance: st.T, shares: splitShares(st.T, leases), busyPct, targetPct: cfg.targetPct, pagesLive, wantTotal, pools: live, why }
}
