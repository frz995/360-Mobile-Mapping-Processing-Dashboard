// Cross-platform ESLint flat-config launcher for the `lint` npm script.
// ESLint 8.57 CLI needs ESLINT_USE_FLAT_CONFIG=true to load eslint.config.mjs.
// We set it in-process then spawn the CLI as a child so a fresh eslint module
// picks it up (avoiding fragile inline env vars on Windows).
//
// Legacy code is linted at WARN severity (non-blocking); only errors fail the
// run so the gate stays real but not blocking yet.
//
// This script also enforces the ratchets in scripts/quality-baseline.json:
// file-size budgets (fails) and the empty-catch count (report only). See that
// file for the recorded definitions — the ratchet is only meaningful against a
// baseline that was measured rather than estimated.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { classifyCatches, collectSourceFiles } from './audit/source-metrics.mjs'
import { runStaticAudit, diffAgainstBaseline } from './audit/static-scan.mjs'

process.env.ESLINT_USE_FLAT_CONFIG = 'true'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const eslintBin = path.resolve(here, '..', 'node_modules', 'eslint', 'bin', 'eslint.js')
const nodeExec = process.execPath

/**
 * eslint is run twice: once with `-f json` so counts can be parsed for the
 * ratchet, and once with inherited stdio so the developer still sees the
 * familiar human-readable report. Running JSON-only would be faster, but the
 * point of a lint gate is the output a person reads; a bare "1228 warnings"
 * is not actionable.
 */
const parsed = spawnSync(nodeExec, [eslintBin, 'src', 'vitest.config.ts', '-f', 'json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
})

if (parsed.error || parsed.status === null) {
  console.error('lint: could not run eslint:', parsed.error?.message ?? 'no exit status')
  process.exit(1)
}

// Re-run for the readable report. A non-zero exit here is still a pass for the
// ratchet logic below; the exit code is decided at the end.
spawnSync(nodeExec, [eslintBin, 'src', 'vitest.config.ts'], { stdio: 'inherit' })

const baselinePath = path.join(here, 'quality-baseline.json')
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

/** ESLint severity: 2 = error (blocking), 1 = warning. */
const SEVERITY_ERROR = 2

function tally(report) {
  let errors = 0
  let warnings = 0
  const byRule = new Map()

  for (const file of report) {
    for (const message of file.messages ?? []) {
      if (message.severity === SEVERITY_ERROR) errors++
      else warnings++
      if (message.ruleId) {
        byRule.set(message.ruleId, (byRule.get(message.ruleId) ?? 0) + 1)
      }
    }
  }
  return { errors, warnings, byRule }
}

let eslintReport
try {
  eslintReport = JSON.parse(parsed.stdout || '[]')
} catch {
  console.error('lint: could not parse eslint JSON output.')
  process.exit(1)
}

const { errors, warnings, byRule } = tally(eslintReport)

// --- Warning ratchet -------------------------------------------------------
// Report-only. The plan is explicit that this number may only fall for now: a
// gate on a legacy count this large would need either 1228 justified
// suppressions (noise) or 1228 speculative rewrites (danger).
const budgetWarnings = baseline.lint.warnings
const warningDelta = warnings - budgetWarnings
const warningNote =
  warningDelta === 0
    ? 'at baseline'
    : warningDelta < 0
      ? `${-warningDelta} below baseline`
      : `${warningDelta} ABOVE baseline`

console.log('\n--- quality ratchet ---')
console.log(`lint warnings   ${warnings} / ${budgetWarnings} budget (${warningNote})`)

if (warningDelta > 0) {
  for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
    const wasBudget = baseline.lint.byRule[rule]
    if (wasBudget === undefined) {
      console.log(`  NEW RULE      ${rule}: ${count}`)
    } else if (count > wasBudget) {
      console.log(`  REGRESSED     ${rule}: ${count} (was ${wasBudget})`)
    }
  }
}

