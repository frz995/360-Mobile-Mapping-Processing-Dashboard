import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardBatchTable } from '../DashboardBatchTable';
import { translate } from '../../../lib/i18n';

describe('DashboardBatchTable column headers and POI counts', () => {
  const defaultProps = {
    isDataLoading: false,
    selectedSubgridFilter: null,
    toggleSubgridFilter: vi.fn(),
    dailyDataBySubgrid: new Map(),
    setImagesListModal: vi.fn(),
    qaqcWorkerState: { isRunning: false, isCompleted: false, defectsList: [] },
    qaqcAuditRuns: {},
    setSelectedDefectSubgrid: vi.fn(),
    setDefectGalleryContext: vi.fn(),
    setIsDefectsGalleryOpen: vi.fn(),
    setIsQAQCRunnerModalOpen: vi.fn(),
    selectedDailyRunId: null,
    handleSelectDailyRun: vi.fn(),
    activeAuthUserName: 'Operator',
    t: (key: string) => translate('en', key)
  };

  it('renders POI column header in Overall Progress (batches) tab', () => {
    const mockBatch = {
      id: 'batch-1',
      date: '2022-04-08',
      grid: '1',
      subgrid: 'N93E70',
      poiCount: 164,
      kmProcessed: 2.7,
      images: 105,
      defects: 0,
      status: 'Complete' as const
    };

    render(
      <DashboardBatchTable
        {...defaultProps}
        activeTab="batches"
        activeBatchLogs={[mockBatch as any]}
        dailyData={[]}
        filteredDailyData={[]}
      />
    );

    const poiHeader = screen.getByRole('columnheader', { name: 'POI' });
    expect(poiHeader).toBeInTheDocument();
    expect(screen.getByText('164')).toBeInTheDocument();
    // Ensure "FRAMES" header is not rendered
    expect(screen.queryByRole('columnheader', { name: 'FRAMES' })).toBeNull();
  });

  it('renders POI column header in Daily Progress tab', () => {
    const mockDaily = {
      id: 'daily-1',
      date: '2022-04-08',
      grid: '1',
      subgrid: 'N93E70',
      poiCount: 164,
      kmProcessed: 2.7,
      imagesProcessed: 105,
      imagesDefected: 0,
      pic: 'Operator',
      captureEquipment: 'MMS',
      publishToWebGIS: 'yes'
    };

    render(
      <DashboardBatchTable
        {...defaultProps}
        activeTab="daily"
        activeBatchLogs={[]}
        dailyData={[mockDaily]}
        filteredDailyData={[mockDaily]}
      />
    );

    const poiHeader = screen.getByRole('columnheader', { name: 'POI' });
    expect(poiHeader).toBeInTheDocument();
    expect(screen.getByText('164')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'FRAMES' })).toBeNull();
  });
});

/**
 * Regression cover for the defect-count bleed across runs of one subgrid.
 *
 * N93E70 was surveyed twice — 2022-04-08 and 2026-09-27 — and both Daily
 * Progress rows showed the same 54 defects, with the Overall Progress batch row
 * showing 108 because it summed them. The cause was a prefix scan over the
 * QA/QC audit cache (`key.startsWith('N93E70_')`) that let an unaudited run
 * adopt its sibling's audit record.
 *
 * This is the test that was missing when that bug was first reported fixed: the
 * original fix covered six other call sites and missed this component entirely,
 * so the wrong number stayed on screen.
 */
