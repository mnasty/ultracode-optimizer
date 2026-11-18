export const meta = {
  name: 'mayor-round',
  description: 'One round of the mayor\'s engine: parallel charms on private copies -> clerk merge -> auditor (full regression) + inspectors at once -> parallel repair charms -> clerk -> auditor + verifiers, looped',
  whenToUse: 'A build round planned by the mayor: pass args (see rounds/README.md) with the charm briefs the mayor wrote from the charter and the round requirements.',
  phases: [
    { title: 'Charms', detail: 'every charm at once, each on a private copy, returning a patch' },
    { title: 'Clerk', detail: 'merge the patches into the target, build, re-run the charms\' targeted tests' },
    { title: 'Inspect', detail: 'auditor (full regression) and narrow inspectors at the same time' },
    { title: 'Repair', detail: 'parallel repair charms, then a clerk merge' },
    { title: 'Verify', detail: 'auditor and verifiers at the same time; loops back to Repair while issues remain' },
  ],
}

// ---------- args (written by the mayor; see rounds/README.md) ----------
const A = args || {}
const req = (k) => { if (A[k] === undefined || A[k] === null || A[k] === '') throw new Error('mayor-round: args.' + k + ' is required'); return A[k] }
const NAME = req('name'), WORK = req('work'), BASE = req('base'), TARGET = req('target'), BUILD = req('build'), BUILT = req('built')
const CHARMS = req('charms'), CHARTER = A.charter || ['/Users/mick/dev/web/uc-optimizer/charter/CHARTER.md']
const REQS = [].concat(A.requirements || []), ARCH = A.archive || '', CTX = A.context || ''
const INSPECTORS = A.inspectors || [], VERIFIERS = A.verifiers || [], AUDIT = A.audit || ''
// optional: a different audit for the verify stages (e.g. url mode only against a recorded baseline), and the mayor's own
// patches merged by an extra clerk after a repair round's clerk ({ afterRepair, ready: <json file listing patch reports>, brief })
const AUDIT_VERIFY = A.auditVerify || AUDIT, MAYOR_MERGE = A.mayorMerge || null
const REPAIRS = A.repairRounds === undefined ? 2 : A.repairRounds, CAP = 8
// mode 'dir': base/target are directories (a whole repo). Each charm works on a private rsync copy and returns a
// git-style binary patch (git diff --no-index a b); the clerk applies it at the target root with git apply -p2.
const DIRM = A.mode === 'dir'
const EXCL = A.exclude || ['node_modules', '.git', '.wrangler', '.react-router', '.DS_Store']
const XS = EXCL.map(e => `--exclude '${e}'`).join(' ')
const SHARED = A.shared || [] // absolute dirs symlinked into every copy (e.g. the target's node_modules)
const link = (to) => SHARED.map(p => ` && ln -sfn ${p} ${to}/${p.split('/').pop()}`).join('')
if (!Array.isArray(CHARMS) || !CHARMS.length) throw new Error('mayor-round: args.charms must be a non-empty array of {id, brief}')

