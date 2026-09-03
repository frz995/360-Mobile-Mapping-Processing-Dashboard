import { describe, it, expect } from 'vitest'
import { buildExecutivePdfHtml } from '../reportPdf'
import type { ExecutivePdfReportInput } from '../reportPdf'

const baseInput: ExecutivePdfReportInput = {
  batches: [
    {
      id: 'b1',
      date: '2026-08-01',
      grid: '91',
      subgrid: 'N91E71',
      imageFilename: 'N91E71-0001.jpg',
      images: 50,
      poiCount: 100,
      defects: 2,
      kmProcessed: 10,
      status: 'Complete',
      captureEquipment: 'MMS',
      pic: 'Ali',
      isSyncedWithSupabase: true,
    },
    {
      id: 'b2',
      date: '2026-08-02',
      grid: '92',
      subgrid: 'N92E72',
      imageFilename: 'N92E72-0001.jpg',
      images: 80,
      poiCount: 200,
      defects: 0,
      kmProcessed: 20.5,
      status: 'Ongoing',
      captureEquipment: 'Backpack',
      pic: 'Sam',
      isSyncedWithSupabase: false,
    },
  ],
  auditLogs: [
    {
      id: 'a1',
      timestamp: '2026-08-03 09:00:00',
      type: 'PUBLISH',
      title: 'Published N91E71',
      details: 'sync ok',
      user: 'ali@x.com',
      status: 'success',
    },
  ],
  qaSubgridRecords: {
    'N91E71': { flags: { blurry: true, obstruction: false, badGps: false }, answer: 'yes', isLocked: true },
  },
  projectSettings: {
    contractCode: 'MMS-2026-TNB-01',
    targetKm: 100,
    targetImages: 1000,
    dbAutoSyncSec: 60,
  },
  operatorUser: 'gis.engineer@x.com',
}

describe('buildExecutivePdfHtml', () => {
  it('returns a string containing the html document wrapper', () => {
    const html = buildExecutivePdfHtml(baseInput)
    expect(typeof html).toBe('string')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('EXECUTIVE PDF REPORT PREVIEW')
    expect(html).toContain('GEO-MMS-EXEC-')
  })

  it('renders deterministic aggregate math (km, subgrid counts, contract, operator)', () => {
    const html = buildExecutivePdfHtml(baseInput)
    expect(html).toContain('30.50 km')
    expect(html).toContain('2 Units')
    expect(html).toContain('MMS-2026-TNB-01')
    expect(html).toContain('gis.engineer@x.com')
    expect(html).toContain('10.00 km')
    expect(html).toContain('20.50 km')
  })

  it('renders per-batch verification status badges', () => {
    const html = buildExecutivePdfHtml(baseInput)
    expect(html).toContain('VERIFIED & PUBLISHED')
    expect(html).toContain('STAGED IN PROCESS')
  })
})
