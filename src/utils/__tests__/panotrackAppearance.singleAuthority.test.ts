import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { POINT_APPEARANCE_COLORS } from '../panotrackAppearance'

/**
 * Guards against a fourth layer overriding the colour resolver.
 *
 * WHAT HAPPENED
 *
 * v27 section 1 built `resolvePointAppearance`, wired it into both
 * `datasets.ts` point builders, and wrote 23 unit tests for it. All 23 passed
 * and nothing gray appeared on the map, because four separate payload builders
 * recomputed `color` from their own inline ternary:
 *
 *   MapComponent.tsx:169-171    overwrote the value carried on `...p`
 *   App.tsx:2578                rebuilt the point from scratch
 *   App.tsx:2738                rebuilt the point from scratch
 *   Map.jsx:2562/2672-2676      recomputed again inside the external map
 *
 * The tests were real and the pipeline was untested. This file asserts on the
 * source, which is the only place the invariant is observable — the override
 * happens between two modules that are individually correct.
 *
 * The WebGIS half is checked separately in that repo, which has no test
 * framework; see its own commit message for the equivalent sites.
 */

const ROOT = resolve(process.cwd())

function source(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8')
}

/** Files that build a map payload and therefore must not re-derive colour. */
const PAYLOAD_BUILDERS = [
  'src/components/MapComponent.tsx',
  'src/App.tsx',
  'src/services/api/datasets.ts'
]

describe('the colour resolver is the single authority', () => {
  it('no payload builder assigns a literal colour to a point', () => {
    // Matches `color: isPtDefect ? '#ef4444' : …` and the equivalents. A
    // builder may still emit a colour, but only by delegating.
    const offenders: string[] = []

    for (const relPath of PAYLOAD_BUILDERS) {
      const lines = source(relPath).split('\n')
      lines.forEach((line, i) => {
        const trimmed = line.trim()
        // Only a bare literal ternary chain counts. Comparison against
        // POINT_APPEARANCE_COLORS inside the resolver itself is fine, and
        // `resolvePointAppearance` output obviously has a literal in its source
        // variable name rather than an inline hex.
        if (!/color:\s*.*\?/.test(trimmed)) return
        if (!/#[0-9a-fA-F]{3,8}/.test(trimmed)) return
        offenders.push(`${relPath}:${i + 1}  ${trimmed.slice(0, 90)}`)
      })
    }

    expect(offenders).toEqual([])
  })

  it('MapComponent emits the resolver output, not a recomputation', () => {
    const mapComponent = source('src/components/MapComponent.tsx')
    expect(mapComponent).toContain('resolvePointAppearance(')
    // The spread carries `frameState` from the data layer; the resolver then
    // re-derives it, and the payload publishes the result for the external map.
    expect(mapComponent).toContain('frameState: appearance.frameState')
  })

  it('App delegates its two row-selection payloads to the resolver', () => {
    const app = source('src/App.tsx')
    const calls = app.match(/resolvePointAppearance\(/g) ?? []
    // One per payload site, plus the import. Two payload builders were found by
    // inspection; a third site appearing without a call is the regression this
    // count is here to make visible.
    expect(calls.length).toBeGreaterThanOrEqual(3)
    expect(app).not.toMatch(/color:\s*isPtDefect\s*\?/)
  })
})

describe('missing has its own colour, reserved', () => {
  it('is a distinct slate, not any of the three existing statuses', () => {
    const { missing, published, staging, defect, unknown } = POINT_APPEARANCE_COLORS
    expect(missing).toBe('#94a3b8')
    // Gray must not collide with published green, staging amber or defect red,
    // or "missing frames" becomes indistinguishable from a normal survey.
    expect(new Set([missing, published, staging, defect]).size).toBe(4)
    // And it must not be the "we could not check" colour either — those are
    // different claims and conflating them is migration 0032 at point level.
    expect(missing).not.toBe(unknown)
  })
})