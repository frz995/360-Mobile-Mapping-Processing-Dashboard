import { describe, it, expect } from 'vitest'
import { resolvePointAppearance } from '../panotrackAppearance'

describe('Rule Zero Display Metrics (WP 5)', () => {
  describe('qaState resolution', () => {
    it('does not classify unmeasured defectCount (null) as clean', () => {
      const defectCount: number | null = null
      const qaState = typeof defectCount === 'number' ? (defectCount > 0 ? 'defect' : 'clean') : 'unaudited'
      expect(qaState).toBe('unaudited')

      const appearance = resolvePointAppearance({
        frameState: 'present',
        qaState,
        isPublished: true
      })
      // 'unaudited' must not resolve to the clean published green color (#10b981)
      expect(appearance.color).not.toBe('#10b981')
      expect(appearance.qaState).toBe('unaudited')
    })

    it('classifies verified zero defects as clean', () => {
      const defectCount = 0
      const qaState = typeof defectCount === 'number' ? (defectCount > 0 ? 'defect' : 'clean') : 'unaudited'
      expect(qaState).toBe('clean')

      const appearance = resolvePointAppearance({
        frameState: 'present',
        qaState,
        isPublished: true
      })
      expect(appearance.color).toBe('#10b981')
      expect(appearance.qaState).toBe('clean')
    })

    it('classifies verified positive defects as defect', () => {
      const defectCount = 3
      const qaState = typeof defectCount === 'number' ? (defectCount > 0 ? 'defect' : 'clean') : 'unaudited'
      expect(qaState).toBe('defect')

      const appearance = resolvePointAppearance({
        frameState: 'present',
        qaState,
        isPublished: true
      })
      expect(appearance.color).toBe('#ef4444')
      expect(appearance.qaState).toBe('defect')
    })
  })

  describe('display formatting for unread telemetry', () => {
    const formatKm = (km: number | null | undefined): string =>
      typeof km === 'number' ? km.toFixed(1) : '—'

    it('formats unread kmProcessed to em-dash rather than 0.0', () => {
      expect(formatKm(null)).toBe('—')
      expect(formatKm(undefined)).toBe('—')
    })

    it('formats verified kmProcessed correctly', () => {
      expect(formatKm(4.2)).toBe('4.2')
    })

    it('formats unread defect count to em-dash rather than 0', () => {
      const rawDefects: number | null = null
      const display = rawDefects === null ? '—' : `${rawDefects} Flagged`
      expect(display).toBe('—')
    })

    it('formats verified 0 defect count to 0 Flagged', () => {
      const rawDefects: number | null = 0
      const display = rawDefects === null ? '—' : `${rawDefects} Flagged`
      expect(display).toBe('0 Flagged')
    })
  })
})
