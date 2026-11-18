# insp-look findings (round toy-1)
Test: look.mjs, one runMatrix, base+built x 360x640/1440x900, 4/4 ok, 0 page / 0 console errors, wall 1262 ms. Data: out/look.json; shots: out/*.png.
- T1 ok: h1 "welcome to the toy" (same words), color/size/weight unchanged.
- T2 ok: #go 55x44 at both vps (base 55x38); width, colors, border, padding, font identical; label stays centred (top/bottom inset 12/13 vs base 9/10, same 1px bias).
- T3 ok: #count "3 items" on load (from querySelectorAll('#list li').length), "started" after click at both vps.
- standing ok: scrollWidth-innerWidth = 0 at 360; only diffs vs base are title text, #go h 38->44, list/count shifted down 6 px (consequence of T2), #count now filled.
- LOOK-1 (minor): at 360x640 the lowercase h1 now wraps "welcome to the / toy" leaving a one-word orphan line (base wrapped "Welcome To / The Toy" evenly). Fix: add text-wrap:balance to h1 (no effect at 1440, single line).
