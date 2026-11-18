# uc-optimizer

`uc-optimizer` (ultracode optimizer) is the owner's orchestration kit for Claude Code. It started as ptest, a browser test harness. It now has three parts:
- **the charter:** a set of preserved instructions;
- **the round engine:** a reusable workflow;
- **ptest:** the test harness the engine drives.

The driving Claude session is **the mayor**. Every round, it reads the charter, splits the owner's feedback into the smallest independent pieces of work (**charms**), writes each piece's brief, and runs the round engine.

```
uc-optimizer/
  charter/CHARTER.md   the mayor's standing instructions. ~/.claude/CLAUDE.md imports it, so it loads in every session and subagent
  charter/dusk.md      project rules for Dusk Tarot (read when that project is in play)
  rounds/mayor-round.js  the round engine (a Workflow script; args are documented in rounds/README.md)
  ptest/               parallel, virtual-time Playwright harness (README inside)
  examples/toy-round/  the engine's own end-to-end test (a tiny page, three owner requests)
```

## Glossary

| term | what it is |
|---|---|
| mayor | the main Claude session. It plans a round and writes every brief from the charter plus the round's requirements. |
| charter | the owner's standing instructions, preserved across sessions and platforms. Add to it whenever the owner states a new standing preference. |
| charm | one small parallel chunk of work. An agent does it on a private copy and returns a patch. |
| clerk | the merge agent. It applies every patch to the target, resolves conflicts, builds, and re-runs the charms' targeted tests together. |
| auditor | the full-regression runner. It runs once per pass, at the end, never per stage. |
| inspectors | narrow, adversarial, read-only critics that run alongside the auditor. |
| verifiers | final adversarial checks after a repair. They loop back into repair while issues remain. |
| round | one cycle of owner feedback, run as charms → clerk → auditor + inspectors → repair → clerk → auditor + verifiers. |

## How the charter is preserved

- **Every local session** (Claude Code CLI, IDE extension, desktop app on this Mac) reads `~/.claude/CLAUDE.md`, which imports `charter/CHARTER.md`.
  - Proven 2026-10-30: a fresh `claude -p` session started in an unrelated folder quoted the charter.
  - A subagent started by such a session quoted it too.
- **A session already open** when the charter was added keeps the instructions it loaded at start. Its subagents won't see the charter until a new session starts.
- **Workflow agents** are told by the round engine to read the charter files, and each returns a `charter_ack` (its quote of the charm definition). The engine counts these, so delivery is measured on every run.
- **Claude Code on the web (cloud sessions)** has no `~/.claude`. To reach it, put this folder in a git repo and reference the charter from a repo the cloud session clones (for example, a line in the project's `CLAUDE.md`). That needs the owner's go-ahead (git, and memi is read-only).

## Running a round

The mayor calls the Workflow tool with this script and the round's args (see `rounds/README.md`). The Workflow tool only loads a `scriptPath` from the session's working folder or a folder added to it. From another project, do one of:
- add `/Users/mick/dev/web/uc-optimizer` to the session (`/add-dir`, or `permissions.additionalDirectories` in settings);
- pass the script inline;
- run from a session opened in this folder.

## ptest

See `ptest/README.md`. Import from `/Users/mick/dev/web/uc-optimizer/ptest/ptest.mjs`. Playwright comes from `uc-optimizer/node_modules` (`npm install` here once). Set `PTEST_DUSK_FILE` to point `dusk.open()` at a build. Run the self-test with `node --test ptest/test/ptest.test.mjs` on a quiet machine: the back-off and screenshot tests are load-sensitive.


## governor/

The machine-wide resource and thermal governor (macOS). ptest pools and the gate obey it, and it drives the fans by temperature while uc-optimizer work runs. There are no fixed caps; it publishes `ok`/`hold`/`shed` from memory and swap headroom, the process table and thermal state. See `governor/README.md`. Fan control needs a one-time `sudo sh governor/install-fan-control.sh`.
