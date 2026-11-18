#!/usr/bin/env node
/* gate: run a heavy command only when the machine can take it.
     node gate.mjs [--name <label>] -- <command> [args...]
   Waits while the governor says hold or shed, then runs the command with a lease that marks live work (for the fan curve),
   forwards signals, and exits with the command's exit code. macOS only. */
import { spawn } from 'node:child_process'
import { ensureGovernor, admit, gateLease } from './governor.mjs'

const argv = process.argv.slice(2), sep = argv.indexOf('--')
let name = 'gate'
const pre = sep < 0 ? [] : argv.slice(0, sep), cmd = sep < 0 ? argv : argv.slice(sep + 1)
for (let i = 0; i < pre.length; i++) if (pre[i] === '--name') name = pre[++i]
if (!cmd.length) { console.error('usage: gate.mjs [--name <label>] -- <command> [args...]'); process.exit(2) }

await ensureGovernor()
await admit({ who: `${name} (${cmd[0]})`, log: m => console.error(m) })
const lease = gateLease(name)
const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' })
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig))
child.on('exit', (code, sig) => { lease.close(); process.exit(code ?? (sig ? 128 : 1)) })
child.on('error', e => { lease.close(); console.error(`gate: ${e.message}`); process.exit(127) })