// ---------- shared prompt parts ----------
const pages = (n) => `Machine note: about ${Math.min(n, CAP)} agents work at once on one Mac. ptest is governed: the machine-wide governor (uc-optimizer/governor) publishes ok/hold/shed from memory+swap headroom, the process table and temperature, and every pool waits, holds or sheds by it; do NOT set PTEST_CONCURRENCY, PTEST_BROWSERS or PTEST_BUDGET (and never PTEST_ADAPT=0). Start every other heavy process through the gate, so nothing new starts while the machine is near a critical level: node /Users/mick/dev/web/uc-optimizer/governor/gate.mjs --name <you> -- <cmd> (wrangler dev, turso dev, test runners, npm install). Keep your work folder out of /private/tmp (a reboot wipes it).`
const build = (src, out) => BUILD.replace('{src}', src).replace('{out}', out)
// the archive folder is the stage path under WORK with '/' -> '-' (verify-1/auditor -> verify-1-auditor, repair-2/charm-fix0 -> repair-2-charm-fix0):
// a basename alone collides across stages (every auditor, the repair rounds' charm-fixN, every verify round's ver-*)
const archName = (dir) => dir.startsWith(WORK + '/') ? dir.slice(WORK.length + 1).replace(/\/+$/, '').split('/').join('-') : dir.split('/').filter(Boolean).pop()
const mirror = (dir) => ARCH ? ` Mirror after each saved step: mkdir -p ${ARCH}/${NAME} && rsync -a --exclude out ${dir}/ ${ARCH}/${NAME}/${archName(dir)}/ .` : ''
const HEAD = (role) => `You are ${role} in the mayor's round "${NAME}". The mayor (the main session) planned this round and wrote your brief.
FIRST read these charter files in full and follow them (they are the owner's preserved standing instructions; they override your defaults): ${CHARTER.join(', ')}.
${REQS.length ? `Then read the round's requirements in full (the owner's verbatim words win over everything): ${REQS.join(', ')}.` : ''}
In charter_ack, quote the charter's one-line definition of a "charm" (proves the charter reached you).
Waiting rule: when you wait for a long command (a regression, a build, a server), wait in the foreground: repeat a foreground until-loop on its log (each call under 10 min) until it ends. Never end your turn or give your final answer while it runs: ending your turn ends your step, and the workflow then stops your background commands (verify-2 lost its full regression that way, 2026-11-02).
Shell safety: your shell starts in the session's working folder, which may be the project itself. Use absolute paths in every command, never rely on a cd (use git -C <dir>, absolute rsync paths, or (cd <dir> || exit 1; ...)), and never write option lists into a variable (zsh does not word-split unquoted variables).
${CTX}`
const SPEED = `Speed rule: no full regression in this step (the auditor runs it at the end). Only quick targeted checks of your own change. Speed matters more than tokens.`
const ACK = { charter_ack: { type: 'string', description: 'the charter\'s definition of a charm, quoted' } }
const PATCH = { type: 'object', properties: { ...ACK,
  summary: { type: 'string' }, patch: { type: 'string', description: 'absolute path of patch.diff (unified diff against the base you were given)' },
  fixed: { type: 'array', items: { type: 'string' }, description: 'ids done and checked' },
  not_fixed: { type: 'array', items: { type: 'string' }, description: 'ids not done, each with the reason or the evidence that the finding is wrong' },
  regions: { type: 'array', items: { type: 'string' }, description: 'what the patch touches (functions, selectors, ids), for the clerk' },
  tests: { type: 'array', items: { type: 'string' }, description: 'absolute paths of targeted tests that take the built file via env FILE' },
  owner_decisions: { type: 'array', items: { type: 'string' } }, owner_answers: { type: 'array', items: { type: 'string' } } },
  required: ['summary', 'patch', 'fixed', 'regions', 'tests'] }
const CLERK = { type: 'object', properties: { ...ACK,
  summary: { type: 'string' }, merged: { type: 'array', items: { type: 'string' } }, conflicts: { type: 'array', items: { type: 'string' }, description: 'how each conflict was resolved, or why a fix could not be combined' },
  evidence: { type: 'array', items: { type: 'string' } }, snapshot_src: { type: 'string' }, snapshot_built: { type: 'string' }, open_issues: { type: 'array', items: { type: 'string' } } },
  required: ['summary', 'merged', 'conflicts', 'evidence', 'snapshot_src', 'snapshot_built'] }
const FINDING = { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, requirement: { type: 'string' },
  problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['id', 'severity', 'problem', 'evidence', 'fix'] }
const FINDINGS = { type: 'object', properties: { ...ACK, summary: { type: 'string' }, totals: { type: 'string', description: 'auditor only: every pool passed/total, page errors, wall time' },
  findings: { type: 'array', items: FINDING }, praise: { type: 'array', items: { type: 'string' } }, owner_decisions: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'findings'] }
const VERDICT = { type: 'object', properties: { ...ACK, summary: { type: 'string' }, ready_for_owner: { type: 'boolean' },
  per_item: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['resolved', 'partly', 'unresolved', 'regressed', 'owner-decision'] }, evidence: { type: 'string' } }, required: ['id', 'status', 'evidence'] } },
  new_problems: { type: 'array', items: { type: 'string' } }, owner_decisions: { type: 'array', items: { type: 'string' } } }, required: ['summary', 'ready_for_owner', 'per_item', 'new_problems'] }

