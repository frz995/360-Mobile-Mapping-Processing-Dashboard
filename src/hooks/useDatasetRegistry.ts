// =====================================================================
// useDatasetRegistry — React hook for Dataset Intake, Registration & Lifecycle
// Isolates dataset state management, real-time sync, and duplicate validation.
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  fetchDatasetsFromSupabase,
  saveDatasetToSupabase,
  deleteDatasetFromSupabase,
  registerSurveyDataset,
  checkDatasetDuplicates
} from '../services/supabase';
import type { DatasetRecord, DatasetType, PipelineStage } from '../types/production';
import { createNextVersion } from '../utils/datasetVersioning';

export interface RegisterDatasetParams {
  name: string;
  subgrid?: string;
  equipment?: string;
  sourceFolder?: string;
  outputFolder?: string;
  fileCount?: number;
  sizeBytes?: number;
  datasetType?: DatasetType;
  pipelineStage?: PipelineStage;
  storageProvider?: string;
  userLabel?: string;
  metadata?: Record<string, unknown>;
}

export interface UseDatasetRegistryReturn {
  datasets: DatasetRecord[];
  loading: boolean;
  error: string | null;
  refreshDatasets: () => Promise<DatasetRecord[]>;
  registerDataset: (params: RegisterDatasetParams) => Promise<DatasetRecord | null>;
  updateDataset: (dataset: DatasetRecord) => Promise<DatasetRecord | null>;
  removeDataset: (id: string) => Promise<boolean>;
  createNewDatasetVersion: (current: DatasetRecord) => Promise<DatasetRecord | null>;
  checkForDuplicates: (subgrid: string, folderPath?: string) => Promise<DatasetRecord[]>;
}

export function useDatasetRegistry(): UseDatasetRegistryReturn {
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDatasets = useCallback(async (): Promise<DatasetRecord[]> => {
    setLoading(true);
    setError(null);
    try {
      const records = await fetchDatasetsFromSupabase();
      setDatasets(records);
      return records;
    } catch (err: any) {
      const msg = err?.message || 'Failed to fetch datasets';
      setError(msg);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDatasets();
  }, [refreshDatasets]);

  const register = useCallback(
    async (params: RegisterDatasetParams): Promise<DatasetRecord | null> => {
      const result = await registerSurveyDataset(params);
      if (result) {
        await refreshDatasets();
      }
      return result;
    },
    [refreshDatasets]
  );

  const update = useCallback(
    async (dataset: DatasetRecord): Promise<DatasetRecord | null> => {
      const result = await saveDatasetToSupabase(dataset);
      if (result) {
        await refreshDatasets();
      }
      return result;
    },
    [refreshDatasets]
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const ok = await deleteDatasetFromSupabase(id);
      if (ok) {
        await refreshDatasets();
      }
      return ok;
    },
    [refreshDatasets]
  );

  const createNewDatasetVersion = useCallback(
    async (current: DatasetRecord): Promise<DatasetRecord | null> => {
      if (!current.id) return null;
      const nextProps = createNextVersion(current);
      const superseed = await saveDatasetToSupabase({
        ...current,
        ...nextProps,
        name: current.name,
        subgrid: (current.subgrid || '').toUpperCase().trim()
      });
      if (!superseed?.id) return null;

      await saveDatasetToSupabase({ ...current, superseded_by: superseed.id });
      await refreshDatasets();
      return superseed;
    },
    [refreshDatasets]
  );

  const checkForDuplicates = useCallback(
    async (subgrid: string, folderPath?: string): Promise<DatasetRecord[]> => {
      return checkDatasetDuplicates(subgrid, folderPath);
    },
    []
  );

  return {
    datasets,
    loading,
    error,
    refreshDatasets,
    registerDataset: register,
    updateDataset: update,
    removeDataset: remove,
    createNewDatasetVersion,
    checkForDuplicates
  };
}
