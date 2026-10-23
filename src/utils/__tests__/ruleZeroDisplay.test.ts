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

    it('formats road analysis explorer tooltip metrics with em-dash when unmeasured', () => {
      const formatDensity = (d: unknown) =>
        d !== null && d !== undefined && Number.isFinite(Number(d)) ? `${Number(d).toFixed(2)} km/km²` : '— km/km²'
      const formatRoads = (km: unknown) =>
        km !== null && km !== undefined && Number.isFinite(Number(km)) ? `${Number(km).toFixed(1)} km roads` : '— km roads'
      const formatCoverage = (cov: unknown) =>
        cov !== null && cov !== undefined && Number.isFinite(Number(cov)) ? `${Number(cov)}% covered` : '—% covered'

      expect(formatDensity(null)).toBe('— km/km²')
      expect(formatDensity(undefined)).toBe('— km/km²')
      expect(formatDensity(1.456)).toBe('1.46 km/km²')

      expect(formatRoads(null)).toBe('— km roads')
      expect(formatRoads(12.34)).toBe('12.3 km roads')

      expect(formatCoverage(null)).toBe('—% covered')
      expect(formatCoverage(85)).toBe('85% covered')
    })

    it('resolves deletion impact defect count safely without zero coercions', () => {
      const resolveDefects = (record: Record<string, unknown>): number => {
        const dVal = record.defectCount ?? record.imagesDefected ?? record.defects
        return typeof dVal === 'number' ? dVal : 0
      }

      expect(resolveDefects({ defectCount: 5 })).toBe(5)
      expect(resolveDefects({ defectCount: null, imagesDefected: 3 })).toBe(3)
      expect(resolveDefects({ defects: 2 })).toBe(2)
      expect(resolveDefects({})).toBe(0)
      expect(resolveDefects({ defectCount: null, defects: null })).toBe(0)
    })
  })
})