// ---------- agents ----------
const charm = (c, base, stage, n) => {
  const dir = `${WORK}/${stage}/charm-${c.id}`
  return agent(`${HEAD('a charm (one small parallel chunk)')}
${pages(n)}
${SPEED}
${DIRM
  ? `Progress protocol: your folder is ${dir}/ (mkdir -p). If ${dir}/report.json exists, return its content. If ${dir}/b is missing: rsync -a ${XS} ${base}/ ${dir}/a/ && rsync -a ${XS} ${base}/ ${dir}/b/${link(dir + '/b')} ; else continue from progress.md. ${dir}/a is the pristine base (never edit it); work ONLY in ${dir}/b. NEVER edit ${TARGET} or ${base}: other charms run in parallel and the clerk merges your patch. Stay inside the files your brief gives you, so patches merge cleanly. ${SHARED.length ? `Shared dirs are symlinked into your copy (${SHARED.join(', ')}): never modify them; if you truly need a new package, add it to package.json and say "dep:<name>@<version>" in regions (the clerk installs once), and install it only into a private copy (replace the symlink with cp -R of it). ` : ''}Build your copy with: ${build(dir + '/b', dir + '/built')}. Write a small targeted test per change (the project's own stack; ptest per the charter for browser checks) that reads the app root from env APP_DIR (and a built file/URL from env FILE where relevant), and run it once on your copy (APP_DIR=${dir}/b). LOOK at shots for visual work. When done: git -C ${dir} diff --no-index --binary a b > ${dir}/patch.diff (exit status 1 just means there are differences); it must apply with "git apply -p2" from the target root. Write ${dir}/report.json (your return value).${mirror(dir)}`
  : `Progress protocol: your folder is ${dir}/ (mkdir -p). If ${dir}/report.json exists, return its content. If ${dir}/src.html is missing: cp ${base} ${dir}/src.html; else continue from progress.md. NEVER edit ${TARGET} or ${base}: other charms run in parallel and the clerk merges your patch. Keep the change minimal and local (as few lines as possible) so it merges cleanly. Build your copy with: ${build(dir + '/src.html', dir + '/built.html')}. Write a small targeted test per change (ptest per the charter) that reads the built file from env FILE, run it once on your build (FILE=${dir}/built.html), LOOK at shots for visual work. When done: diff -u ${base} ${dir}/src.html > ${dir}/patch.diff ; write ${dir}/report.json (your return value).${mirror(dir)}`}
Your brief (id ${c.id}):
${c.brief}`, { label: `charm:${stage}:${c.id}`, phase: stage.startsWith('repair') ? 'Repair' : 'Charms', schema: PATCH })
}
const clerk = (patches, base, stage) => {
  const dir = `${WORK}/${stage}`, good = patches.filter(Boolean)
  return agent(`${HEAD('the clerk (the merge agent)')}
Machine note: you are the only agent testing; ptest adapts on its own (do not set PTEST_CONCURRENCY).
${SPEED}
${DIRM
  ? `Progress protocol: your folder is ${dir}/ (mkdir -p). If ${dir}/report.json exists, rsync -a --delete ${XS} ${dir}/src/ ${TARGET}/, rebuild, and return the report. Else continue from ${dir}/progress.md if it exists.
Steps: (1) Unless progress.md says the merge already started, make the target equal the base: rsync -a --delete ${XS} ${base}/ ${TARGET}/ (excluded paths are left alone). Apply every patch below in order: git -C ${TARGET} apply -p2 --reject <absolute patch path> (whitespace issues: add --whitespace=nowarn); resolve every *.rej by hand by understanding both intents, then delete the .rej/.orig files; never drop a fix silently. If any patch changed package.json or regions list "dep:", run the install once (npm install). (2) Build: ${build(TARGET, BUILT)}. (3) Run ALL the charms' targeted tests against the merged target (APP_DIR=${TARGET}, FILE=${BUILT}) together (one ptest pool via runSuites for browser tests; one run of the unit tests); fix integration breakage with the smallest change. ${A.after ? `(4) ${A.after}` : ''} (5) Snapshot: rsync -a --delete ${XS} ${TARGET}/ ${dir}/src/ ; rsync -a --delete ${BUILT}/ ${dir}/built/ (if ${BUILT} is a file: cp it to ${dir}/built). snapshot_src = ${dir}/src, snapshot_built = ${dir}/built (later stages test the snapshot). Write ${dir}/report.json (return value).${mirror(dir)}`
  : `Progress protocol: your folder is ${dir}/ (mkdir -p). If ${dir}/report.json exists, cp ${dir}/src.html ${TARGET}, rebuild, and return the report. Else continue from ${dir}/progress.md if it exists.
Steps: (1) cp ${base} ${TARGET} (unless progress.md says the merge already started); apply every patch below in order (patch, git apply --3way-free tools, or by hand); resolve conflicts by understanding both intents; never drop a fix silently. (2) Build: ${build(TARGET, BUILT)}. (3) Run ALL the charms' targeted tests against the merged build (FILE=${BUILT}) in ONE ptest pool (runSuites); fix integration breakage with the smallest change. ${A.after ? `(4) ${A.after}` : ''} (5) Snapshot: cp ${TARGET} ${dir}/src.html; cp ${BUILT} ${dir}/built.html (later stages test the snapshot). Write ${dir}/report.json (return value).${mirror(dir)}`}
Patches: ${JSON.stringify(good.map(p => ({ patch: p.patch, fixed: p.fixed, not_fixed: p.not_fixed, regions: p.regions, tests: p.tests })))}
${patches.length - good.length ? `Note: ${patches.length - good.length} charm(s) returned nothing; list what is missing in open_issues.` : ''}`, { label: 'clerk:' + stage, phase: stage.startsWith('repair') ? 'Repair' : 'Clerk', schema: CLERK })
}
const mayorClerk = (m, base, stage) => {
  const dir = `${WORK}/${stage}`
  return agent(`${HEAD('the clerk (the merge agent) for the mayor\'s own patches')}
Machine note: other agents may be testing; ptest adapts on its own (do not set PTEST_CONCURRENCY).
${SPEED}
Progress protocol: your folder is ${dir}/ (mkdir -p). If ${dir}/report.json exists, rsync -a --delete ${XS} ${dir}/src/ ${TARGET}/, rebuild, and return the report. Else continue from ${dir}/progress.md if it exists.
Wait first: until ${m.ready} exists, poll every 60 s (up to ${m.waitMin || 240} min; past that, merge whatever patches exist and list the missing ones in open_issues). That file is JSON: [{patch, fixed, regions, tests, notes}], the mayor's patches in merge order.
Steps: (1) Unless progress.md says the merge already started, make the target equal the base: rsync -a --delete ${XS} ${base}/ ${TARGET}/ (excluded paths are left alone). The base already holds this round's repairs; the mayor's patches were made against an earlier snapshot, so expect conflicts. Apply every patch in order: git -C ${TARGET} apply -p2 --reject <absolute patch path> (whitespace issues: add --whitespace=nowarn); resolve every *.rej by hand, understanding both intents (the repair and the mayor's patch), then delete the .rej/.orig files; never drop a fix silently. (2) Build: ${build(TARGET, BUILT)}. (3) Run every patch's listed tests against the merged target (APP_DIR=${TARGET}, FILE=${BUILT}) together, plus the tests of any repair whose files you had to reconcile; fix integration breakage with the smallest change. ${A.after ? `(4) ${A.after}` : ''} (5) Snapshot: rsync -a --delete ${XS} ${TARGET}/ ${dir}/src/ ; rsync -a --delete ${BUILT}/ ${dir}/built/ (if ${BUILT} is a file: cp it to ${dir}/built). snapshot_src = ${dir}/src, snapshot_built = ${dir}/built (later stages test the snapshot). Write ${dir}/report.json (return value).${mirror(dir)}
The mayor's instructions for this merge: ${m.brief || '(none)'}`, { label: 'clerk:' + stage, phase: 'Repair', schema: CLERK })
}
const readonly = (role, dir, file, brief, schema, phaseName, n, label) => agent(`${HEAD(role)}
${pages(n)}
Progress protocol: your folder is ${dir}/ (mkdir -p). If ${dir}/report.json exists, return its content; else continue from ${dir}/progress.md if it exists. You are READ-ONLY: test only ${file} (and the reference files your brief names) and never edit anything outside your folder. Append findings to ${dir}/findings.md as you go; write ${dir}/report.json (return value).${mirror(dir)}
${brief}`, { label, phase: phaseName, schema })
const auditor = (file, stage, n) => readonly('the auditor (the full-regression runner)', `${WORK}/${stage}/auditor`, file,
  `Run the full regression against ${file}: ${(stage.startsWith('verify') ? AUDIT_VERIFY : AUDIT) || 'every suite the requirements and charter name'}. Group suites into a few runSuites pools and run independent pools AT THE SAME TIME, not one after another. Don't set PTEST_CONCURRENCY or PTEST_BROWSERS: ptest shares the machine-wide budget and scales each pool with live load by itself. For each failure decide: a real defect (finding with evidence + simple fix) or a stale assertion about something the round deliberately changed (finding with requirement "test" and the exact test edit). Do not report the known noise the project charter lists. Ids prefixed AUD-. totals: every pool passed/total, page errors, wall time.`,
  FINDINGS, stage.startsWith('verify') ? 'Verify' : 'Inspect', n, 'auditor:' + stage)
const inspector = (x, file, stage, n) => readonly(`an inspector (an independent, adversarial, read-only critic) for area "${x.id}"`, `${WORK}/${stage}/insp-${x.id}`, file,
  `Find what is still wrong, broken, ugly or unfaithful to the owner's words in your area; every finding needs measured or visual evidence and a SIMPLE fix (never a new device or system). Severity: blocker = violates the owner's words or breaks the flow; major = clearly visible; minor = polish. Ids prefixed ${x.id.toUpperCase()}-. Keep matrices small and targeted (the auditor runs the full regression right now).
Your area: ${x.brief}`, FINDINGS, 'Inspect', n, 'inspector:' + x.id)
const verifier = (v, file, stage, n, focus) => readonly(`a verifier (final, adversarial; default to "unresolved" when evidence is unclear) for "${v.id}"`, `${WORK}/${stage}/ver-${v.id}`, file,
  `Check yourself on the built file (not the charms' logs), against the owner's words. ${focus ? `Focus first on these open items from the last pass: ${focus}. ` : ''}Your scope: ${v.brief}`, VERDICT, 'Verify', n, `verifier:${stage}:${v.id}`)

const groups = (fs, per) => { const g = {}; fs.forEach(f => { const k = String(f.id || 'X').split('-')[0]; (g[k] = g[k] || []).push(f) })
  return Object.values(g).flatMap(a => { const out = []; for (let i = 0; i < a.length; i += per) out.push(a.slice(i, i + per)); return out }) }
const asCharms = (fs, per) => groups(fs, per).map((g, i) => ({ id: 'fix' + i, brief: `Fix these findings with the simplest correct change. A finding with requirement "test" is fixed by editing that test file (list it in tests). If a finding is wrong, give the evidence in not_fixed instead of changing the work.\nFindings: ${JSON.stringify(g)}` }))
const acks = []
const note = (x) => { if (x && x.charter_ack) acks.push(x.charter_ack); return x }

// ---------- the round ----------
phase('Charms')
log(`${NAME}: ${CHARMS.length} charms at once (cap ${CAP})`)
const p1 = (await parallel(CHARMS.map(c => () => charm(c, BASE, 'charms', CHARMS.length)))).map(note)
log(`charms: ${p1.filter(Boolean).length}/${CHARMS.length} returned patches`)
phase('Clerk')
const m1 = note(await clerk(p1, BASE, 'clerk-1'))
if (!m1) throw new Error('clerk-1 returned nothing; stopping (charm patches are kept in ' + WORK + '/charms)')
let snapSrc = m1.snapshot_src, snapBuilt = m1.snapshot_built

phase('Inspect')
const nI = INSPECTORS.length + 1
const [aud1, ...ins] = (await parallel([() => auditor(snapBuilt, 'inspect', nI), ...INSPECTORS.map(x => () => inspector(x, snapBuilt, 'inspect', nI))])).map(note)
let open = [...ins.filter(Boolean).flatMap(r => r.findings || []), ...((aud1 && aud1.findings) || [])]
log(`inspect: ${open.length} findings (${open.filter(f => f.severity === 'blocker').length} blocker, ${open.filter(f => f.severity === 'major').length} major)`)

const passes = [{ stage: 'inspect', auditor: aud1, inspectors: ins }], merges = [m1], repairs = []
let verdicts = []
for (let r = 1; r <= REPAIRS + 1; r++) {
  if (open.length && r <= REPAIRS + (verdicts.length ? 0 : 1)) {
    phase('Repair')
    const rc = asCharms(open, 3)
    const pr = (await parallel(rc.map(c => () => charm(c, snapSrc, 'repair-' + r, rc.length)))).map(note)
    repairs.push(pr)
    const mr = note(await clerk(pr, snapSrc, 'repair-' + r + '-clerk'))
    if (!mr) throw new Error('repair clerk ' + r + ' returned nothing; stopping')
    merges.push(mr); snapSrc = mr.snapshot_src; snapBuilt = mr.snapshot_built
    if (MAYOR_MERGE && MAYOR_MERGE.afterRepair === r) {
      const mm = note(await mayorClerk(MAYOR_MERGE, snapSrc, 'repair-' + r + '-mayor-clerk'))
      if (!mm) throw new Error('mayor clerk ' + r + ' returned nothing; stopping')
      merges.push(mm); snapSrc = mm.snapshot_src; snapBuilt = mm.snapshot_built
    }
  } else if (verdicts.length) break
  if (!VERIFIERS.length && !AUDIT) break
  phase('Verify')
  const focus = open.map(o => o.id + ': ' + o.problem).join(' | ').slice(0, 6000)
  const nV = VERIFIERS.length + 1
  const [audV, ...vs] = (await parallel([() => auditor(snapBuilt, 'verify-' + r, nV), ...VERIFIERS.map(v => () => verifier(v, snapBuilt, 'verify-' + r, nV, verdicts.length ? focus : ''))])).map(note)
  verdicts = vs.filter(Boolean)
  passes.push({ stage: 'verify-' + r, auditor: audV, verifiers: verdicts })
  open = [
    ...verdicts.flatMap(v => (v.per_item || []).filter(p => ['unresolved', 'partly', 'regressed'].includes(p.status)).map(p => ({ id: 'V' + r + '-' + p.id, severity: 'major', problem: `${p.id} is ${p.status}`, evidence: p.evidence, fix: 'resolve it per the owner\'s words' }))),
    ...verdicts.flatMap(v => (v.new_problems || []).map((t, k) => ({ id: `VN${r}-${k}`, severity: 'major', problem: t, evidence: 'verifier ' + v.summary.slice(0, 200), fix: 'fix it simply' }))),
    ...((audV && audV.findings) || []),
  ]
  log(`verify ${r}: ${open.length} open`)
  if (!open.length || r > REPAIRS) break
}

const all = [...p1, ...repairs.flat(), ...merges, ...passes.flatMap(p => [p.auditor, ...(p.inspectors || []), ...(p.verifiers || [])])].filter(Boolean)
log(`charter acknowledged by ${acks.length}/${all.length} agents`)
return { name: NAME, final_src: snapSrc, final_built: snapBuilt, target: TARGET, open, ready: !open.length && verdicts.every(v => v.ready_for_owner !== false),
  charms: p1, merges, repairs, passes, charter_acks: { acknowledged: acks.length, agents: all.length, sample: acks.slice(0, 3) },
  owner_decisions: all.flatMap(x => x.owner_decisions || []), owner_answers: all.flatMap(x => x.owner_answers || []) }
