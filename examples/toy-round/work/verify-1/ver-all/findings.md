# ver-all findings (toy-1, verify-1) on work/repair-1-clerk/built.html
Test: ver.mjs, one runMatrix, {base, built, variant-4items} x {320x568, 360x640, 390x844, 768x1024, 1440x900} = 15/15 ok, virtual time,
failOnConsoleError on, 0 page / 0 console errors, ptest wall 4173 ms (node 6.4 s), PTEST_CONCURRENCY=4 PTEST_BROWSERS=1. Data out/ver.json; shots out/*.png (360 base/built, 1440 built viewed).
- T1 resolved: h1 textContent "welcome to the toy" (base "Welcome To The Toy", same words); all h1 css identical to base except text-wrap wrap->balance (LOOK-1 repair).
- T2 resolved: #go 54.58x44 at all 5 vps (base 54.58x38); only css diffs min-height/min-width 44px; colour, border, padding, font identical; label inset 12/13 top/bottom (base 9/10), 11/11 sides; screenshot shows same outlined button, slightly taller.
- T3 resolved: #count "3 items" on load at all vps, sits below #list; variant copy with a 4th li shows "4 items" (so derived, not hard-coded); click #go -> "started" in built and variant at all vps.
- standing resolved: scrollWidth-innerWidth = 0 at 320/360/390/768/1440; 0 page/console errors; element-by-element diff vs base shows only: h1 text + text-wrap, #go height/min sizes, list/count shifted down 6 px (T2 consequence), #count filled (T3), body/main taller accordingly; document title unchanged.
- NOTE (owner decision, minor): h1 text-wrap:balance is not in the owner's words; it was added by repair for LOOK-1 so the narrow heading breaks "welcome / to the toy" instead of "welcome to the / toy". Recommend keep.
