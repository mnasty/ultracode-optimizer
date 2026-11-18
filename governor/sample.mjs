// one machine sample for the governor (macOS only): memory, swap room, process table, cpu, temperatures, fans.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const UCSMC = path.join(HERE, 'native', 'ucsmc')
const SRC = path.join(HERE, 'native', 'ucsmc.c')

const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' } }

/** build the native sensor tool if it is missing or older than its source */
export function ensureNative() {
  if (process.platform !== 'darwin') throw new Error('uc-optimizer governor: macOS only')
  let stale = true
  try { stale = fs.statSync(UCSMC).mtimeMs < fs.statSync(SRC).mtimeMs } catch { }
  if (stale) execFileSync('clang', ['-O2', '-o', UCSMC, SRC, '-framework', 'IOKit', '-framework', 'CoreFoundation'], { stdio: 'ignore' })
  return UCSMC
}

let lastCpu = null
const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a }, { idle: 0, total: 0 })

export function parseVmStat(txt) {
  const page = +(/page size of (\d+) bytes/.exec(txt)?.[1] || 16384)
  const n = k => +(new RegExp(`${k}:\\s+(\\d+)`).exec(txt)?.[1] || 0)
  return { page, free: n('Pages free'), inactive: n('Pages inactive'), speculative: n('Pages speculative'), purgeable: n('Pages purgeable'),
    compressor: n('Pages occupied by compressor'), swapins: n('Swapins'), swapouts: n('Swapouts') }
}
export function parseSwap(txt) { // "total = 2048.00M  used = 1093.50M  free = 954.50M  (encrypted)"
  const mb = k => +(new RegExp(`${k} = ([\\d.]+)M`).exec(txt)?.[1] || 0) * 2 ** 20
  return { total: mb('total'), used: mb('used') }
}

export function sample() {
  const t = Date.now()
  const sy = sh('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level', 'hw.memsize', 'kern.maxproc', 'kern.maxprocperuid', 'vm.swapusage']).trim().split('\n')
  const [lvl, memsize, maxproc, maxprocperuid] = sy.slice(0, 4).map(Number)
  const swap = parseSwap(sy[4] || '')
  const vm = parseVmStat(sh('vm_stat', []))
  const ramAvailBytes = (vm.free + vm.inactive + vm.speculative + vm.purgeable) * vm.page
  const df = sh('df', ['-k', '/System/Volumes/VM']).trim().split('\n').pop().split(/\s+/)
  const vmDiskFreeBytes = (+df[3] || 0) * 1024
  const uids = sh('ps', ['-A', '-o', 'uid=']).trim().split('\n').filter(Boolean)
  const me = String(process.getuid())
  const c = cpuTimes(), cpuBusyPct = lastCpu && c.total > lastCpu.total ? Math.round(100 * (1 - (c.idle - lastCpu.idle) / (c.total - lastCpu.total))) : null
  lastCpu = c
  let sense = {}
  try { sense = JSON.parse(sh(ensureNative(), ['sense']) || '{}') } catch { }
  return {
    t, pressureLevel: lvl || 1, memsizeBytes: memsize, ramAvailBytes, compressorBytes: vm.compressor * vm.page, swapUsedBytes: swap.used, swapTotalBytes: swap.total,
    swapins: vm.swapins, swapouts: vm.swapouts, vmDiskFreeBytes,
    procs: uids.length, userProcs: uids.filter(u => u.trim() === me).length, maxproc, maxprocperuid,
    cpuBusyPct, thermalPressure: sense.thermalPressure ?? 0, cpuMaxC: sense.cpuMaxC ?? null, cpuAvgC: sense.cpuAvgC ?? null, fans: sense.fans || [],
  }
}
