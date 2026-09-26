import { describe, it, expect } from 'vitest'
import { applyPairing, computeTrajectorySpan } from '../hub/IntakePairingStation'
import type { PairedFrameRecord } from '../hub/IntakePairingStation'

function row(index: number, sourceFilename: string): PairedFrameRecord {
  return {
    index,
    sourceFilename,
    targetFilename: sourceFilename || `N93E70-${String(index).padStart(4, '0')}.jpg`,
    timestamp: '2022-06-30',
    latitude: 2.55,
    longitude: 102.79,
    heading: 180,
    isMatched: false
  }
}

describe('applyPairing (intake pairing)', () => {
  it('matches rows whose metadata filename already exists on disk (renamed folder)', () => {
    const rows = [row(1, 'N93E70-0001.jpg'), row(2, 'N93E70-0002.jpg')]
    const images = ['N93E70-0002.jpg', 'N93E70-0001.jpg']
    const { records, unpairedImages } = applyPairing(rows, images)
    expect(records.map((r) => r.originalFilename)).toEqual(['N93E70-0001.jpg', 'N93E70-0002.jpg'])
    expect(records.every((r) => r.isMatched)).toBe(true)
    expect(unpairedImages).toHaveLength(0)
  })

  it('pairs rig-named stitched outputs positionally when the CSV starts at a higher index (BP_20220630 case)', () => {
    const rows = [row(1, 'N93E70-0093.jpg'), row(2, 'N93E70-0094.jpg'), row(3, 'N93E70-0095.jpg')]
    const images = [
      '003485-20220630-170708-000000001.jpg',
      '003485-20220630-170708-000000002.jpg',
      '003485-20220630-170708-000000003.jpg'
    ]
    const { records, unpairedImages } = applyPairing(rows, images)
    expect(records[0].originalFilename).toBe('003485-20220630-170708-000000001.jpg')
    expect(records[1].originalFilename).toBe('003485-20220630-170708-000000002.jpg')
    expect(records[2].originalFilename).toBe('003485-20220630-170708-000000003.jpg')
    expect(records[0].sourceFilename).toBe('N93E70-0093.jpg')
    expect(records.every((r) => r.isMatched)).toBe(true)
    expect(records.map((r) => r.index)).toEqual([1, 2, 3])
    expect(unpairedImages).toHaveLength(0)
  })

  it('keeps originalFilename through a rename-cycle re-pairing', () => {
    const rows = [
      row(1, 'N93E70-0093.jpg'),
      { ...row(2, 'N93E70-0094.jpg'), renamedAt: '2026-09-26T10:00:00+00:00' }
    ]
    const images = ['003485-20220630-170708-000000001.jpg', 'N93E70-0094.jpg']
    const { records } = applyPairing(rows, images)
    const first = records.find((r) => r.index === 1)
    const second = records.find((r) => r.index === 2)
    expect(first?.isMatched).toBe(true)
    expect(first?.originalFilename).toBe('003485-20220630-170708-000000001.jpg')
    expect(second?.isMatched).toBe(true)
    expect(second?.renamedAt).toBe('2026-09-26T10:00:00+00:00')
  })

  it('refuses positional pairing when counts differ and reports leftovers', () => {
    const rows = [row(1, 'N93E70-0093.jpg'), row(2, 'N93E70-0094.jpg')]
    const images = [
      '003485-20220630-170708-000000001.jpg',
      '003485-20220630-170708-000000002.jpg',
      '003485-20220630-170708-000000003.jpg'
    ]
    const { records, unpairedImages } = applyPairing(rows, images)
    // no name match and count mismatch: rows stay unverified, all images unclaimed
    expect(records.every((r) => !r.isMatched)).toBe(true)
    expect(records.every((r) => r.originalFilename === undefined)).toBe(true)
    expect(unpairedImages).toHaveLength(3)
  })

  it('name-pass plus positional pass handles partially renamed folders', () => {
    const rows = [
      row(1, 'N93E70-0001.jpg'),
      row(2, 'N93E70-0094.jpg'),
      row(3, 'N93E70-0095.jpg'),
      row(4, 'N93E70-0096.jpg')
    ]
    const images = [
      'N93E70-0001.jpg',
      '003485-20220630-170708-000000002.jpg',
      '003485-20220630-170708-000000003.jpg',
      '003485-20220630-170708-000000004.jpg'
    ]
    const { records, unpairedImages } = applyPairing(rows, images)
    expect(records[0].originalFilename).toBe('N93E70-0001.jpg')
    expect(records[1].originalFilename).toBe('003485-20220630-170708-000000002.jpg')
    expect(records[2].originalFilename).toBe('003485-20220630-170708-000000003.jpg')
    expect(records[3].originalFilename).toBe('003485-20220630-170708-000000004.jpg')
    expect(records.every((r) => r.isMatched)).toBe(true)
    expect(unpairedImages).toHaveLength(0)
  })
})
describe('computeTrajectorySpan (metadata metres -> km)', () => {
  const row = (i: number, distanceToPrevious: number | null): PairedFrameRecord => ({
    index: i,
    sourceFilename: `N93E70-${String(i).padStart(4, '0')}.jpg`,
    targetFilename: `N93E70-${String(i).padStart(4, '0')}.jpg`,
    timestamp: '2022-06-30',
    latitude: 2.55,
    longitude: 102.79,
    heading: 180,
    distanceToPrevious,
    isMatched: true
  })

  it('sums the metadata distance-to-previous column and converts metres to km', () => {
    const records = [row(1, 0), row(2, 320.53), row(3, 450)]
    const span = computeTrajectorySpan(records)
    expect(span.source).toBe('metadata')
    expect(span.km).toBeCloseTo(770.53 / 1000, 6)
  })

  it('ignores null distances and still uses the metadata path', () => {
    const records = [row(1, null), row(2, 269.71), row(3, null)]
    const span = computeTrajectorySpan(records)
    expect(span.source).toBe('metadata')
    expect(span.km).toBeCloseTo(0.26971, 6)
  })

  it('falls back to coordinate-derived length when the CSV has no distance column', () => {
    const records = [row(1, null), row(2, null), row(3, null)]
    const span = computeTrajectorySpan(records)
    expect(span.source).toBe('coordinates')
    expect(span.km).not.toBeNull()
  })
})
