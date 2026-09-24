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
