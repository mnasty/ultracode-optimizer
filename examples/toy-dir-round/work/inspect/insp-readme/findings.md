# insp-readme findings
- README-1 (minor): owner asked for "a README line listing both features"; snapshot README has two lines ("- add(a, b)" and "- greet(name)"). Fix: one line "- features: add(a, b), greet(name)", with successor README assertions in test.mjs/test-greet.mjs matching that line. Owner decision (recommend: keep two lines, owner's intent is satisfied).
- README-2 (minor): app suite (test*.mjs) guards "- greet(name)" in README but nothing in the app suite guards "- add(a, b)" (only charm-add/test-add.mjs outside the app). Fix: add test('README lists add') to test.mjs.
