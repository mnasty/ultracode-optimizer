# governor: machine-wide resource and thermal control (macOS)

The governor stops uc-optimizer from running the Mac out of resources. It sets no fixed caps on browsers, pages or agents: every limit comes from live signals and from the system's own capacity. Paging is welcome, since compressed memory and swap are fast on Apple silicon. The governor only steps in when the machine nears a critical level.

**Why it exists:** at 23:28 on 2026-10-31 the Mac froze for 11 hours and had to be force-powered off.
- Six test-heavy agents each ran their own Chrome pools, 20 Chromes in all. With the IDE they filled 16 GB, and the disk was too full for swap to take the rest.
- macOS then killed and relaunched its own services in a storm that filled the 4,000-slot process table.

## What it watches (every second)

| Signal | Source | `hold` (start nothing new) | `shed` (cut back) |
|---|---|---|---|
| memory + swap headroom | reclaimable RAM (free + speculative + purgeable + inactive) plus free disk on the VM volume | headroom < 2 × need | headroom < need, macOS pressure critical, or less than one swap file of disk left |
| swap growth room | free disk vs the current drain over the look-ahead | disk can't absorb 60 s of drain plus 2 swap files | as above |
| process table | `ps` vs `kern.maxproc`, and our own processes vs `kern.maxprocperuid` | headroom < 2 × need | headroom < need |
| thermal | macOS thermal pressure, die temperatures, fan speeds | thermal pressure heavy, or fans at full speed with the dies at the hot end | thermal pressure trapping or worse |

`need` is always live: the largest one-second drop seen, or the drain rate × 60 s, whichever is larger. It has a floor: one swap file for memory, 2% of the table for processes.

The level is published to `~/.uc-optimizer/governor.json`, with its reasons and metrics. Level changes go to `governor.log.jsonl`.

## The CPU allowance (2026-11-01)

Each ptest pool used to read the machine-wide CPU busy % on its own. With several pools they all saw the same number, so they all cut together and then all grew together (the auditor's logs swing 1 → 2 → 1 → 2). At a round's start about 38 Chromes ran at load average 450, and Page.goto and screenshot timeouts forced reruns.

Now the governor makes one decision for the whole machine and splits it:

- **One page allowance, from live CPU.** It aims at about 85% busy, smoothed over 3 s:

  | CPU busy (3 s mean) | The allowance |
  |---|---|
  | no history yet | the CPU count (the machine's own capacity) |
  | 92% or more | 0.8 × the pages running (never up), at most once per 3 s |
  | under 75%, level `ok`, a pool has run its whole share for 3 s and wants more | + 25% (at least 1), at most every 2 s, never above what the pools want |
  | in between | held |

  Level `hold` never grows it; level `shed` cuts it × 0.75. After 30 s with no pools it starts from the CPU count again.
- **The split is fair.** Each pool's lease says what it `want`s (running + queued). Pools that don't follow shares (a fixed `opts.concurrency`, `PTEST_ADAPT=0`, a real-time proof running, `PTEST_CPU_SHARES=0`, or an older ptest) keep their pages first. The rest is shared out max-min fair: small pools get what they want, the big ones split what's left. A leftover page stays with the pool that already holds it, so shares don't rotate between pools. Every pool gets at least 1.
- **Published** in `governor.json` every second, as `cpu: { allowance, shares: { <leaseId>: n }, busyPct, targetPct, pagesLive, wantTotal, pools, why, leaseDir }`. A pool follows shares only from a daemon that reads its own lease dir. Every change goes to `governor.log.jsonl`.
- **ptest follows its share** (see its README); with no shares published it falls back to its own controller.

## Who obeys it

- **ptest:**
  - every pool waits before starting Chrome until the level is `ok`;
  - it never grows on `hold`;
  - on `shed` it cuts concurrency by 25% and closes idle browsers;
  - its concurrency follows its CPU share: it starts at it, cuts to it at once and grows toward it (+25% per tick).
- **gate:** `node gate.mjs --name <label> -- <cmd>` runs any other heavy process (`wrangler dev`, `turso dev`, a test runner, a big install) only once the level is `ok`. It marks the work as live while the command runs.
- **The round engine** tells every agent to use both.

## Fans

**The helper's own heat curve is always on**, whatever is running (ours or not): from each fan's minimum at 50°C to full speed at 80°C (176°F). Moderate macOS thermal pressure raises it to at least half speed, heavy to full. After 30 seconds below the curve it gives the fans back to macOS. Apple silicon fans stop when the chip is cool, so they are off when idle and at night.

While uc-optimizer work is live (fresh ptest or gate leases), the governor asks for more, earlier, from the hottest die:

| Die temperature | Fans while work runs |
|---|---|
| below 45°C | automatic |
| 45°C to 85°C (185°F) | linear from each fan's minimum to its maximum |
| 85°C and above | full speed |

- Fans speed up at once and slow down gently. With no work, or after 30 cool seconds, the request is `null`.
- The root helper applies the higher of the request and its own curve every second. A request older than 15 s counts as none.
- **It shares the fans and never takes cooling away:**
  - a fan that another controller (such as Macs Fan Control) forces faster is left alone;
  - a fan forced slower is raised when the heat needs it;
  - it hands back only fans it forced itself and nobody changed since, so a max you set elsewhere survives the end of our work;
  - it writes nothing at start, and nothing while the dies are cool and there's no request.
- Tested in `test/fand.test.mjs` (dry run on a simulated fan state).

**Install once:** `sudo sh install-fan-control.sh`. It builds `native/ucsmc.c` as a root daemon and proves a write. **Remove:** `sudo sh uninstall-fan-control.sh`.

Another fan controller can stay on: the helper only ever adds cooling to what it sets.

## Files

- `governor.mjs`: the daemon and its client API (`readState`, `currentSync`, `ensureGovernor`, `admit`, `gateLease`). CLI: `daemon | status | watch | stop`. It starts on demand and exits after 10 idle minutes.
- `governor.mjs` also reads the pools' leases (`poolLeases`) for the CPU split.
- `policy.mjs`: the decisions as pure functions (`assess`, `fanTarget`, and for the CPU `cpuBusy`, `splitShares`, `cpuAllowance`), unit-tested.
- `sample.mjs`: one machine sample, about 125 ms.
- `native/ucsmc.c`:
  - `sense` reads temperatures (IOHID), fans (SMC) and thermal pressure without root;
  - `fan auto|set|frac` and `fand` need root;
  - add `--dry` to print the writes instead of doing them.
- `test/`: `node --test test/policy.test.mjs test/governor.test.mjs test/fand.test.mjs`. The tests include a replay of the 2026-10-31 storm and the CPU allowance (start, saturation, headroom, hold/shed, the fair split, and the daemon publishing shares for live leases). `test/live/heat.mjs` is a hand-run live check (a real ptest load while the governor runs). Move the fan curve with `UC_GOVERNOR_COOL_C` / `UC_GOVERNOR_HOT_C`.
