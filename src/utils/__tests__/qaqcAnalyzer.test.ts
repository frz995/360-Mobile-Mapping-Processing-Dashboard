import { describe, it, expect, vi } from 'vitest'

// The real gpuAnalyzer constructs a WebGLGpuAnalyzer singleton that probes
// WebGL at import time, which jsdom does not support. Stub the GPU module so
// qaqcAnalyzer loads cleanly; detectBadGps has no GPU dependency.
vi.mock('../gpuAnalyzer', () => ({
  gpuAnalyzer: { isAvailable: () => false, getGpuInfo: () => 'CPU Fallback' },
  isGpuAccelerationSupported: () => false,
  getGpuHardwareName: () => 'CPU Fallback'
}))

import { detectBadGps, DEFAULT_QAQC_THRESHOLDS } from '../qaqcAnalyzer'

describe('detectBadGps', () => {
  it('flags null current point', () => {
    const r = detectBadGps(null)
    expect(r.isBadGps).toBe(true)
    expect(r.reason).toMatch(/No point telemetry/)
  })

  it('flags empty current point', () => {
    const r = detectBadGps({})
    expect(r.isBadGps).toBe(true)
  })

  it('flags 0,0 coordinates as dropout', () => {
    const r = detectBadGps({ latitude: 0, longitude: 0 })
    expect(r.isBadGps).toBe(true)
    expect(r.reason).toMatch(/dropout/i)
  })

  it('flags null coordinates as dropout', () => {
    const r = detectBadGps({ lat: null as any, lng: null as any })
    expect(r.isBadGps).toBe(true)
  })

  it('flags NaN coordinates as dropout', () => {
    const r = detectBadGps({ latitude: NaN, longitude: NaN })
    expect(r.isBadGps).toBe(true)
  })

  it('accepts lat/lng aliases', () => {
    const r = detectBadGps({ lat: 3.1, lng: 101.7 })
    expect(r.isBadGps).toBe(false)
  })

  it('accepts lon alias', () => {
    const r = detectBadGps({ lat: 3.1, lon: 101.7 })
    expect(r.isBadGps).toBe(false)
  })

  it('returns clean result when no previous point', () => {
    const r = detectBadGps({ lat: 3.1, lng: 101.7 })
    expect(r.isBadGps).toBe(false)
    expect(r.distanceMeters).toBe(0)
  })

  it('flags a geodesic jump exceeding the default threshold', () => {
    // ~110km apart -> far above default 50m
    const r = detectBadGps({ lat: 3.1, lng: 101.7 }, { lat: 3.1, lng: 101.7 + 1 })
    expect(r.isBadGps).toBe(true)
    expect(r.reason).toMatch(/Geodesic distance jump/)
  })

  it('accepts a small jump within threshold', () => {
    // ~0.0001 deg lon at equator ~11m, within 50m default
    const r = detectBadGps({ lat: 0.1, lng: 0 }, { lat: 0.1, lng: 0.0001 })
    expect(r.isBadGps).toBe(false)
  })

  it('respects a numeric threshold override', () => {
    const r = detectBadGps({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }, 5)
    // ~111m apart, exceeds 5m
    expect(r.isBadGps).toBe(true)
  })

  it('respects options object with maxJumpThresholdMeters', () => {
    // ~0.001 deg lon at equator ~111m, within 500m threshold
    const r = detectBadGps(
      { lat: 0.1, lng: 0 },
      { lat: 0.1, lng: 0.001 },
      { maxJumpThresholdMeters: 500 }
    )
    expect(r.isBadGps).toBe(false)
  })

  it('respects thresholds object option', () => {
    const r = detectBadGps(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { thresholds: { ...DEFAULT_QAQC_THRESHOLDS, gpsMaxJumpDistanceMeters: 10 } }
    )
    expect(r.isBadGps).toBe(true)
  })

  it('skips jump check when previous point is zero-coordinate', () => {
    const r = detectBadGps({ lat: 3.1, lng: 101.7 }, { lat: 0, lng: 0 })
    expect(r.isBadGps).toBe(false)
  })
})
