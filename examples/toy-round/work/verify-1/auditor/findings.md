# auditor verify-1 findings (toy-1)
- Full regression (toy-suite, one node process, one runMatrix pool, PTEST_CONCURRENCY=4 PTEST_BROWSERS=1) on work/repair-1-clerk/built.html: ok 360x640, ok 1440x900. 2/2 cases, 10/10 checks, 0 page errors, 0 console errors. ptest wall 938 ms; node process 2.08 s real.
- Diff vs base.html: only T1 (lowercase h1), T2 (min-height/min-width 44px on .cta), T3 (count script) and the deliberate repair LOOK-1 (h1 text-wrap:balance). Nothing else changed.
- No failures, so no findings.
