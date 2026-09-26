import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MultiPCStationBoard } from '../hub/MultiPCStationBoard';
import type {
  StationAgentObservation,
  StationBoardRow,
  WorkstationStationId
} from '../../../types/production';

vi.mock('../../../services/api/stationBoard', () => ({
  fetchStationBoardItemsFromSupabase: vi.fn(),
  upsertStationBoardItemInSupabase: vi.fn()
}));

vi.mock('../../../services/api/stageEventLedger', () => ({
  appendStageEventToSupabase: vi.fn()
}));

import {
  fetchStationBoardItemsFromSupabase,
  upsertStationBoardItemInSupabase
} from '../../../services/api/stationBoard';
import { appendStageEventToSupabase } from '../../../services/api/stageEventLedger';

const mockedFetchRows = vi.mocked(fetchStationBoardItemsFromSupabase);
const mockedUpsert = vi.mocked(upsertStationBoardItemInSupabase);
const mockedAppendEvent = vi.mocked(appendStageEventToSupabase);

function obsFor(
  stationId: WorkstationStationId,
  patch: Record<string, unknown>
): StationAgentObservation {
  return {
    stationId,
    online: true,
    lastProbeAt: '2026-09-26T08:05:00+00:00',
    report: patch as any
  };
}

const RUNNING = {
  task: { started: true, processes: [{ name: 'ptgui.exe', first_started_at: '2026-09-26T08:00:00+00:00' }], first_started_at: '2026-09-26T08:00:00+00:00' },
  output: { stage: '03_Stitching', subgrids: { N93E70: { files: 5, last_write_at: '2026-09-26T08:04:00+00:00', growing: true } } }
};

const COMPLETED = {
  task: { started: false, processes: [], first_started_at: '2026-09-26T08:00:00+00:00' },
  output: { stage: '03_Stitching', subgrids: { N93E70: { files: 92, last_write_at: '2026-09-26T08:30:00+00:00', growing: false } } }
};

const ENDED_EARLY = {
  task: { started: false, processes: [], first_started_at: '2026-09-26T08:00:00+00:00' },
  output: { stage: '03_Stitching', subgrids: { N93E70: { files: 3, last_write_at: '2026-09-26T08:10:00+00:00', growing: false } } }
};

function baseUrl(extra: Partial<Record<WorkstationStationId, StationAgentObservation>> = {}, props: Record<string, unknown> = {}) {
  return render(
    <MultiPCStationBoard
      subgrid="N93E70"
      totalFrames={92}
      onAdvanceToQA={onAdvanceQaMock}
      userLabel="QA Lead"
      {...(Object.keys(extra).length ? { stationObservations: extra } : { stationObservations: {} })}
      {...props}
    />
  );
}

const onAdvanceQaMock = vi.fn();