describe('DashboardBatchTable defect attribution across runs of one subgrid', () => {
  const AUDITED_RUN = 'spd-n93e70-08apr2022';
  const UNAUDITED_RUN = 'spd-n93e70-27sep2026';

  const auditedRun = {
    id: AUDITED_RUN,
    date: '2022-04-08',
    grid: '1',
    subgrid: 'N93E70',
    poiCount: 92,
    kmProcessed: 2.3,
    imagesProcessed: 92,
    imagesDefected: 0,
    pic: 'Faris.farhan95',
    captureEquipment: 'MMS',
    publishToWebGIS: 'no'
  };

  const unauditedRun = {
    ...auditedRun,
    id: UNAUDITED_RUN,
    date: '2026-09-27',
    poiCount: 196,
    kmProcessed: 0.3,
    imagesProcessed: 0
  };

  // Only the 2022 run was audited, with 54 defects.
  const auditRuns = {
    [`N93E70_${AUDITED_RUN}`]: {
      subgrid: 'N93E70',
      runId: AUDITED_RUN,
      totalStations: 92,
      defectCount: 54,
      passRate: 41
    }
  };

  const baseProps = {
    isDataLoading: false,
    selectedSubgridFilter: null,
    toggleSubgridFilter: vi.fn(),
    dailyDataBySubgrid: new Map(),
    setImagesListModal: vi.fn(),
    qaqcWorkerState: { isRunning: false, isCompleted: false, defectsList: [] },
    qaqcAuditRuns: auditRuns,
    setSelectedDefectSubgrid: vi.fn(),
    setDefectGalleryContext: vi.fn(),
    setIsDefectsGalleryOpen: vi.fn(),
    setIsQAQCRunnerModalOpen: vi.fn(),
    selectedDailyRunId: null,
    handleSelectDailyRun: vi.fn(),
    activeAuthUserName: 'Operator',
    t: (key: string) => translate('en', key)
  };

  it('shows the audited run its own count and 0 for its unaudited sibling', () => {
    render(
      <DashboardBatchTable
        {...baseProps}
        activeTab="daily"
        activeBatchLogs={[]}
        dailyData={[auditedRun, unauditedRun] as any}
        filteredDailyData={[auditedRun, unauditedRun] as any}
      />
    );

    // Exactly one defects value on screen: the audited run's 54.
    const defectCells = screen.getAllByRole('button', { name: '54' });
    expect(defectCells).toHaveLength(1);
  });

  it('does not render a defects button for a run with no audit of its own', () => {
    render(
      <DashboardBatchTable
        {...baseProps}
        activeTab="daily"
        activeBatchLogs={[]}
        dailyData={[unauditedRun] as any}
        filteredDailyData={[unauditedRun] as any}
      />
    );

    expect(screen.queryByRole('button', { name: '54' })).toBeNull();
  });

  it('sums the batch row from the corrected per-run counts, not 54 + 54', () => {
    const batch = {
      id: '2123S-BATCH-N93E70',
      date: '2022-04-08',
      grid: '1',
      subgrid: 'N93E70',
      poiCount: 288,
      kmProcessed: 2.6,
      images: 92,
      defects: 0,
      pic: 'Admin',
      status: 'Ongoing' as const
    };

    render(
      <DashboardBatchTable
        {...baseProps}
        activeTab="batches"
        activeBatchLogs={[batch as any]}
        dailyData={[auditedRun, unauditedRun] as any}
        filteredDailyData={[auditedRun, unauditedRun] as any}
        dailyDataBySubgrid={
          new Map([['N93E70', [{ ...auditedRun, defectCount: 54, imagesDefected: 54 } as any, unauditedRun]]])
        }
      />
    );

    // 54 (audited run) + 0 (unaudited run). The old double-count read 108.
    const defectCells = screen.getAllByRole('button', { name: '54' });
    expect(defectCells).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '108' })).toBeNull();
  });

  it('scopes the defect gallery to the run whose row was opened', () => {
    const setDefectGalleryContext = vi.fn();
    render(
      <DashboardBatchTable
        {...baseProps}
        setDefectGalleryContext={setDefectGalleryContext}
        activeTab="daily"
        activeBatchLogs={[]}
        dailyData={[auditedRun] as any}
        filteredDailyData={[auditedRun] as any}
      />
    );

    screen.getByRole('button', { name: '54' }).click();

    expect(setDefectGalleryContext).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'daily',
        subgrid: 'N93E70',
        runId: AUDITED_RUN
      })
    );
  });
});
