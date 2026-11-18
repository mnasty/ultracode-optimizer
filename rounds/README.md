# the round engine: mayor-round.js

The mayor writes the args. The engine runs:
1. **Charms:** all at once, up to 8. Each works on a private copy of `base` and returns `patch.diff`, after a quick targeted test.
2. **Clerk:** merges every patch into `target`, builds to `built`, re-runs all the charms' tests in one pool, runs `after`, and snapshots the result.
3. **Inspect:** the auditor runs the full regression (`audit`) and every inspector runs, all at once, against the snapshot.
4. **Repair:** the findings are grouped into repair charms (at most 3 findings each, grouped by id prefix), which run in parallel. A clerk merges them.
5. **Verify:** the auditor and the verifiers run at once. Anything still open loops back to Repair, up to `repairRounds` times.

Every agent reads the `charter` files first and returns `charter_ack`. Every agent keeps `progress.md` and `report.json` in its own folder under `work`, so a resumed or re-run round continues instead of redoing.

## args

| key | required | meaning |
|---|---|---|
| `name` | yes | the round's name; used in labels and as the archive subfolder |
| `work` | yes | the root for every agent's folder (`charms/`, `clerk-1/`, `inspect/`, `repair-N/`, `verify-N/`) |
| `base` | yes | the source file the round starts from (never edited) |
| `target` | yes | the canonical source file the clerk writes |
| `build` | yes | the build command template with `{src}` and `{out}`, for example `python3 …/build-any.py {src} {out}` or `cp {src} {out}` |
| `built` | yes | where the clerk's build goes |
| `charms` | yes | `[{id, brief}]`, written by the mayor. Make them as small and local as possible. |
| `charter` | no | charter files to read first (default `uc-optimizer/charter/CHARTER.md`); add the project file, for example `charter/dusk.md` |
| `requirements` | no | the owner's verbatim requirements file(s) |
| `context` | no | free text every agent gets: paths, how to drive the page, the known noise |
| `inspectors` | no | `[{id, brief}]`: narrow areas, including one "did anything praised change" |
| `verifiers` | no | `[{id, brief}]`: final scopes |
| `audit` | no | what the auditor runs: suites, commands, checks |
| `after` | no | an extra step for the clerk after each merge, for example "rebuild the preview" |
| `archive` | no | a durable folder each agent mirrors into |
| `pageBudget` | no | removed: the governor sets limits from live signals |
| `repairRounds` | no | the maximum number of repair loops after inspection (default 2) |
| `mode` | no | `file` (default: `base`/`target` are one source file) or `dir` (they are directories, e.g. a whole repo) |
| `exclude` | no | dir mode: paths rsync skips when copying (default `node_modules`, `.git`, `.wrangler`, `.react-router`, `.DS_Store`) |
| `shared` | no | dir mode: absolute dirs symlinked into every charm's copy, e.g. the target's `node_modules` |

The engine returns:
- `final_src` and `final_built` (snapshots);
- `open` (anything unresolved);
- `ready`;
- every agent's report;
- `charter_acks` (acknowledged/agents);
- the collected `owner_decisions` and `owner_answers`.

## dir mode

For work on a whole repo. Each charm gets two rsync copies of `base`: `a` (pristine) and `b` (its workspace). `shared` dirs are symlinked into `b`. When it's done, it writes `git -C <dir> diff --no-index --binary a b > <dir>/patch.diff`. That covers edits, new files, deletions and binary assets, and needs no git repo.

The clerk makes `target` equal `base` with `rsync -a --delete` (the excluded paths are left alone). It applies each patch at the target root with `git -C <target> apply -p2 --reject` and resolves any `.rej` by hand. It runs one install if `package.json` changed, builds, and snapshots `target` to `clerk-N/src/` and the build output to `clerk-N/built/`.

Tests receive the app root in `APP_DIR` (and a built file or URL in `FILE`).

## Running it from a project session

The Workflow tool only loads a `scriptPath` from the session's own folders, and a symlink that resolves outside them is refused. Before a run, copy the engine in:

```
cp ~/dev/web/uc-optimizer/rounds/mayor-round.js <project>/.claude/workflows/mayor-round.js
```

Then call `Workflow({scriptPath: '<project>/.claude/workflows/mayor-round.js', args})`. A name lookup only finds workflows that existed when the session started.
