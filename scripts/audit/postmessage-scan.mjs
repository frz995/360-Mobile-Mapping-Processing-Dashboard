// WebGIS bridge audit: how many messages leave without a target origin, and
// which handlers accept one without checking who sent it.
//
// WHY A DEDICATED SCANNER
//   The v39 sign-off claimed the wildcard `postMessage(..., '*')` calls had been
//   replaced. They had not: the helper was written and wired at one call site.
//   A grep for the string '*'' would have caught the fake fix, but only a scan
//   that walks to the matching close paren can count multi-line calls correctly
//   and tell an outbound send apart from a worker channel (a Worker takes no
//   origin argument at all, so a second `'*'` argument can only ever be a
//   Window).
import { skipString, skipTemplate } from './source-metrics.mjs'

/** Index of the `)` that closes the `(` at `openIndex`, or -1. */
function matchingParen(src, openIndex) {
  let depth = 0
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'") i = skipString(src, i)
    else if (ch === '`') i = skipTemplate(src, i)
    else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function lineOf(src, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++
  return line
}

/**
 * The text a handler's validation lives in.
 *
 * The check is never on the `addEventListener` line; it is inside the handler,
 * which in this codebase is either an inline arrow or a `const` declared a few
 * lines above inside the same `useEffect`. Scanning a fixed number of lines
 * *forward* from the registration therefore reports "unvalidated" for every
 * handler in the tree — which is precisely the false positive this function
 * exists to avoid. So: walk back to the enclosing `useEffect`, and if the
 * handler is a named reference, append its own definition wherever it lives.
 */
function validationContext(lines, listenerLineIndex, handlerName) {
  let start = Math.max(0, listenerLineIndex - 140)
  for (let i = listenerLineIndex; i >= start; i--) {
    if (/\buseEffect\s*\(/.test(lines[i])) {
      start = i
      break
    }
  }
  let context = lines.slice(start, listenerLineIndex + 1).join('\n')

  if (handlerName && /^[A-Za-z_$][\w$]*$/.test(handlerName)) {
    const defRe = new RegExp(
      String.raw`(?:const|let|var|async\s+function|function)\s+${handlerName}\b`
    )
    const defIndex = lines.findIndex((l) => defRe.test(l))
    if (defIndex !== -1 && defIndex < listenerLineIndex) {
      context += '\n' + lines.slice(defIndex, defIndex + 80).join('\n')
    }
  }
  return context
}

// A message-event-ish variable, not just any `.origin`: `window.location.origin`
// appears inside these effects for unrelated URL building and must not be read
// as a sender check.
const ORIGIN_CHECK = /\b(?:e|ev|event|msg|message|m)\.origin\b|isAllowedMapOrigin\s*\(|createMapOriginMatcher\s*\(/
const SOURCE_CHECK = /\b(?:e|ev|event|msg|message|m)\.source\b/

export function scanPostMessage(files) {
  const wildcardByFile = new Map()
  const wildcardSites = []
  const listeners = []
  let calls = 0
  let wildcardCalls = 0

  for (const { path: relPath, text } of files) {
    // ---- outbound -------------------------------------------------------
    const needle = 'postMessage('
    let idx = text.indexOf(needle)
    while (idx !== -1) {
      const open = idx + needle.length - 1
      const close = matchingParen(text, open)
      const end = close === -1 ? text.length : close
      const args = text.slice(idx, end + 1)
      calls++
      if (/['"]\*['"]/.test(args)) {
        wildcardCalls++
        wildcardByFile.set(relPath, (wildcardByFile.get(relPath) ?? 0) + 1)
        wildcardSites.push({ file: relPath, line: lineOf(text, idx) })
      }
      idx = text.indexOf(needle, end + 1)
    }

    // ---- inbound --------------------------------------------------------
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!/addEventListener\(\s*['"]message['"]/.test(lines[i])) continue

      // Only window-level listeners are a cross-origin surface. A Worker or a
      // BroadcastChannel is same-process by construction.
      const at = lines[i].indexOf('addEventListener')
      const before = lines[i].slice(0, at).trimEnd()
      if (!/\bwindow\s*\.$/.test(before)) continue

      const lineStart = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0)
      const callOpen = text.indexOf('(', lineStart + lines[i].indexOf('addEventListener'))
      const callClose = matchingParen(text, callOpen)
      const callArgs = text.slice(callOpen + 1, callClose === -1 ? text.length : callClose)
      const commaAt = callArgs.indexOf(',')
      const handlerArg = commaAt === -1 ? '' : callArgs.slice(commaAt + 1).trim()
      const handlerName = /^[A-Za-z_$][\w$]*$/.test(handlerArg) ? handlerArg : null

      const context = validationContext(lines, i, handlerName)
      const validation = ORIGIN_CHECK.test(context)
        ? 'origin'
        : SOURCE_CHECK.test(context)
          ? 'source'
          : 'none'

      listeners.push({ file: relPath, line: i + 1, handler: handlerName ?? 'inline', validation })
    }
  }

  return {
    calls,
    wildcardCalls,
    wildcardByFile: [...wildcardByFile.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
    wildcardSites,
    listeners,
    unvalidatedListeners: listeners.filter((l) => l.validation === 'none'),
    sourceOnlyListeners: listeners.filter((l) => l.validation === 'source'),
    originValidatedListeners: listeners.filter((l) => l.validation === 'origin')
  }
}
