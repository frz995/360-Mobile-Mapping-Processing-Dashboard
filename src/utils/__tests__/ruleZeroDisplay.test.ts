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

    it('formats survey tree day records with em-dash when frames or poi are unmeasured', () => {
      const formatSurveyRecord = (d: { availableImagesCount?: number | null; poiCount?: number | null }) => {
        const rawFrames = d.availableImagesCount
        const framesText = rawFrames !== undefined && rawFrames !== null && Number(rawFrames) >= 0
          ? `${Number(rawFrames).toLocaleString()} fr`
          : '— fr'
        const poiText = d.poiCount !== undefined && d.poiCount !== null && Number(d.poiCount) >= 0
          ? `${Number(d.poiCount).toLocaleString()} POI`
          : '— POI'
        return `${framesText} · ${poiText}`
      }

      expect(formatSurveyRecord({ availableImagesCount: null, poiCount: null })).toBe('— fr · — POI')
      expect(formatSurveyRecord({ availableImagesCount: 150, poiCount: null })).toBe('150 fr · — POI')
      expect(formatSurveyRecord({ availableImagesCount: null, poiCount: 200 })).toBe('— fr · 200 POI')
      expect(formatSurveyRecord({ availableImagesCount: 150, poiCount: 200 })).toBe('150 fr · 200 POI')
    })

    it('formats ledger metrics with em-dash when unmeasured', () => {
      const renderLedgerDefects = (defects: unknown) => {
        const d = typeof defects === 'number' && Number.isFinite(defects) ? defects : null
        return d !== null ? String(d) : '—'
      }

      const renderLedgerKm = (km: unknown) => {
        const k = typeof km === 'number' && Number.isFinite(km) ? km : null
        return k !== null ? `${k.toFixed(1)} km` : '—'
      }

      expect(renderLedgerDefects(null)).toBe('—')
      expect(renderLedgerDefects(undefined)).toBe('—')
      expect(renderLedgerDefects(0)).toBe('0')
      expect(renderLedgerDefects(4)).toBe('4')

      expect(renderLedgerKm(null)).toBe('—')
      expect(renderLedgerKm(undefined)).toBe('—')
      expect(renderLedgerKm(0)).toBe('0.0 km')
      expect(renderLedgerKm(12.5)).toBe('12.5 km')
    })

    it('resolves GPS coordinates safely without coercing missing coordinates to (0, 0)', () => {
      const resolveGps = (p: { latitude?: number | string; lat?: number | string }) => {
        const val = p.latitude ?? p.lat
        const n = Number(val)
        return Number.isFinite(n) ? n : undefined
      }

      expect(resolveGps({})).toBeUndefined()
      expect(resolveGps({ lat: undefined })).toBeUndefined()
      expect(resolveGps({ lat: 2.502 })).toBe(2.502)
      expect(resolveGps({ latitude: '102.815' })).toBe(102.815)
    })

    it('resolves QAQC inspection elapsed time safely without coercing unmeasured to 0s', () => {
      const formatElapsed = (elapsed?: number, cachedElapsed?: number) => {
        if (typeof elapsed === 'number') return `${elapsed}s`
        if (typeof cachedElapsed === 'number') return `${cachedElapsed}s`
        return '—'
      }

      expect(formatElapsed(undefined, undefined)).toBe('—')
      expect(formatElapsed(0, undefined)).toBe('0s')
      expect(formatElapsed(15, undefined)).toBe('15s')
      expect(formatElapsed(undefined, 42)).toBe('42s')
    })
  })
})
