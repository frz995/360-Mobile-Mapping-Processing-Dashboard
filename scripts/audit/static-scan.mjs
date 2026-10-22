// The audit ratchet. One command, one number per surface, compared against a
// baseline that was measured rather than estimated.
//
// WHY IT EXISTS
//   The v40 audit found that the previous round had declared a security fix
//   complete while 108 of 121 outbound messages still broadcast to '*'. Numbers
//   in a plan document decay; numbers in a failing command do not. This script
//   turns each audited surface into a counter and refuses to let any of them
//   grow. It is report-only inside `scripts/lint.mjs` for this round, and
//   blocking on its own via `npm run audit:static`.
//
// WHAT IT IS NOT
//   Not a security verdict. These are structural counts over source text; a
//   count of 0 means "no instance of the pattern", not "no vulnerability". The
//   migration half is a review of what the SQL will produce, not a query against
//   a live database — that is `npm run db:gate`.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import {
  readSourceTree,
  classifyCatches,
  countInlineEmptyCatches,
  stripComments
} from './source-metrics.mjs'
import { scanPostMessage } from './postmessage-scan.mjs'
import { scanMigrations, ANON_DEFINER_ALLOW_LIST } from './definer-scan.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const baselinePath = path.join(here, 'baseline.json')

const count = (files, re) =>
  files.reduce((n, f) => n + (f.text.match(re) ?? []).length, 0)

/**
 * A literal that is a credential, not a name that sounds like one.
 *
 * The first version of this metric matched `service_role` and reported one
 * hardcoded secret — which turned out to be the word `service_role` inside a
 * comment in `consoleAccess.ts` explaining why that key never reaches the
 * browser. A detector that fires on its own documentation is worse than none:
 * it trains the reader to ignore it. So: strip comments, and require the shape
 * of a real credential (a long provider prefix or a JWT literal).
 */