describe('MultiPCStationBoard (auto-detected flight board)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchRows.mockResolvedValue([]);
    mockedUpsert.mockResolvedValue(true);
    mockedAppendEvent.mockResolvedValue(true);
  });

  afterEach(cleanup);

  it('shows awaiting-agent cards when there are no observations', async () => {
    baseUrl();
    await waitFor(() => {
      expect(screen.getAllByText('Awaiting agent').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Not started').length).toBe(4);
  });

  it('flips a station to In progress with live counts when the agent reports a running process', async () => {
    baseUrl({ stitch: obsFor('stitch', RUNNING) });
    await waitFor(() => {
      expect(screen.getAllByText('In progress').length).toBe(1);
    });
    expect(screen.getByText('5 / 92 (5%)')).toBeInTheDocument();
    expect(screen.getAllByText('Auto · agent').length).toBe(1);
  });

  it('auto-completes a station when files reach the batch target and unlocks the QA gate', async () => {
    const observations = ({
      blur: obsFor('blur', { ...COMPLETED, output: { stage: '02_Blurring', subgrids: { N93E70: { files: 92, last_write_at: '2026-09-26T07:50:00+00:00', growing: false } } } }),
      stitch: obsFor('stitch', COMPLETED),
      lightroom: obsFor('lightroom', { ...COMPLETED, output: { stage: '04_Lightroom', subgrids: { N93E70: { files: 92, last_write_at: '2026-09-26T08:40:00+00:00', growing: false } } } }),
      photoshop: obsFor('photoshop', { ...COMPLETED, output: { stage: '05_Final', subgrids: { N93E70: { files: 92, last_write_at: '2026-09-26T08:50:00+00:00', growing: false } } } })
    });
    baseUrl(observations as any);
    await waitFor(() => {
      expect(screen.getByText('Proceed to 360° QA Review')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Completed').length).toBe(4);
    fireEvent.click(screen.getByText('Proceed to 360° QA Review'));
    expect(onAdvanceQaMock).toHaveBeenCalled();
  });

  it('flags a station whose process ended before the batch target', async () => {
    baseUrl({ stitch: obsFor('stitch', ENDED_EARLY) });
    await waitFor(() => {
      expect(screen.getByText('Flagged — early exit')).toBeInTheDocument();
    });
    expect(screen.getByText(/ended with 3 of 92 frame\(s\)/)).toBeInTheDocument();
  });

  it('restores persisted snapshots when agents are unreachable', async () => {
    const row: StationBoardRow = {
      project_id: null,
      subgrid: 'N93E70',
      station_id: 'stitch',
      status: 'IN_PROGRESS',
      total_frames: 92,
      completed_frames: 24,
      started_at: '2026-09-26T07:00:00+00:00',
      last_agent_pulse: '2026-09-26T07:59:00+00:00',
      source: 'agent'
    };
    mockedFetchRows.mockResolvedValue([row]);
    baseUrl();
    await waitFor(() => {
      expect(screen.getAllByText('Restored snapshot').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('24 / 92 (26%)')).toBeInTheDocument();
  });

  it('counts the blur station in capture points (tile rigs) instead of images', async () => {
    const blurPoints = {
      task: { started: false, processes: [], first_started_at: null },
      output: { stage: '02_Blurring', subgrids: { N93E70: { files: 108, last_write_at: '2026-09-26T09:00:00+00:00', growing: false } } },
      points: { stage_in: '00_Raw_data', point_mode: true, subgrids: { N93E70: { points_total: 5, points_done: 5, tiles_done: 540 } }, error: null }
    };
    baseUrl({
      blur: obsFor('blur', blurPoints),
      stitch: obsFor('stitch', { ...COMPLETED, output: { stage: '03_Stitching', subgrids: { N93E70: { files: 92, last_write_at: '2026-09-26T08:30:00+00:00', growing: false } } } }),
      lightroom: obsFor('lightroom', { ...COMPLETED, output: { stage: '04_Lightroom', subgrids: { N93E70: { files: 92, last_write_at: '2026-09-26T08:40:00+00:00', growing: false } } } }),
      photoshop: obsFor('photoshop', { ...COMPLETED, output: { stage: '05_Final', subgrids: { N93E70: { files: 92, last_write_at: '2026-09-26T08:50:00+00:00', growing: false } } } })
    });
    await waitFor(() => {
      expect(screen.getByText('5 / 5 pts (100%)')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Completed').length).toBe(4);
    expect(screen.getByText(/Counted in capture points .* 540 tiles blurred/)).toBeInTheDocument();
    expect(screen.getByText('Proceed to 360° QA Review')).toBeInTheDocument();
  });

  it('keeps partial point progress flowing without flagging while the process runs', async () => {
    const blurRunning = {
      task: { started: true, processes: [{ name: 'privacykeeper.exe', first_started_at: '2026-09-26T08:00:00+00:00' }], first_started_at: '2026-09-26T08:00:00+00:00' },
      output: { stage: '02_Blurring', subgrids: { N93E70: { files: 108, last_write_at: '2026-09-26T09:00:00+00:00', growing: true } } },
      points: { stage_in: '00_Raw_data', point_mode: true, subgrids: { N93E70: { points_total: 5, points_done: 2, tiles_done: 216 } }, error: null }
    };
    baseUrl({ blur: obsFor('blur', blurRunning) });
    await waitFor(() => {
      expect(screen.getByText('2 / 5 pts (40%)')).toBeInTheDocument();
    });
    expect(screen.getAllByText('In progress').length).toBe(1);
  });

  it('persists derived state to Supabase after observations arrive', async () => {
    baseUrl({ stitch: obsFor('stitch', RUNNING) });
    await waitFor(() => {
      expect(mockedUpsert).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        mockedUpsert.mock.calls.some(([row]) => row.station_id === 'stitch')
      ).toBe(true);
    });
    const call = mockedUpsert.mock.calls.map(([row]) => row).find((row) => row.station_id === 'stitch');
    if (!call) throw new Error('no stitch upsert recorded');
    expect(call.status).toBe('IN_PROGRESS');
    expect(call.total_frames).toBe(92);
    expect(call.started_at).toBe('2026-09-26T08:00:00+00:00');
  });

  it('shows a not-selected guard without a subgrid', () => {
    render(
      <MultiPCStationBoard
        subgrid=""
        totalFrames={0}
        onAdvanceToQA={onAdvanceQaMock}
        userLabel="QA"
      />
    );
    expect(screen.getByText('No Subgrid Selected')).toBeInTheDocument();
  });

  it('appends STARTED and PROGRESS ledger events while a station runs, then COMPLETED', async () => {
    const mounted = render(
      <MultiPCStationBoard
        subgrid="N93E70"
        totalFrames={92}
        onAdvanceToQA={onAdvanceQaMock}
        userLabel="QA Lead"
        stationObservations={{}}
      />
    );
    await waitFor(() => {
      expect(mockedFetchRows).toHaveBeenCalled();
    });
    await waitFor(() => {
      // rowsLoaded flips before the first upsert burst persists state
      expect(mockedUpsert).toHaveBeenCalled();
    });

    // WAITING -> IN_PROGRESS: STARTED event from agent telemetry
    mounted.rerender(
      <MultiPCStationBoard
        subgrid="N93E70"
        totalFrames={92}
        onAdvanceToQA={onAdvanceQaMock}
        userLabel="QA Lead"
        stationObservations={{ stitch: obsFor('stitch', { ...RUNNING, output: { stage: '03_Stitching', subgrids: { N93E70: { files: 7, last_write_at: '2026-09-26T08:04:00+00:00', growing: true } } } }) } as any}
      />
    );
    await waitFor(() => {
      expect(mockedAppendEvent.mock.calls.some(([e]) => e.stage === 'stitch' && e.event === 'STARTED')).toBe(true);
    });

    // 7 -> 12 frames: PROGRESS event with the new count
    mounted.rerender(
      <MultiPCStationBoard
        subgrid="N93E70"
        totalFrames={92}
        onAdvanceToQA={onAdvanceQaMock}
        userLabel="QA Lead"
        stationObservations={{ stitch: obsFor('stitch', { ...RUNNING, output: { stage: '03_Stitching', subgrids: { N93E70: { files: 12, last_write_at: '2026-09-26T08:06:00+00:00', growing: true } } } }) } as any}
      />
    );
    await waitFor(() => {
      expect(mockedAppendEvent.mock.calls.some(([e]) => e.stage === 'stitch' && e.event === 'PROGRESS')).toBe(true);
    });

    // process exits with the batch target reached: COMPLETED event (file mtime)
    mounted.rerender(
      <MultiPCStationBoard
        subgrid="N93E70"
        totalFrames={92}
        onAdvanceToQA={onAdvanceQaMock}
        userLabel="QA Lead"
        stationObservations={{ stitch: obsFor('stitch', COMPLETED) } as any}
      />
    );
    await waitFor(() => {
      const completedCall = mockedAppendEvent.mock.calls.find(([e]) => e.stage === 'stitch' && e.event === 'COMPLETED');
      expect(completedCall).toBeDefined();
      if (completedCall) {
        expect(completedCall[0].occurrence).toBe('2026-09-26T08:30:00+00:00');
        expect(completedCall[0].counts).toMatchObject({ done: 92, total: 92 });
      }
    });
  });
});
