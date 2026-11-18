# ver-all findings (verify-1)
- Snapshot: repair-1-clerk/src (the built/ folder only holds index.html, identical to base and to target-built).
- Tests: node --test --test-reporter=tap test*.mjs (APP_DIR=snapshot): 6/6 pass, 0 fail, ~100 ms, wall 0.19 s. The same in target: 6/6.
- add: add(2,3)=5, add(0.5,0.25)=0.75; tested in test.mjs ('add').
- greet: greet('name')="hello, name"; tested in test-greet.mjs ('greet'). Negative control: test-greet against base gives 0/1 (it fails).
- dot.png: 68 bytes, byte-identical to the base64 in the mayor's charm-greet brief (iVBORw0KGgo...5CYII=); IHDR/IDAT/IEND CRCs ok; 1x1 8-bit gray+alpha (file, sips).
- README: one line '- features: add(a, b), greet(name)'.
- diff -r snapshot/src vs target: identical. built vs target-built: identical.
- No new problems. The base64 is not in requirements.md; it came from the mayor's brief (workflow journal).