const HARDCODED_SECRET =
  /\b(?:sk_live_[0-9A-Za-z]{8,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{10,})\b|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./

/**
 * Client env names that say "credential" in their own name.
 *
 * `VITE_SUPABASE_KEY` / `VITE_SUPABASE_ANON_KEY` are the anon key and are
 * public by design, so they are allow-listed rather than counted — otherwise
 * the metric could never reach zero and would stop meaning anything.
 */
const CREDENTIAL_ENV = /(?:^|_)(?:API_KEY|SECRET|TOKEN|PASSWORD)$/i
const PUBLIC_BY_DESIGN_ENV = new Set(['VITE_SUPABASE_KEY', 'VITE_SUPABASE_ANON_KEY'])

export function runStaticAudit(root = repoRoot) {
  const files = readSourceTree(root)
  const bridge = scanPostMessage(files)
  const migrations = scanMigrations(path.join(root, 'supabase', 'migrations'))

  let emptyCatchStrict = 0
  let emptyCatchConsoleOnly = 0
  let inlineEmptyCatch = 0
  const coercionByFile = new Map()
  const dangerousHtmlSites = []

  for (const file of files) {
    const c = classifyCatches(file.text)
    emptyCatchStrict += c.strict
    emptyCatchConsoleOnly += c.consoleOnly
    inlineEmptyCatch += countInlineEmptyCatches(file.text)

    const coercions = (file.text.match(/\?\?\s*0(?![\d.])|\|\|\s*0(?![\d.])/g) ?? []).length
    if (coercions) coercionByFile.set(file.path, coercions)

    file.text.split('\n').forEach((line, i) => {
      if (line.includes('dangerouslySetInnerHTML')) {
        dangerousHtmlSites.push({ file: file.path, line: i + 1 })
      }
    })
  }

  const envNames = new Set()
  for (const file of files) {
    for (const m of file.text.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) {
      envNames.add(m[1])
    }
  }

  const metrics = {
    postMessageCalls: bridge.calls,
    wildcardPostMessage: bridge.wildcardCalls,
    windowMessageListeners: bridge.listeners.length,
    unvalidatedWindowListeners: bridge.unvalidatedListeners.length,
    sourceOnlyWindowListeners: bridge.sourceOnlyListeners.length,
    dangerouslySetInnerHTML: dangerousHtmlSites.length,
    zeroCoercions: [...coercionByFile.values()].reduce((a, b) => a + b, 0),
    emptyCatchStrict,
    emptyCatchConsoleOnly,
    inlineEmptyCatch,
    evalOrNewFunction: count(files, /\beval\s*\(|new\s+Function\s*\(/g),
    todoMarkers: count(files, /\b(TODO|FIXME|HACK|XXX)\b/g),
    // Comments stripped first: see HARDCODED_SECRET.
    hardcodedSecrets: files.reduce(
      (n, f) => n + (stripComments(f.text).match(HARDCODED_SECRET) ?? []).length,
      0
    ),
    secretShapedClientEnv: [...envNames].filter(
      (n) => CREDENTIAL_ENV.test(n) && !PUBLIC_BY_DESIGN_ENV.has(n)
    ).length
  }

  const migrationMetrics = {
    migrations: migrations.migrations,
    definers: migrations.counts.definers,
    definersWithoutSearchPath: migrations.counts.definersWithoutSearchPath,
    definersWithoutRevoke: migrations.counts.definersWithoutRevoke,
    definersExecutableByAnon: migrations.counts.definersExecutableByAnon,
    definersExecutableByAnonNotAllowListed: migrations.definers.filter(
      (f) => f.grantees.includes('anon') && !ANON_DEFINER_ALLOW_LIST.includes(f.name)
    ).length,
    tablesCreated: migrations.tablesCreated,
    tablesWithoutRls: migrations.tablesWithoutRls.length,
    createPolicyStatements: migrations.createPolicyStatements
  }

  return {
    metrics,
    migrationMetrics,
    detail: {
      wildcardByFile: bridge.wildcardByFile,
      unvalidatedListeners: bridge.unvalidatedListeners,
      sourceOnlyListeners: bridge.sourceOnlyListeners,
      definersWithoutRevoke: migrations.definers
        .filter((f) => !f.revokedFromPublic)
        .map((f) => ({ name: f.name, file: f.file })),
      anonExecutableDefiners: migrations.definers
        .filter((f) => f.grantees.includes('anon'))
        .map((f) => ({ name: f.name, allowListed: ANON_DEFINER_ALLOW_LIST.includes(f.name) })),
      tablesWithoutRls: migrations.tablesWithoutRls,
      coercionByFile: [...coercionByFile.entries()]
        .map(([file, value]) => ({ file, value }))
        .sort((a, b) => b.value - a.value || a.file.localeCompare(b.file)),
      dangerousHtmlSites,
      secretShapedClientEnv: [...envNames].filter(
        (n) => CREDENTIAL_ENV.test(n) && !PUBLIC_BY_DESIGN_ENV.has(n)
      )
    }
  }
}

export function diffAgainstBaseline(current, baseline) {
  const rows = []
  const consider = (scope, key, expected) => {
    const actual = current[scope]?.[key]
    if (actual === undefined) return
    if (expected === undefined) {
      rows.push({ scope, key, actual, expected: null, status: 'NEW' })
      return
    }
    const status = actual > expected ? 'WORSE' : actual < expected ? 'BETTER' : 'SAME'
    rows.push({ scope, key, actual, expected, status })
  }

  for (const key of Object.keys(current.metrics)) consider('metrics', key, baseline.metrics?.[key])
  for (const key of Object.keys(current.migrationMetrics)) {
    consider('migrationMetrics', key, baseline.migrationMetrics?.[key])
  }
  return rows
}

function main() {
  const asJson = process.argv.includes('--json')
  const writeBaseline = process.argv.includes('--write-baseline')
  const report = runStaticAudit()

  if (writeBaseline) {
    const payload = {
      _why:
        'Measured audit baselines for scripts/audit/static-scan.mjs. Every number was produced by running the scanner, not estimated. A count may only fall: the comparison fails when a value increases. See implementation_plan_v40.md WP 0.',
      capturedAt: new Date().toISOString().slice(0, 10),
      scope:
        'src/**/*.ts,tsx excluding __tests__/*.test/*.spec; supabase/migrations/*.sql. Empty-catch figures use the same classifier as scripts/lint.mjs so the two ratchets cannot disagree.',
      metrics: report.metrics,
      migrationMetrics: report.migrationMetrics
    }
    writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n')
    console.log(`audit baseline written to ${path.relative(repoRoot, baselinePath)}`)
    return 0
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return 0
  }

  let baseline
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  } catch {
    console.error('audit: scripts/audit/baseline.json is missing or unreadable.')
    console.error('audit: run `npm run audit:static -- --write-baseline` once to record it.')
    return 1
  }

  const rows = diffAgainstBaseline(report, baseline)
  const worse = rows.filter((r) => r.status === 'WORSE' || r.status === 'NEW')

  console.log('\n--- static audit ---')
  for (const row of rows) {
    const mark =
      row.status === 'WORSE' ? 'REGRESSED' : row.status === 'BETTER' ? 'improved ' : '         '
    const target = row.expected === null ? 'new' : String(row.expected)
    console.log(
      `  ${row.key.padEnd(38)} ${String(row.actual).padStart(6)}  (baseline ${target})  ${mark}`
    )
  }

  if (worse.length > 0) {
    console.error('\naudit: a counted surface grew. Reduce it, or pin the reason in baseline.json deliberately.')
    for (const row of worse) {
      console.error(`  ${row.key}: ${row.expected ?? 'unmeasured'} -> ${row.actual}`)
    }
    return 1
  }

  if (report.detail.unvalidatedListeners.length > 0) {
    console.log('\n  message listeners with no sender check:')
    for (const l of report.detail.unvalidatedListeners) {
      console.log(`    ${l.file}:${l.line}  (${l.handler})`)
    }
  }
  if (report.detail.wildcardByFile.length > 0) {
    console.log('\n  wildcard postMessage by file:')
    for (const w of report.detail.wildcardByFile) {
      console.log(`    ${String(w.count).padStart(3)}  ${w.file}`)
    }
  }

  console.log('\naudit: at or below every baseline.')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
