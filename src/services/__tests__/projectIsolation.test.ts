import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActiveProjectId } from '../projectContext';
import {
  saveAuditLogToSupabase,
  fetchAuditLogsFromSupabase,
  saveDatasetToSupabase,
  fetchDatasetsFromSupabase,
  saveProcessingJobToSupabase,
  fetchProcessingJobsFromSupabase,
  supabase
} from '../supabase';

describe('Project Data Isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    setActiveProjectId(null);
    vi.restoreAllMocks();
  });

  it('attaches project_id to saved audit logs when active project is set', async () => {
    setActiveProjectId('proj-alpha');

    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(supabase, 'from').mockReturnValue({
      insert: insertSpy
    } as any);

    await saveAuditLogToSupabase({
      timestamp: '2026-09-06 12:00',
      type: 'CREATE',
      title: 'Created Dataset',
      details: 'Test dataset created',
      user: 'Tester',
      status: 'success'
    });

    expect(insertSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'Created Dataset',
        project_id: 'proj-alpha'
      })
    ]);
  });

  it('scopes audit log fetch query by active project_id', async () => {
    setActiveProjectId('proj-beta');

    const eqSpy = vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue({
          data: [
            { id: '1', title: 'Beta Log', project_id: 'proj-beta' }
          ],
          error: null
        })
      })
    });

    const selectSpy = vi.fn().mockReturnValue({
      eq: eqSpy
    });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: selectSpy
    } as any);

    const logs = await fetchAuditLogsFromSupabase();

    expect(eqSpy).toHaveBeenCalledWith('project_id', 'proj-beta');
    expect(logs).toHaveLength(1);
    expect(logs[0].title).toBe('Beta Log');
  });

  it('partitions datasets in local storage per project_id', async () => {
    // Project A
    setActiveProjectId('proj-A');
    await saveDatasetToSupabase({
      name: 'Dataset A',
      dataset_type: 'RAW',
      pipeline_stage: 'STITCH',
      provider: 'MMS',
      source_folder: '/RAW/A',
      output_folder: '/OUT/A',
      storage_provider: 'nas_local',
      file_count: 10,
      size_bytes: 100,
      status: 'REGISTERED',
      version: 1,
      parent_dataset_id: null,
      created_by: 'Tester'
    });

    const datasetsA = await fetchDatasetsFromSupabase();
    expect(datasetsA).toHaveLength(1);
    expect(datasetsA[0].name).toBe('Dataset A');

    // Switch to Project B (should have 0 datasets)
    setActiveProjectId('proj-B');
    const datasetsB = await fetchDatasetsFromSupabase();
    expect(datasetsB).toHaveLength(0);

    // Save Dataset to Project B
    await saveDatasetToSupabase({
      name: 'Dataset B',
      dataset_type: 'RAW',
      pipeline_stage: 'STITCH',
      provider: 'MMS',
      source_folder: '/RAW/B',
      output_folder: '/OUT/B',
      storage_provider: 'nas_local',
      file_count: 20,
      size_bytes: 200,
      status: 'REGISTERED',
      version: 1,
      parent_dataset_id: null,
      created_by: 'Tester'
    });

    const updatedDatasetsB = await fetchDatasetsFromSupabase();
    expect(updatedDatasetsB).toHaveLength(1);
    expect(updatedDatasetsB[0].name).toBe('Dataset B');

    // Switch back to Project A (should only see Dataset A)
    setActiveProjectId('proj-A');
    const recheckA = await fetchDatasetsFromSupabase();
    expect(recheckA).toHaveLength(1);
    expect(recheckA[0].name).toBe('Dataset A');
  });

  it('partitions processing jobs in local storage per project_id', async () => {
    // Project X
    setActiveProjectId('proj-X');
    await saveProcessingJobToSupabase({
      name: 'Job X',
      subgrid: 'SG01',
      job_type: 'STITCH',
      status: 'QUEUED',
      source_dataset_id: 'ds1',
      output_dataset_id: null,
      source_folder: '/SRC/X',
      output_folder: '/OUT/X',
      total_items: 5,
      completed_items: 0,
      error_count: 0,
      progress: 0,
      operator: 'Tester'
    });

    const jobsX = await fetchProcessingJobsFromSupabase();
    expect(jobsX).toHaveLength(1);
    expect(jobsX[0].name).toBe('Job X');

    // Switch to Project Y (should have 0 jobs)
    setActiveProjectId('proj-Y');
    const jobsY = await fetchProcessingJobsFromSupabase();
    expect(jobsY).toHaveLength(0);

    // Save Job to Project Y
    await saveProcessingJobToSupabase({
      name: 'Job Y',
      subgrid: 'SG02',
      job_type: 'BLUR',
      status: 'IN_PROGRESS',
      source_dataset_id: 'ds2',
      output_dataset_id: null,
      source_folder: '/SRC/Y',
      output_folder: '/OUT/Y',
      total_items: 15,
      completed_items: 5,
      error_count: 0,
      progress: 33,
      operator: 'Tester'
    });

    const updatedJobsY = await fetchProcessingJobsFromSupabase();
    expect(updatedJobsY).toHaveLength(1);
    expect(updatedJobsY[0].name).toBe('Job Y');

    // Switch back to Project X (should still have only Job X)
    setActiveProjectId('proj-X');
    const recheckX = await fetchProcessingJobsFromSupabase();
    expect(recheckX).toHaveLength(1);
    expect(recheckX[0].name).toBe('Job X');
  });
});
