import { describe, it, expect } from 'vitest'
import {
  MALAYSIA_DISTRICTS,
  DISTRICT_STATES,
  findDistrictByName,
  districtsToGeoJSON,
  pointInDistricts,
  groupMalaysiaDistricts,
  clipLineStringsToDistricts,
  linesLengthKm
} from '../malaysiaDistricts'

// The district dataset (`malaysia.district.geojson`) is the authoritative
// source of real Malaysia district boundaries (160 districts). These tests
// verify the typed module built from that file behaves honestly.

describe('malaysiaDistricts module', () => {
  it('loads the full real district dataset (160 districts)', () => {
    expect(MALAYSIA_DISTRICTS.length).toBe(160)
  })

  it('keys every district by id and groups it under a real state', () => {
    for (const d of MALAYSIA_DISTRICTS) {
      expect(d.id).toBeTruthy()
      expect(d.name).toBeTruthy()
      expect(d.state).toBeTruthy()
      expect(d.stateName).not.toBe('Unknown')
      expect(d.geojson?.features?.length).toBe(1)
    }
  })

  it('exposes expected state codes', () => {
    const byName = Object.fromEntries(DISTRICT_STATES.map((s) => [s.name, s.code]))
    expect(byName['Johor']).toBe('JHR')
    expect(byName['Selangor']).toBe('SGR')
    expect(byName['W.P. Kuala Lumpur']).toBe('KUL')
    expect(DISTRICT_STATES.length).toBe(16)
  })

  it('finds a district by name within its state', () => {
    const jb = findDistrictByName('Johor Bahru', 'JHR')
    expect(jb).toBeTruthy()
    expect(jb!.state).toBe('JHR')
    const kl = findDistrictByName('W.P. Kuala Lumpur', 'KUL')
    expect(kl).toBeTruthy()
    expect(kl!.id).toBe('w.p.-kuala-lumpur')
  })

  it('builds a multi-district union GeoJSON + bbox', () => {
    const kl = findDistrictByName('W.P. Kuala Lumpur', 'KUL')!
    const jb = findDistrictByName('Johor Bahru', 'JHR')!
    const union = districtsToGeoJSON([kl, jb])
    expect(union).toBeTruthy()
    expect(union!.geojson.features.length).toBe(2)
    const [minLng, minLat, maxLng, maxLat] = union!.bbox
    expect(minLng).toBeLessThanOrEqual(kl.bbox[0])
    expect(maxLng).toBeGreaterThanOrEqual(jb.bbox[2])
    expect(minLat).toBeLessThanOrEqual(kl.bbox[1])
    expect(maxLat).toBeGreaterThanOrEqual(jb.bbox[3])
  })

  it('returns null when no districts are selected', () => {
    expect(districtsToGeoJSON([])).toBeNull()
  })

  it('classifies real points inside/outside districts', () => {
    const kl = findDistrictByName('W.P. Kuala Lumpur', 'KUL')!
    const jb = findDistrictByName('Johor Bahru', 'JHR')!
    // KL city centre + Johor Bahru city reference
    expect(pointInDistricts([101.6869, 3.139], [kl])).toBe(true)
    expect(pointInDistricts([103.83, 1.55], [jb])).toBe(true)
    // Cross-state negatives
    expect(pointInDistricts([101.6869, 3.139], [jb])).toBe(false)
    expect(pointInDistricts([103.83, 1.55], [kl])).toBe(false)
  })

  it('groups districts preserving state order with sorted items', () => {
    const groups = groupMalaysiaDistricts(MALAYSIA_DISTRICTS)
    expect(groups.length).toBe(16)
    const johor = groups.find((g) => g.group === 'Johor')
    expect(johor).toBeTruthy()
    expect(johor!.items.length).toBeGreaterThan(0)
    const names = johor!.items.map((d) => d.name)
    expect(names).toEqual([...names].sort())
  })
})

describe('road line clipping', () => {
  it('keeps only the runs of a line that fall inside the district', () => {
    const kl = findDistrictByName('W.P. Kuala Lumpur', 'KUL')!
    // A line that crosses through KL (inside) and extends outside it.
    const line = {
      coordinates: [
        [101.4, 3.1],  // outside (Selangor)
        [101.6, 3.12],
        [101.68, 3.13], // inside KL
        [101.7, 3.14],  // inside KL
        [101.8, 3.2],   // outside
        [102.1, 2.6]    // outside
      ] as Array<[number, number]>
    }
    const runs = clipLineStringsToDistricts([line], [kl])
    // Only the contiguous inside run survives (>=2 points).
    expect(runs.length).toBe(1)
    expect(runs[0].length).toBeGreaterThanOrEqual(2)
    for (const pt of runs[0]) {
      expect(pointInDistricts(pt, [kl])).toBe(true)
    }
  })

  it('returns empty when nothing is inside', () => {
    const jb = findDistrictByName('Johor Bahru', 'JHR')!
    const line = { coordinates: [[101.68, 3.13], [101.7, 3.14]] as Array<[number, number]> } // KL, not JB
    expect(clipLineStringsToDistricts([line], [jb])).toEqual([])
  })

  it('line length grows with distance and drops isolated inside points', () => {
    const run: Array<[number, number]> = [[101.0, 0.0], [101.1, 0.0]]
    const km = linesLengthKm([run])
    expect(km).toBeGreaterThan(0)
    expect(km).toBeCloseTo(11.13, 0) // ~1/10 deg longitude at the equator
    // A single point run (below the 2-point minimum) yields no length.
    expect(linesLengthKm([[run[0]]])).toBe(0)
  })
})
