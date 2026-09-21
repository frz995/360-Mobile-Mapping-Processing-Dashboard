import { describe, expect, it } from 'vitest';
import { computeSurveyAnalytics } from '../surveyAnalytics';
import type { BatchLike } from '../surveyAnalytics';
import {
  buildExecutiveReportHtml,
  buildDailyReportHtml,
  buildSubgridReportHtml,
  buildQaReportHtml,
  buildLineageReportHtml
} from '../reportDocuments';

const batches: BatchLike[] = [
  {
    id: 'b1',
    date: '2026-09-01',
    grid: 'NG9',
    subgrid: 'N93E70',
    kmProcessed: 2.1,
    poiCount: 105,
    availableImagesCount: 105,
    defects: 2,
    status: 'Complete',
    publishToWebGIS: 'No',
    pic: 'Aiman',
    isSyncedWithSupabase: true
  },
  {
    id: 'b2',
    date: '2026-09-02',
    grid: 'NG9',
    subgrid: 'N94E70',
    kmProcessed: 1.27,
    poiCount: 168,
    availableImagesCount: 168,
    defects: 0,
    status: 'In Progress',
    publishToWebGIS: 'Yes',
    pic: 'Farah'
  }
];

const analytics = computeSurveyAnalytics({ batches, daily: batches, targetKm: 10 });

describe('printable report documents', () => {
  it('executive report follows the audit-document layout (TOC, no KPI cards, no pills)', () => {
    const html = buildExecutiveReportHtml(analytics);
    expect(html).toContain('Table of Contents');
    expect(html).toContain('Executive Summary');
    expect(html).toContain('Subgrid Delivery Status');
    expect(html).toContain('Capture Gaps');
    expect(html).toContain('Daily Throughput');
    expect(html).toContain('N93E70');
    expect(html).toContain('class="summary"');
    expect(html).not.toContain('kpi-grid');
    expect(html).not.toContain('badge-ok');
    expect(html).not.toContain('badge-danger');
  });

  it('daily report renders totals and the handover log', () => {
    const html = buildDailyReportHtml(batches as never);
    expect(html).toContain('Summary of Figures');
    expect(html).toContain('Daily Operations Log');
    expect(html).toContain('Synced');
    expect(html).not.toContain('kpi-grid');
  });

  it('subgrid coverage report renders the coverage matrix', () => {
    const html = buildSubgridReportHtml(analytics);
    expect(html).toContain('Coverage &amp; Publication Summary');
    expect(html).toContain('Subgrid Coverage Matrix');
    expect(html).toContain('N94E70');
  });

  it('QA report lists decisions and the defect register', () => {
    const html = buildQaReportHtml({
      jobs: [
        { name: 'Stitch N93E70', job_type: 'stitch', subgrid: 'N93E70', qa_decision: 'APPROVED', qa_by: 'aiman', qa_at: '2026-09-03T08:00:00Z' },
        { name: 'Blur N93E70', job_type: 'blur', subgrid: 'N93E70', qa_decision: 'REJECTED', qa_by: 'farah', qa_at: '2026-09-03T09:00:00Z' }
      ],
      analytics
    });
    expect(html).toContain('QA Decision Log');
    expect(html).toContain('APPROVED');
    expect(html).toContain('REJECTED');
    expect(html).toContain('Defect Register by Subgrid');
    expect(html).not.toContain('badge-ok');
  });

  it('lineage report renders registry and job chain', () => {
    const html = buildLineageReportHtml({
      datasets: [{ name: 'RAW-001', dataset_type: 'raw', pipeline_stage: 'capture', subgrid: 'N93E70', status: 'ACTIVE', file_count: 105, created_by: 'aiman', created_at: '2026-09-01T02:00:00Z' }],
      jobs: [{ name: 'Stitch N93E70', job_type: 'stitch', subgrid: 'N93E70', status: 'COMPLETED', operator: 'worker-1', updated_at: '2026-09-02T04:00:00Z' }]
    });
    expect(html).toContain('Dataset Registry');
    expect(html).toContain('Processing Job Chain');
    expect(html).toContain('RAW-001');
    expect(html).toContain('COMPLETED');
  });

  it('empty datasets still produce a complete document shell', () => {
    const empty = computeSurveyAnalytics({});
    const html = buildExecutiveReportHtml(empty);
    expect(html).toContain('doc-header');
    expect(html).toContain('Print / Save PDF');
    expect(html).toContain('No survey batches registered');
    expect(html).toContain('Arial');
    expect(html).toContain('Strictly Confidential');
    expect(html).toContain('GeoSphere');
  });
});
