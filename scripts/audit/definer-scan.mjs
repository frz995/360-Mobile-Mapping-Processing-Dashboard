// Migration audit: what the database will actually end up with, not what the
// first migration that mentioned a name said.
//
// WHY "LATEST DEFINITION" IS THE ONLY HONEST UNIT
//   Migrations are applied in order and `create or replace function` is
//   cumulative. A naive scan that pairs each `create function` with the next
//   `security definer` keyword attributes the *following* function's modifier to
//   the preceding body; it reported 31 definer functions with 13 unguarded when
//   the tree contains 22, all of them guarded or intentionally pure. Every
//   count here is therefore keyed by function name and overwritten as the
//   migrations replay, so the result is the schema a fresh bootstrap produces.
//
// WHAT IT CANNOT PROVE
//   Nothing about a live database. `proacl` can be changed outside the
//   migrations, and a policy can be dropped by hand. This is a source-of-truth
//   review of the migrations; the live check lives in `npm run db:gate`.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const FUNCTION_RE = /create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.]+)\s*\(/gi
const DOLLAR_TAG_RE = /\$([A-Za-z_]*)\$/g

/** Find the opening dollar-quote tag at or after `from`, returning tag + index. */
function nextDollarTag(src, from) {
  const re = new RegExp(DOLLAR_TAG_RE.source, 'g')
  re.lastIndex = from
  const m = re.exec(src)
  return m ? { tag: m[0], index: m.index } : null
}

/**
 * Strip the schema qualifier so `public.foo` and `foo` are the same function.
 * Overloads share a name here; that is deliberate, because the grant is on the
 * name and the audit is about exposure rather than signatures.
 */
function bareName(qualified) {
  return qualified.toLowerCase().split('.').pop()
}

/**
 * Strip SQL comments before counting DDL.
 *
 * The first version of this scanner reported a table called `if`: the migration
 * headers discuss `CREATE TABLE IF NOT EXISTS` in prose, the comment marker
 * interrupted the phrase, and the optional `if not exists` group failed to
 * match. Counting DDL from prose is the bug; prose is removed first.
 *
 * A `--` inside a quoted literal would be truncated here. That is acceptable for
 * counting `create table` / `create policy` statements and is called out rather
 * than hidden.
 */
function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
}

/** A captured name that is really the next SQL keyword, not an identifier. */
const SQL_KEYWORDS = new Set(['if', 'not', 'exists', 'only', 'public', 'table'])

export function scanMigrations(migrationsDir) {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  /** name -> latest definition as replayed */
  const latest = new Map()
  /** name -> Set of grantees from the last `grant execute` seen */
  const grants = new Map()
  /** names of functions explicitly revoked from PUBLIC at any point */
  const revoked = new Set()

  const createdTables = new Set()
  const rlsEnabled = new Set()
  let policyStatements = 0

  for (const file of files) {
    const src = readFileSync(path.join(migrationsDir, file), 'utf8')

    // ---- functions ------------------------------------------------------
    const fnRe = new RegExp(FUNCTION_RE.source, 'gi')
    let m
    while ((m = fnRe.exec(src)) !== null) {
      const argsOpen = src.indexOf('(', m.index)
      // Walk to the close of the argument list so a dollar tag inside a default
      // value cannot be mistaken for the body delimiter.
      let depth = 0
      let argsClose = argsOpen
      for (let i = argsOpen; i < src.length; i++) {
        if (src[i] === '(') depth++
        else if (src[i] === ')') {
          depth--
          if (depth === 0) {
            argsClose = i
            break
          }
        }
      }

      const opener = nextDollarTag(src, argsClose)
      if (!opener) continue
      const closer = src.indexOf(opener.tag, opener.index + opener.tag.length)
      if (closer === -1) continue

      const name = bareName(m[1])
      latest.set(name, {
        name,
        file,
        header: src.slice(m.index, opener.index),
        body: src.slice(opener.index + opener.tag.length, closer),
        // The `SET search_path` clause sits in the header, between the return
        // type and `AS $$`; checking the body would miss it.
        searchPath: /set\s+search_path\s*=/i.test(src.slice(m.index, opener.index))
      })
    }

    // ---- grants / revokes ----------------------------------------------
    for (const g of src.matchAll(
      /revoke\s+all\s+on\s+function\s+([a-z0-9_.]+)\s*\([^)]*\)\s+from\s+[^;]+;/gi
    )) {
      const name = bareName(g[1])
      revoked.add(name)
    }

    for (const g of src.matchAll(
      /grant\s+execute\s+on\s+function\s+([a-z0-9_.]+)\s*\([^)]*\)\s+to\s+([^;]+);/gi
    )) {
      const name = bareName(g[1])
      const grantees = g[2]
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      grants.set(name, new Set(grantees))
    }

    // ---- tables, RLS, policies ------------------------------------------
    // Comments first: see stripSqlComments above for why.
    const ddl = stripSqlComments(src)
    for (const t of ddl.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi
    )) {
      const name = t[1].toLowerCase()
      if (!SQL_KEYWORDS.has(name)) createdTables.add(name)
    }
    for (const t of ddl.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi
    )) {
      const name = t[1].toLowerCase()
      if (!SQL_KEYWORDS.has(name)) rlsEnabled.add(name)
    }
    policyStatements += (ddl.match(/create\s+policy\s+/gi) ?? []).length
  }

  // ---- classify ---------------------------------------------------------
  const functions = [...latest.values()]
    .map((f) => {
      const isDefiner = /security\s+definer/i.test(f.header)
      const guard = /require_platform_admin|is_platform_admin/i.test(f.body)
        ? 'platform_admin'
        : /\bauth\.uid\s*\(\s*\)/i.test(f.body)
          ? 'auth.uid'
          : /member_org_ids|get_org_role|current_org|\bin_org\s*\(/i.test(f.body)
            ? 'org_helper'
            : 'none'
      const grantees = [...(grants.get(f.name) ?? [])].sort()
      return {
        name: f.name,
        file: f.file,
        definer: isDefiner,
        searchPath: f.searchPath,
        guard,
        revokedFromPublic: revoked.has(f.name),
        grantees
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const definers = functions.filter((f) => f.definer)

  return {
    migrations: files.length,
    ceiling: files.at(-1) ?? null,
    functions,
    definers,
    counts: {
      functions: functions.length,
      definers: definers.length,
      definersWithoutSearchPath: definers.filter((f) => !f.searchPath).length,
      definersWithoutRevoke: definers.filter((f) => !f.revokedFromPublic).length,
      definersWithoutGuard: definers.filter((f) => f.guard === 'none').length,
      // Public-surface allow-list: a definer may be executable by anon only if
      // it exists to serve a request made before a session exists.
      definersExecutableByAnon: definers.filter((f) => f.grantees.includes('anon')).length
    },
    grants,
    tablesCreated: createdTables.size,
    rlsEnabled: rlsEnabled.size,
    tablesWithoutRls: [...createdTables].filter((t) => !rlsEnabled.has(t)).sort(),
    // Statement count, not a distinct-policy census: a policy recreated by a
    // later migration counts twice. Used as a growth ratchet on the policy
    // surface, which is the property this file can actually assert.
    createPolicyStatements: policyStatements
  }
}

/**
 * `SECURITY DEFINER` functions that must remain executable by `anon` because
 * they serve a request made before a session exists. Bare names, matching how
 * grants are keyed here — `sec.can` and `can` are the same function.
 */
export const ANON_DEFINER_ALLOW_LIST = ['get_app_role', 'can', 'is_role', 'map_share_touch']
