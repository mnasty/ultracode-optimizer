# ptest: parallel, virtual-time Playwright for the dusk prototype

`P=/Users/mick/dev/web/uc-optimizer/ptest`

## The rules (2 minutes)

1. **Put every viewport, state or variant in one `runMatrix` call.** Never loop cases yourself, and never run one case per `node` call.
   Each case gets its own BrowserContext, and cases run in parallel: 10 at once by default (the CPU count), across 2 browsers.
2. **Several test files? Run them in one pool:** `node $P/ptest.mjs run a.mjs b.mjs` or `runSuites([...])` (see below). Don't start
   several `node` processes at once, because each one would start 10 contexts of its own. If you must, give each one `PTEST_CONCURRENCY=5`.
3. **Use virtual time (`virtual: true`).** Advance it with `t.runFor(ms)` or `t.runUntil(pred)`, never with `page.waitForTimeout` or
   a real-time `waitForFunction`. A full 30 s hold takes about 4-6 s of real time.
4. **Freeze frames with `await t.mark(); <start it>; await t.freezeAt(ms)`.** Under virtual time this runs the clock to `ms` after the mark,
   so the app's JS timers run too (eye swaps, prop classes, setTimeout chains). Then it pauses every animation in place, giving exactly the frame real
   playback shows. Don't seek animations without the clock: `{seek: true}` is only for pure CSS/WAAPI scenes.
5. **Prove each timing claim once in real time**, with a `virtual: false` case wrapped in `t.realTime(name, fn, {claim})`. It is logged to
   `$P/realtime-log.jsonl`. Everything else runs virtual.
6. **Use the shared checks** (`t.audit`, `t.contrast`, `t.shot`, `contactSheet`) rather than writing your own.
7. **Write screenshots under your own stage folder:** pass `dir: '<your stage>/out/<name>'` in the runMatrix options. The default `$P/out/<name>` is
   shared, so two agents using the same name overwrite each other.
8. **Don't tune the concurrency.** The default is right for this Mac. To override it, set `opts.concurrency` / `PTEST_CONCURRENCY` or `opts.browsers` / `PTEST_BROWSERS`.

## Copy-paste starter

```js
// save in your stage folder, e.g. .../dusk-v2-build/v4tests/my-check.mjs, then run: node my-check.mjs
import { runMatrix, cross, dusk, VIEWPORTS_11, formatAudit } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';

const cases = cross({ vp: VIEWPORTS_11 }, { state: ['idle', 'hold'] }).map(c => ({ ...c, virtual: true, seed: 1 }));
const rep = await runMatrix(cases, async t => {
  await dusk.open(t, { query: '?tod=night' });     // goto prototype + 600 ms (virtual)
  await dusk.energy(t);                            // jumpTo(2), then runUntil the moon has risen
  if (t.c.state === 'hold') { await dusk.press(t); await t.runFor(4500); }
  const a = await t.audit({ root: '#s2' });        // geometry findings
  t.check('no overlaps', !a.counts.overlap, formatAudit(a));   // soft assert: the case fails but keeps going
  await t.shot(t.c.state);                         // <dir>/<caseId>--<label>.png
  return a.counts;                                 // kept in rep.results[i].value
}, { name: 'my-check', dir: new URL('./out/my-check', import.meta.url).pathname });
process.exit(rep.ok ? 0 : 1);
```

The runner prints one row per case, in case order, then the wall time, the summed case time and the parallel speed-up.
A case fails if it throws, fails a `t.check`, times out or raises a page error. The failure is reported and the other cases keep running.

## Several test files at once: one pool

```js
// my-a.mjs, my-b.mjs: each exports  suite = { name, cases, fn, after?, opts? }   (opts: dir, timeout, virtual, seed)
//   node $P/ptest.mjs run my-a.mjs my-b.mjs           <- one pool, one concurrency budget, a report per suite
import { runSuites } from '/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs';
const rep = await runSuites([suiteA, suiteB]);     // rep.suites['a'].results, .passed, .afterValue; case ids are '<suite>-<id>'
```

The examples' `bench` exports work as suites: `node $P/ptest.mjs run $P/examples/a-energy-audit.mjs $P/examples/d-smoke-walk.mjs`.

