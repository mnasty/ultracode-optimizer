# auditor findings (toy-dir)
- No failures. Snapshot root pool: 5/5. Charm acceptance pool (APP_DIR=clerk-1/src): 6/6. 0 errors. Wall about 185 ms with both pools running at once.
- Note: clerk-1/built holds only index.html (the build output), with no test*.mjs, so the suite ran in the snapshot source root clerk-1/src. built/index.html is identical to target-built/index.html.
- Note: the clerk's "11/11" counts the charm acceptance files (test-add.mjs, charm-greet test-greet.mjs), and test-add.mjs is not part of the snapshot. The snapshot's own suite is 5 tests. Not a defect.
