import { describe, it, expect } from 'vitest'
import {
  calculateGeodesicDistanceMeters,
  calculateForwardBearing,
  calculatePathDistanceKm
} from '../geo'

describe('calculateGeodesicDistanceMeters', () => {
  it('returns 0 for identical coordinates', () => {
    expect(calculateGeodesicDistanceMeters(5.5, 100.2, 5.5, 100.2)).toBe(0)
  })

  it('treats zero lat/lng as valid coordinates (equator/prime meridian)', () => {
    // 0 is a VALID coordinate (equator / prime meridian) and must produce a
    // real distance, not be mistaken for a missing value.
    const d = calculateGeodesicDistanceMeters(0, 0, 5.5, 100.2)
    expect(d).toBeGreaterThan(
      calculateGeodesicDistanceMeters(5.5, 100.2, 5.5, 100.2)
    )
    expect(d).toBeGreaterThan(1)
    expect(d).not.toBe(0)
  })

  it('returns 0 for undefined/non-finite coordinates', () => {
    expect(calculateGeodesicDistanceMeters(NaN, NaN, 5.5, 100.2)).toBe(0)
    expect(calculateGeodesicDistanceMeters(undefined as any, 100.2, 5.5, 100.2)).toBe(0)
    expect(calculateGeodesicDistanceMeters(5.5, 100.2, Infinity, 100.2)).toBe(0)
  })

  it('returns ~0 for two negligible-distance points (epsilon)', () => {
    const d = calculateGeodesicDistanceMeters(5.5, 100.2, 5.500001, 100.2)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(1)
  })

  it('computes a well-known benchmark distance within epsilon', () => {
    // Roughly the London (51.5074, -0.1278) -> Paris (48.8566, 2.3522) distance
    const d = calculateGeodesicDistanceMeters(51.5074, -0.1278, 48.8566, 2.3522)
    // Known approximate geodesic ~343.5 km
    expect(d).toBeGreaterThan(342000)
    expect(d).toBeLessThan(345000)
  })

  it('is symmetric (order independent)', () => {
    const d1 = calculateGeodesicDistanceMeters(1, 2, 3, 4)
    const d2 = calculateGeodesicDistanceMeters(3, 4, 1, 2)
    expect(d1).toBeCloseTo(d2, 5)
  })
})

describe('calculateForwardBearing', () => {
  it('returns 0 for identical points', () => {
    expect(calculateForwardBearing(5, 5, 5, 5)).toBe(0)
  })

  it('returns 0 for due north', () => {
    expect(calculateForwardBearing(0, 0, 10, 0)).toBeCloseTo(0, 4)
  })

  it('returns 90 for due east', () => {
    expect(calculateForwardBearing(0, 0, 0, 10)).toBeCloseTo(90, 4)
  })

  it('returns 180 for due south', () => {
    expect(calculateForwardBearing(0, 0, -10, 0)).toBeCloseTo(180, 4)
  })

  it('returns 270 for due west', () => {
    expect(calculateForwardBearing(0, 0, 0, -10)).toBeCloseTo(270, 4)
  })

  it('always returns a bearing in [0, 360)', () => {
    for (let i = 0; i < 100; i++) {
      const b = calculateForwardBearing(
        Math.random() * 90 - 45,
        Math.random() * 180 - 90,
        Math.random() * 90 - 45,
        Math.random() * 180 - 90
      )
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(360)
    }
  })
})

describe('calculatePathDistanceKm', () => {
  it('returns 0 for empty or single-point paths', () => {
    expect(calculatePathDistanceKm([])).toBe(0)
    expect(calculatePathDistanceKm([{ lat: 1, lon: 2 }])).toBe(0)
    expect(calculatePathDistanceKm(undefined as any)).toBe(0)
  })

  it('returns ~0 for identical consecutive points', () => {
    expect(
      calculatePathDistanceKm([
        { lat: 5.5, lon: 100.2 },
        { lat: 5.5, lon: 100.2 },
        { lat: 5.5, lon: 100.2 }
      ])
    ).toBe(0)
  })

  it('sums each segment and rounds to 1 decimal (km)', () => {
    const km = calculatePathDistanceKm([
      { lat: 51.5074, lon: -0.1278 },
      { lat: 48.8566, lon: 2.3522 },
      { lat: 52.52, lon: 13.405 }
    ])
    // London -> Paris + Paris -> Berlin should be large; sanity bound
    expect(km).toBeGreaterThan(900)
    expect(km).toBeLessThan(1400)
  })
})
