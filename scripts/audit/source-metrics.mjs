// Shared source-scanning primitives for scripts/lint.mjs and scripts/audit/*.
//
// WHY THIS IS A MODULE
//   The empty-catch ratchet in lint.mjs and the audit ratchet in
//   scripts/audit/static-scan.mjs must agree on what they are counting. Two
//   copies of the classifier drift the moment one is tuned, and a ratchet that
//   counts a different thing than the number in quality-baseline.json is worse
//   than no ratchet: it reports movement that did not happen. There is one
//   definition, and both callers import it.
//
// SCOPE
//   `src/` only. Test files are excluded because they do not ship and because
//   the existing catch baseline was measured without them (see
//   quality-baseline.json -> emptyCatch._definition).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const SOURCE_SKIP = new Set(['node_modules', 'dist', 'coverage'])

/** A test file by the repository's convention: `__tests__/` or a `.test`/`.spec` suffix. */
export function isTestFile(filePath) {
  return /__tests__|\.test\.|\.spec\./.test(filePath)
}

/**
 * Recursively collect `.ts`/`.tsx` files under `dir`.
 *
 * `includeTests` defaults to false so every caller starts from the shipped
 * surface; a caller that genuinely needs tests (to prove they contain no
 * wildcard postMessage, say) opts in explicitly.
 */
export function collectSourceFiles(dir, { includeTests = false } = {}, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SOURCE_SKIP.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, { includeTests }, out)
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      (includeTests || !isTestFile(entry))
    ) {
      out.push(full)
    }
  }
  return out
}

export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

export function skipString(src, i) {
  const quote = src[i]
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') i++
    else if (src[i] === quote) return i
  }
  return i
}

export function skipTemplate(src, i) {
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') i++
    else if (src[i] === '`') return i
    else if (src[i] === '$' && src[i + 1] === '{') {
      let depth = 1
      i += 2
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === '{') depth++
        else if (src[i] === '}') depth--
      }
      i--
    }
  }
  return i
}

/**
 * Classify every `catch` clause whose body carries no real statements.
 *
 * strict      — the body is empty after comments are stripped.
 * consoleOnly — the body is nothing but `console.*(...)` calls.
 *
 * Bodies containing any other statement are ignored: they are doing something,
 * and whether it is the right something is a review question, not a count.
 */
export function classifyCatches(source) {
  let strict = 0
  let consoleOnly = 0

  // Brace-balanced walk of each `catch (...) { ... }` body. Strings and
  // templates are skipped so a `}` inside one cannot end the block early.
  const re = /\bcatch\s*(?:\([^)]*\))?\s*\{/g
  let match
  while ((match = re.exec(source)) !== null) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let i = open
    for (; i < source.length; i++) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) break
      } else if (ch === '`') i = skipTemplate(source, i)
      else if (ch === '"' || ch === "'") i = skipString(source, i)
    }
    const body = stripComments(source.slice(open + 1, i)).trim()
    if (body === '') strict++
    else if (/^(console\.[a-z]+\([^;]*\);?\s*)+$/i.test(body)) consoleOnly++
  }

  return { strict, consoleOnly }
}

/**
 * Count catch clauses written literally as `catch {}` / `catch (e) {}` on one
 * line. This is the narrower, more human-legible subset of `classifyCatches`
 * .strict — it is what a reviewer means by "an empty catch" — so the audit
 * reports it alongside the ratchet's number rather than instead of it.
 */
export function countInlineEmptyCatches(source) {
  return (source.match(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g) ?? []).length
}

/** Read every shipped source file once and hand back `[relPath, text]` pairs. */
export function readSourceTree(repoRoot) {
  return collectSourceFiles(path.join(repoRoot, 'src')).map((full) => ({
    path: path.relative(repoRoot, full).replace(/\\/g, '/'),
    text: readFileSync(full, 'utf8')
  }))
}