// --- Empty-catch ratchet ---------------------------------------------------
// Report-only for the same reason as the warning count. A swallowed error is
// not always a defect — best-effort telemetry genuinely does not warrant
// failing a build — so the count is surfaced, not enforced. It is what makes
// section 1's work visible and stops the class from regrowing silently.
// classifyCatches and collectSourceFiles live in scripts/audit/source-metrics.mjs
// so this ratchet and npm run audit:static count the same thing by construction.

const SRC_DIR = path.join(repoRoot, 'src')

let strictCatches = 0
let consoleCatches = 0
for (const file of collectSourceFiles(SRC_DIR)) {
  const { strict, consoleOnly } = classifyCatches(readFileSync(file, 'utf8'))
  strictCatches += strict
  consoleCatches += consoleOnly
}

const catchNote =
  strictCatches + consoleCatches <= baseline.emptyCatch.strict + baseline.emptyCatch.consoleOnly
    ? 'at or below baseline'
    : 'ABOVE baseline'
console.log(
  `empty catches   ${strictCatches} strict + ${consoleCatches} console-only ` +
    `(baseline ${baseline.emptyCatch.strict} + ${baseline.emptyCatch.consoleOnly}, ${catchNote})`
)

// --- File-size budgets -----------------------------------------------------
// This one FAILS. The god files are not being refactored in this plan, but the
// risk is regrowth, not the existing size, so the budget pins today's size and
// raising it becomes a deliberate act with a visible diff.
const budgets = baseline.fileSizeBudgets
const overBudget = []
for (const [rel, budget] of Object.entries(budgets)) {
  const full = path.join(repoRoot, rel)
  if (!existsSafe(full)) continue
  // Physical line count: split on \n so blank lines count. PowerShell's
  // Measure-Object -Line skips them and undercounts by ~8%, which is how the
  // first draft of these budgets came to sit below the real file sizes.
  const lines = readFileSync(full, 'utf8').split('\n').length
  if (lines > budget) overBudget.push({ rel, lines, budget, over: lines - budget })
}

function existsSafe(p) {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}

if (overBudget.length === 0) {
  console.log(`file budgets    ${Object.keys(budgets).length} files within budget`)
} else {
  console.log(`file budgets    ${overBudget.length} file(s) OVER BUDGET:`)
  for (const f of overBudget) {
    console.log(`  ${f.rel}: ${f.lines} lines, budget ${f.budget} (+${f.over})`)
  }
}

// --- Security-surface audit ------------------------------------------------
// Report-only this round (blocking in WP 9). The numbers come from the same
// scanner `npm run audit:static` runs, so this line cannot claim a fix the
// command would contradict. A regression is printed loudly but does not fail
// the lint gate yet — the gate that fails today is the audit command itself.
const audit = runStaticAudit(repoRoot)
const auditBaseline = JSON.parse(readFileSync(path.join(here, 'audit', 'baseline.json'), 'utf8'))
const auditRows = diffAgainstBaseline(audit, auditBaseline)
const auditRegressions = auditRows.filter((r) => r.status === 'WORSE' || r.status === 'NEW')
console.log(
  `audit surfaces  ${audit.metrics.wildcardPostMessage} wildcard postMessage, ` +
    `${audit.metrics.unvalidatedWindowListeners} unvalidated listener(s), ` +
    `${audit.metrics.dangerouslySetInnerHTML} raw HTML, ` +
    `${audit.metrics.zeroCoercions} zero-coercion(s) (report only)`
)
for (const row of auditRegressions) {
  console.log(`  REGRESSED     ${row.key}: ${row.expected ?? 'unmeasured'} -> ${row.actual}`)
}

// --- Exit ------------------------------------------------------------------
// ESLint errors are blocking. Budget overruns are blocking too, which is the
// whole point: growing a god file should require editing the baseline on
// purpose. The two counters above are report-only.
if (overBudget.length > 0) {
  console.error(
    '\nlint: a file exceeded its size budget. Either split it, or raise the ' +
      'number in scripts/quality-baseline.json deliberately.'
  )
}

process.exit(errors > 0 || overBudget.length > 0 ? 1 : (parsed.status ?? 0))