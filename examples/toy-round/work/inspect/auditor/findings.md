# auditor findings (toy-1)
- full regression (copy of toy-suite.mjs, output kept in this folder) on work/clerk-1/built.html: ok 360x640, ok 1440x900; 2/2 cases, 10/10 checks, 0 page / 0 console errors; ptest wall 1154 ms, process 2.59 s (PTEST_CONCURRENCY=4 PTEST_BROWSERS=1).
- measured: h1 "welcome to the toy"; #go 54.6x44 px at both viewports; #count "3 items" on load, "started" after click; h-scroll 0.
- diff base.html -> built.html: only the 3 intended edits (.cta min-height/min-width 44px; h1 lowercased; count script line). Nothing else changed.
- no findings.
