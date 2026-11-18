# ptest progress

## 1. core module + self tests (done)
- ptest.mjs: runMatrix (context per case, auto concurrency, back-off, timeouts, error capture, summary), virtual time
  (page.clock + FAST_YIELD + ANIM_SHIM), freezeAt/markAnimations, bboxAudit, contrastAt, shot/contactSheet (Chrome), decodePng
  (zlib), realTimeConfirm, calibrate/pickKnee, sysSnapshot (memory_pressure, vm_stat, vm.swapusage), CLI.
- Found: Playwright's page.clock.runFor yields a native setTimeout(0) after every fired timer; Chrome clamps nested timeouts to
  4ms, so 2000 x 1ms timers took 9071ms real. FAST_YIELD routes those yields through a MessageChannel: 12ms.
- Found: page.clock does not drive CSS/WAAPI animations; the prototype's rise awaits anim.finished, so under a bare clock
  `risen` never turns true. ANIM_SHIM pauses + seeks every animation from the fake clock, finishing them at their exact virtual end.
- Found: CDP Emulation.setVirtualTimePolicy is unusable here (3000ms budget expired after 60ms real with the rise unfinished;
  31000ms budget expired after 2ms with progress 0).
- Energy 30s hold (390x844) under virtual time: 10 lines, .done at 30.100s virtual, 2.5s real (was 30.2s real with bare page.clock).
- test/ptest.test.mjs: 13 tests, all pass (3 consecutive runs): `node --test test/*.test.mjs`

## 2. examples a-d + bench runner (done)
- examples/a-energy-audit.mjs (33 cases), b-hold-log.mjs (4 + REALTIME=1 proof), c-action-peaks.mjs (30 + 2 contact sheets),
  d-smoke-walk.mjs (6 x 7 steps), examples/bench.mjs (`node ptest.mjs bench [a b c d] [--realtime-baseline]`).
- b real-time proof (390x844, wall clock): 10 lines, dwell 2873-3199ms, done 30.252s, cut 33.816s; virtual: done 30.100s, cut 33.6s.
- bboxAudit tuned on the real energy screen: 145 findings of noise -> 0 (text inside role=img glyph grids and svg is part of the
  picture; icon/icon overlaps are layered art; text boxes are line boxes). Planted defects on the real page are still found
  (test: small info button, h2 pushed onto the question, kick pushed out of overflow:hidden, 10px kick).
- Found: PNG encoding of screenshots (browser process) was the parallel bottleneck: page.screenshot 171ms/shot serial,
  838ms at 6 parallel. fastScreenshot (CDP captureScreenshot optimizeForSpeed) 63 / 249ms, pixel-identical (test). t.shot uses it.
- Found: a pool of browsers spreads that work: d walk x2 at c=6, page.screenshot: 1 browser 15.1s, 3 browsers 9.7s.
- 15 tests pass.

## 3. calibration v1 run + redesign (done)
- v1 sweep (1 browser): throughput 0.78/s at c=1, saturating ~1.9-2.1/s from c=6 to 16 while the CPU sat mostly idle -> one browser
  process is the ceiling (PNG encode + CDP dispatch). Pool test at c=16: 1 browser 2.07/s, 2: 2.35/s, 4: 2.47/s.
  The swap columns did their job: c=12 +2586MB swap / +166520 swapouts, c=24 +1955MB / +172236 (other agents were loading the
  machine too: load avg 17-33, later 150-360 during the realtime sweep -> that sweep is contaminated: c=24 had 38 failures).
- calibrate v2: phase 1 picks contexts-per-browser at c = cpu count (pools 1,2,3,5,10), phase 2 sweeps concurrency with that shape.
- runMatrix: least-loaded browser per case, relaunch of a crashed browser, back-off restored when it does not help (tests).
- Chrome alternates between two rasterizations of a gradient page on consecutive screenshots (both page.screenshot and CDP);
  parity test compares against 3 captures. 17 tests pass.

## 4. simple default + README finished (done, resume after owner cut precision work)
- Owner: "it doesn't need to use heuristics to be ultra precise". No more calibration sweeps or serial real-time baselines were run.
- resolveConcurrency: opts.concurrency > env PTEST_CONCURRENCY > default = cpu count (10) with 5 contexts per browser
  (2 browsers at c=10); opts.browsers / env PTEST_BROWSERS set the pool. Calibration is opt-in (PTEST_USE_CALIBRATION=1) and
  ignored when stale or contaminated (the cache on disk is contaminated: load 200-800 during the sweep).
  Basis: pool test at c=10: 1 browser 1.90/s, 2: 2.33/s, 3: 1.28/s, 5: 0.74/s; virtual sweep best at c=10 (1.67/s).