## Cases and options

**Case fields:**
- `vp: '390x844'`, `dpr`, `touch` (true below 1024 px by default), `rm: true` (reduced motion), `colorScheme`, `isMobile`, `name`.
- `virtual`: `true` or `{time: '2026-10-27T08:10:00', animations: 'sync'|'real', syncEvery: 32}`.
- `seed`: a number. It makes `Math.random` repeatable, so the hold plays the same action order every run.
- `timeout`: overrides the matrix timeout for this case.
- Any other field you add becomes part of the case id. `cross({a:[..]},{b:[..]})` builds the cartesian product.

**`runMatrix(cases, fn, opts)` options:**
- `name`, `dir`, `out` (path for the JSON report), `quiet`.
- `concurrency`, `browsers`, `backoff` (true).
- `timeout` (90 000 ms per case), `retries` (0).
- `virtual`, `seed`: defaults applied to every case.
- `failOnPageError` (true), `failOnConsoleError` (false), `ignoreConsole: [re]`.
- `cacheNet` (true: Google Fonts are served from `$P/.netcache`).
- `closeWait` (2000 ms: how long to wait for the browsers to close. The wall time is measured before the close).

**The `t` object passed to `fn`:**

| member | what it does |
| --- | --- |
| `t.page` `t.context` `t.c` `t.id` `t.dir` | the page, its context, the case, the case id and the screenshot folder |
| `t.runFor(ms)` | advances virtual time. In a real-time case it waits on the wall clock, so one test runs either way |
| `t.runUntil(fn, {step:50, max:60000})` | advances in `step` slices until `fn` is true in the page, and returns the virtual ms it took |
| `t.fastForward(ms)` | jumps ahead; each due timer fires at most once |
| `t.frames(n)` | waits n real rendering frames, for IntersectionObserver and ResizeObserver callbacks |
| `t.mark()` | marks time zero for `freezeAt` and remembers the animations alive now |
| `t.freezeAt(ms \| '50%' \| 'end' \| null, {onlyNew, selector, seek})` | gives a deterministic frame (see rule 4). Returns the paused animations, with `.advancedMs` |
| `t.thaw()` | resumes what `freezeAt` paused |
| `t.audit(opts)` `t.contrast(sel)` `t.shot(label, {clip, fullPage})` | the shared checks |
| `t.check(name, cond, detail)` | a soft assertion |
| `t.realTime(name, fn, {claim})` | a real-time proof. The case must have `virtual: false` |
| `t.errors` | `{pageErrors, consoleErrors}` collected so far |

**Dusk helpers (`import { dusk }`):**

| helper | what it does |
| --- | --- |
| `dusk.open(t, {query:'', settle:600})` | goes to the prototype (`query` such as `'?tod=night'`), then runs `settle` ms |
| `dusk.jump(t, n, {question, reversals:true, settle:1500})` | sets `S.question` and `S.useReversals`, calls `jumpTo(n)` (step 0-6 = i-vii), then runs `settle` ms |
| `dusk.energy(t)` | jumps to step ii (2) and runs until `__dusk.risen` |
| `dusk.press(t)` / `dusk.release(t)` | mouse down / up on the cards (`#deckBtn`, b10 Z11; builds before it: the moon `#lune`) |
| `dusk.cardsCenter(t)` | `{x, y}` of the cards (the press target) |
| `dusk.moonCenter(t)` | `{x, y}` of the moon |

## Virtual time: what it controls

**Controlled:**
- Through `page.clock`: `Date`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`, `performance.now`, `Intl.DateTimeFormat()` defaults and `Event.timeStamp`.
- Through ptest's shims: CSS animations, CSS transitions, Web Animations, SVG SMIL (`<animate>`, `<animateTransform>`, `<animateMotion>` and `<set>`) and `document.timeline.currentTime`.

The clock is **paused**: nothing timer-driven moves until you call `runFor` or `runUntil`.

**Not controlled (they run on real time):**
- Timers inside Web Workers.
- Painting, IntersectionObserver and ResizeObserver.
- Network.

**The defaults, and what they mean for your test:**
- **The clock starts at 2026-10-27 23:30 local, which is night.** Any test of the visitor's hour or the sky must set `virtual: {time: '...T08:10:00'}`
  (or use `?tod=`) for each time of day it checks. The prototype has no per-minute hour update yet. Once the sky engine adds one, check it with `t.runFor(60000)`.
- `Math.random` is not seeded unless you set `seed`. Without it, the hold plays a different first action each run.

**How ptest makes this work:**
- **FAST_YIELD.** Playwright yields a native `setTimeout(0)` after every timer, and Chrome clamps that to 4 ms. ptest uses a MessageChannel instead,
  so 2000 timers take 12 ms instead of 9 s.
- **ANIM_SHIM.** It pauses each animation and sets its `currentTime` from the fake clock. Each animation finishes at its exact virtual end, so
  `finished`, `onfinish`, `animationend` and `transitionend` fire at the right virtual time.
- **TIMER_ERRORS.** An app error thrown in a timer or rAF callback becomes a normal page error, the same as in real time. The clock still runs the whole span,
  and `failOnPageError` decides the outcome. Without this shim, Playwright rethrows only the first such error, from `runFor`.

**Pitfalls:**
- **Install virtual time before `goto`.** `virtual: true` on the case does this for you.
- **`page.waitForFunction` polls in real time.** While the clock is paused, rAF-gated app code never runs, so the wait times out. Use `t.runUntil`.
- **`freezeAt(ms)` counts from the last `t.mark()`.** Call `mark()` right before you start the thing you want to freeze. A `freezeAt` earlier than the
  current clock throws, because time can't go backwards. In real-time cases, and with `'%'`, `'end'` or `{seek:true}`, it only seeks CSS/WAAPI animations,
  and JS-driven state stays where it is.
- **CSS animations can start late.** A CSS animation starts at the first style flush after its trigger: either the app forces layout or the next 32 ms sync tick comes.
  So it can start up to 32 ms of virtual time late, and SMIL behaves the same way. `Element.animate` is exact. Use `virtual: {syncEvery: 16}` for frame accuracy, at a higher cost.
- **Paused animations ignore `animation-play-state`.** Once the shim has paused a CSS animation, toggling `animation-play-state` from paused to running resumes it up to about 12 ms late (seen: 0.512 instead of 0.500).
  JS pauses (`a.pause()`) are respected.
- **Virtual runs are repeatable in outcome, not to the millisecond.**
  - `performance.now()` starts 2-16 ms in after `goto` (`Date` starts exactly).
  - CSS animation starts land on a 32 ms grid.
  - `runUntil` rounds to its `step`.

  Over a long flow, the end time can differ by up to about 150 ms between runs, so a moving sprite can be tens of px apart. Measured on bench (a), serial
  vs parallel and parallel vs parallel: findings and acts were identical in 33 of 33 cases, and item boxes were within 2 px in 23-25 of 33 (`verify/v6`).
  So set `seed`, compare findings or thresholds rather than raw boxes, and gate a frame on app state (`runUntil`) followed by `freezeAt`, not on elapsed time alone.
- **Observers run on real frames.** Call `t.frames(2)` after a scroll or resize, before you advance the clock.
- **The faked `performance` only has `now` and `timeOrigin`.** `performance.mark` and `performance.measure` are no-ops.
- **CDP `Emulation.setVirtualTimePolicy` is unusable here.** Its budgets expired with the app's work undone. `speedAnimations(page, rate)` (CDP
  `Animation.setPlaybackRate`) only speeds up animations on real time, with timers untouched.

## Animation frames without waiting

```js
await dusk.open(t); await dusk.energy(t); await t.runFor(1800);
await t.mark();                                   // time zero
await t.page.evaluate(() => window.__dusk.playAct(window.__dusk.main, 'Sipping tea..', 2750));
const fz = await t.freezeAt(1350, { onlyNew: true });   // clock +1350 ms (timers ran), then everything paused in place
await t.shot('tea-peak', { clip });               // the frame real playback shows at 1350 ms
await t.freezeAt(2000);                           // resumes, runs 650 ms more, freezes again
```

Example (c), `examples/c-action-peaks.mjs`, shows the complete pattern. The verifier compared it with real playback paused at the same moment
(`verify/v2-peak-equiv.mjs`), and the face state matched in 8 of 8 actions.

## Shared checks

- **`bboxAudit(page, opts)` / `t.audit(opts)`** returns `{ok, counts, findings:[{type,a,b,detail,box}]}`.
  - It collects visible text (as line boxes), svg/img/[role=img] icons and interactive targets.
  - The finding types are:
    - `overlap`.
    - `clearance`: less than `minGap` (8 px) between targets, or between a target or text and an unrelated icon.
    - `smallTarget`: under 44 px.
    - `smallText`: under 12 px.
    - `clippedText`: cut by overflow or clip, or outside the viewport.
    - `underFixed`: under a fixed header or footer at the current scroll.
    - `hScroll`: lists the culprits.
  - It ignores hidden and opacity-0 elements, sr-only text, decorative svgs larger than 25% of the viewport, icon-on-icon layering, glyphs inside
    svg or `[role=img]`, and items inside one button (they count as the button).
  - The tuning options are `root`, `ignore`, `pairIgnore`, `pairsSkip`, `groups`, `textGap`, `minGap`, `minTarget`, `minFont`, `targetIgnore`, `fixedIgnore`,
    `iconPairs` and `listItems`. `formatAudit(r)` gives a readable summary.
- **`contrastAt(page, sel)` / `t.contrast(sel)`** takes a shot of the element with its text and another without it, then compares the glyph pixels
  against the real pixels behind them. It returns `{ratio (p5), median, best, need, pass, bgLum}`. Freeze or use virtual time first, so nothing moves between the two shots.
- **`t.shot(label)`** writes `<dir>/<caseId>--<label>.png`. (2026-10-28, r3: at dpr != 1 every capture goes through Playwright's `page.screenshot`, because a CDP capture with a clip from ptest's own session left the page at devicePixelRatio 1 for the rest of the case; dpr 1 keeps the fast CDP path.) It uses CDP `captureScreenshot` with `optimizeForSpeed`, which gives the same pixels as `page.screenshot`
  and is about 3x faster in parallel. Use `{engine:'playwright'}` for masks or `omitBackground`.
- **`t.shot(label, { evidence: true })`** is for a shot only a person looks at: it writes `<dir>/<caseId>--<label>.jpg`, JPEG quality 70 at CSS-pixel scale (much cheaper at big viewports and dpr > 1). Never mark a shot that anything decodes, diffs, hashes or finds by its file name. `PTEST_SHOTS=full` turns evidence shots back into full-size PNGs for debugging.
- **`contactSheet(pngs | [{path,label}], out, {cols, thumb, title})`** builds the sheet in Chrome. No PIL is needed.

## CLI

```
node $P/ptest.mjs run a.mjs b.mjs ...              # several suites in one pool
node $P/ptest.mjs info                             # the concurrency that would be used, and the memory/swap state now
node --test $P/test/*.test.mjs                     # ptest's own tests (23 tests, about 35 s; a bare directory argument does not work on this Node)
node $P/ptest.mjs bench [a b c d] [--serial-only|--parallel-only|--realtime-baseline]   # serial vs parallel; appends to bench-results.json
node $P/ptest.mjs calibrate [--force] [--quick]   # optional throughput sweep -> $P/.calibration.json (TTL 24 h)
```

**How the concurrency is chosen, in this order:**
1. `opts.concurrency`.
2. `PTEST_CONCURRENCY`.
3. The default: the CPU count, on `ceil(c / 5)` browsers.

`opts.browsers` or `PTEST_BROWSERS` sets the number of browsers.

The calibration cache is used only with `PTEST_USE_CALIBRATION=1`, and only when it is fresh and was not recorded on a loaded machine.
`calibrate` records memory pressure, swap use and pageout/swapout deltas at every level, and has no memory floor.

During a run, live back-off cuts concurrency by 25% only when a window's throughput falls below 60% of the best window AND the machine is strained (CPU at least 90% busy over the window, or macOS memory pressure at warn or critical). A slower window on an unstrained machine just means the queue reached heavier cases, so concurrency is kept (logged once). The load average is not used: on macOS it counts threads waiting on swap. If a back-off doesn't help, concurrency goes back up. Tests can pass `strained: () => ({ strained, cpuBusyPct, pressureLevel })`.

## Measured on this Mac

These are from `node ptest.mjs bench a b c d` on 2026-10-27 at 23:05, with the machine mostly quiet (load average 7-21 on 10 CPUs). They are recorded in `bench-results.json`, and the log is
`scratch/bench-final.log`. Serial means concurrency 1 on 1 browser. Parallel means the default settings. Both use virtual time.

| bench | cases | serial wall | parallel wall | wall speed-up | parallel setting | CPU busy (parallel) |
| --- | --- | --- | --- | --- | --- | --- |
| (a) energy bbox audit, 11 viewports x 3 states | 33 | 67.9 s | 23.1 s | **2.94x** | c=10, 2 browsers | 90% |
| (b) 30 s hold + message log, 4 viewports | 4 | 15.4 s | 5.6 s | **2.74x** | c=4, 1 browser | 63% |
| (c) 15 action peaks x 2 viewports via freezeAt | 30 | 31.7 s | 8.7 s | **3.65x** | c=10, 2 browsers | 84% |
| (d) step i-vii smoke walk, 6 viewports | 6 | 10.5 s | 3.3 s | **3.16x** | c=6, 2 browsers | 69% |

- **Virtual time gives the biggest win, before any parallelism.** A 30 s hold proven on the wall clock took 33.8 s (done at 30.25 s). On virtual time it
  reaches `.done` at 30.100 s virtual in 2.5-4 s real. `verify/v1` matched the real and virtual holds line by line, with done at 30105 ms real against 30100 ms virtual.
- **At c=10 the CPUs are about 90% busy**, so the default uses the machine. Per-case time grows in parallel (in (a), 195.7 s summed against 67.6 s
  serial), because the cases compete for the same 10 cores.
- **One pool against several processes** (all four examples, 73 cases):
  - Four `node` processes started at once took 80.5 s, and 7 of the 30 (c) cases failed. Under that load, more than 1 s passed between `clock.install` and `pauseAt`; that bug is fixed now.
  - `ptest run` with all four took 62.7 s, and 73 of 73 passed.
  - Repeated while another agent's Chrome loaded the machine (load 36-300), the timings were noise either way: 139.7 s against 77.5 s, then 67.6 s against 118.1 s for the four run
    one after another. The point of one pool is that the machine is never oversubscribed.
- **Earlier numbers, from a machine loaded to load average 450-650 by other agents:** (a) took 266.8 s serial and 1051.5 s parallel; (b) 141.1 s and 62.7 s. Load from other agents
  dominates everything. When `info` shows a load above about 30, expect several times these figures.
- **Pool shape at c=10 (loaded):** 1 browser ran 1.90 cases/s, 2 browsers 2.33/s, 3 browsers 1.28/s and 5 browsers 0.74/s. One browser process tops out at about
  2 cases/s, because screenshot PNG encoding and CDP dispatch run in that process. Hence 5 contexts per browser.
- **Screenshots:** `t.shot` (CDP `optimizeForSpeed`) took 63 ms per shot serial and 249 ms at 6 parallel, against 171 ms and 838 ms for `page.screenshot`. The pixels
  are identical: on the prototype, viewport and fullPage at dpr 1 and 2 matched in 8 of 8 (`verify/v10`).
- **Browser close** is capped at 2 s, and the wall time is measured before it. Measured close times were 85-184 ms on a quiet machine and 7-10 s under load.

## Adaptive concurrency (2026-10-30)

`runMatrix` adapts on its own, so callers don't pick a concurrency.

- **One machine-wide page budget.** `PTEST_BUDGET` defaults to 2 × cores, which is 20 here. It is shared through lease files in `$TMPDIR/ptest-leases`, one per running pool, refreshed every tick. Stale leases (dead pid, or no heartbeat for 15 s) are dropped. A pool may use what the others leave free, and always at least `floor(budget / runs)`.
- **A controller runs every 2 s** (`opts.adaptMs`). When the governor publishes a CPU share for the pool, it follows that (below). Otherwise it acts on machine-wide CPU busy %, macOS memory pressure and case timeouts:
  - **strained** (CPU ≥ 90% or pressure ≥ warn), or a timeout: ×0.75, then no growth for 3 ticks;
  - **over the shared allowance:** drop to it;
  - **CPU < 75%, work queued and every slot busy:** +25% (at least 1), capped by the allowance, the work left and `PTEST_MAX` (3 × cores).
- **It never grows during a timing proof:** while a `realtime: true` case or a `t.realTime()` measurement runs.
- **Browsers grow with the limit:** at most `contextsPerBrowser` (5) per browser, up to `PTEST_MAX_BROWSERS`.
- **Starting point and pinning:** `PTEST_CONCURRENCY` / `opts.concurrency` are only where it starts. An explicit `opts.concurrency` without `adapt: true` is pinned (the old behaviour: back-off only). `PTEST_ADAPT=0` pins everything.
- **The report** includes `adaptive`, `startConcurrency` (after the budget clamp), `peakConcurrency`, `finalConcurrency`, `budget`, `browsers` and `adapt` (every change, with its reason).
- **Tests:** `node --test test/adaptive.test.mjs` (7 cases, including two real processes sharing one budget).


### Governed by the machine-wide resource governor (macOS only)
Since 2026-11-01 ptest has no fixed page budget, browser cap or concurrency cap (`PTEST_BUDGET`, `PTEST_MAX_BROWSERS` and `PTEST_MAX` pin one only if you set them). Every pool obeys `../governor/` (see its README):
- it doesn't start Chrome until the governor says `ok`;
- it never grows on `hold`;
- on `shed` it cuts 25% and closes idle browsers.

Growth otherwise follows the governor's CPU share. The report carries `governor: {admitWaitMs, levels, cpuShares}` and `browsersLive`. Tests can inject `opts.governor` (a function returning `{level, reasons}`). ptest refuses to run on anything but macOS for now.

### Following the governor's CPU share (2026-11-01)
Every pool used to read the same machine-wide CPU number on its own, so all pools cut together and then grew together. Now the governor turns the live CPU into one page allowance for the machine and splits it among the pools (see `../governor/README.md`). A pool:
- registers its lease (`id`, `want` = running + queued, `pinned`), reads its share within about 2 s (one governor tick) and starts at it, with browsers for it. This is one read, not a stagger: every pool starts as soon as it has its share.
- cuts to its share at once when it falls, and grows toward it by +25% per tick (at least 1) while work is queued and every slot is busy.
- no longer cuts on its own CPU reading. A case timeout still cuts × 0.75 as a safety; `shed`, real-time holds, `PTEST_BUDGET` and the pins stay as before.
- logs each change as `[ptest] share: concurrency a -> b (governor allowance T over k pools, cpu x%)`. The report's `adapt` entries carry `via: 'share' | 'local'`, and `governor.cpuShares` has `{followed, startShare, shareWaitMs, changes}`.

A pinned pool (fixed `opts.concurrency`, `PTEST_ADAPT=0`, or while a real-time case runs) says `pinned` in its lease, and the governor counts its pages as fixed; a pool holds still while a real-time proof runs. The lease stays fresh from registration on, even while Chrome launches slowly. A pool that has followed shares and misses one (a late lease, or a governor state older than 5 s) holds for up to 15 s rather than falling back to its own CPU reading; after that its own controller takes over. With no shares published (an older governor daemon), or a daemon that reads another lease dir (one a test started with its own `PTEST_LEASE_DIR`), the controller above works unchanged, without waiting. `PTEST_CPU_SHARES=0` (or `opts.cpuShares: false`) turns following off. Tests: `node --test test/cpu-shares.test.mjs` (11 cases: follows a share up and down, two pools split one allowance, the timeout safety, the fallbacks (no shares, a daemon reading another lease dir, a late lease), the off switch, the real-time hold, a fresh lease during a slow launch, holding through a missing share, and the own controller again after 15 s without one).