- README: rules, concurrency order, measured table (d 13.1s->8.1s quiet; b 141.1s->62.7s; c 28.0s->28.6s; a 266.8s->1051.5s,
  the latter all on a load-450-650 machine; a's parallel wall was spent outside the cases, before the 15s close cap).
- resolveConcurrency test rewritten for the new order. `node --test test/` (directory) does not work on this Node: use test/*.test.mjs.
- Final suite run (once, as instructed), load average 300-615 from other agents: 13/17 pass in about 15 min. The earlier quiet run passed 17/17 in 31 s.
  Failed: runMatrix basics (the pageerror case hit its 1500 ms test timeout), decodePng+shot+contactSheet (the swatch case
  returned no path, so a case failed under load), fastScreenshot parity (dpr1 fullPage: 341608 px differ), and live back-off
  (no back-off at 4->3). All four depend on timing or rendering under load. None of them uses resolveConcurrency. Log: scratch/test-run-final.log

## 5. fixer pass: verifier findings (in progress)
- BLOCKER fixed: freezeAt(ms) under virtual time now advances the clock to mark + ms (the app's JS timers run: eye swaps,
  prop classes), then pauses every animation in place. `{seek:true}` keeps the old pure seek. A later virtual freezeAt resumes
  what the previous one paused (t.thaw() too). Returned array carries .advancedMs. Example (c) updated (+ seed:1, face state).
- Timer/rAF errors under virtual time: TIMER_ERRORS init script wraps the fake timers so each throw goes through reportError()
  -> a normal 'pageerror' (as in real time); clockCall() keeps a fallback. Shims are also evaluated into the current document
  (setContent pages got none before).
- `seed` case/opts option (mulberry32 Math.random), case.timeout honoured, wallMs measured before close, close waits max 2 s.
- fastScreenshot parity test: 3 captures per engine (Chrome alternates rasterizations of the gradient fixture in both engines).
- Suite: 20/20 pass in 33 s (load 6). Parity test 8/8 after the change (was 5/6).
- SVG SMIL + document.timeline.currentTime now driven by the anim shim (v3: smil 0.48 at 500ms virtual, timeline exact; was 1 / 0).
- runSuites(suites, opts) + `node ptest.mjs run a.mjs b.mjs`: several test files in one pool (one concurrency budget).
- README rewritten: rules (one pool, freeze pattern, dir per stage), dusk helper table, fixed t.freezeAt signature, 23:30-night
  default, pitfalls (workers, play-state, perf.now offset, seed), 4-6 s per hold.
- Verifier re-runs: v2 peaks: freezeAt(at) face state == real in 8/8 (was 4/8 wrong); v12 virtual timer error -> pageErrors 1,
  case continues; v1 hold equiv done 30105 real vs 30100 virtual; v4 (quiet): a 33/33 24.9 s wall, b 4/4 5.8 s, close 100-184 ms.
- Benchmarks (virtual, quiet start, load 7-21): a 67.9 -> 23.1 s (2.94x), b 15.4 -> 5.6 s (2.74x), c 31.7 -> 8.7 s (3.65x),
  d 10.5 -> 3.3 s (3.16x). Example c faces now right: sextant wink, tea dreamy, cosmic/crystal closed (sheet out/c-action-peaks).
- One pool for all 4 (`ptest run`): 73/73 in 62.7 s (load rose 10 -> 61: another agent's Chrome started). Four node processes at
  once: 80.5 s and 7 failures in c ('Cannot fast-forward to the past').
- Bug found by that run + fixed: installVirtualTime installed the clock only 1 s before `time`; > 1 s of stall before pauseAt
  failed the case. Now 120 s margin. Regression test (1.5 s stall) passes; with the old margin it fails.
- v6 rerun: findings + acts identical 33/33 (serial vs parallel, parallel vs parallel); boxes within 2 px 23-25/33; vnow differs
  -40..+155 ms (CSS start grid + runUntil step). README pitfall now says this.
- Prototype rebuilt by another stage at 23:11 (card-back stack #sp 5.6-6.8 px under the moon at 390x844 -> 2 clearance findings);
  the prototype audit test now guards against audit noise (<= 6) + planted defects must be NEW findings, instead of clean == [].
- Final suite: 23/23 pass in 37 s (load 40-60 from another agent). One-pool vs one-after-another under load 36-300: noise
  (139.7 vs 77.5 s, then 67.6 vs 118.1 s); README says so.
- README finished (measured table from the quiet bench run). DONE.
