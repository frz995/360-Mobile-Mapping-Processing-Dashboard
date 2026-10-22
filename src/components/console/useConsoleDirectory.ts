/**
 * The console's company directory, shared by every panel.
 *
 * WHY A HOOK RATHER THAN EACH PANEL FETCHING
 *   The directory is the console's only real dataset. Six panels each calling
 *   `fetchAllOrganizations()` on mount means six round trips per navigation and
 *   six chances for two panels to disagree about how many companies exist — and
 *   on a page whose job is to report totals, two panels disagreeing is the one
 *   thing an operator cannot work around.
 *
 * THE NULL RULE
 *   Every derived figure returns `null` when the read failed. Not `0`. A failed
 *   read yields an empty array, so a sum over it is a confident zero for a
 *   quantity nobody measured, and a seller would read "you have sold no seats"
 *   off a network blip. `formatMetric` renders `null` as an em dash.
 *
 *   The figures themselves are computed in `consoleDirectoryMetrics.ts`, which
 *   is a pure module and can be tested without React.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAllOrganizations, type Organization } from '../../services/tenantContext';
import {
  computeConsoleMetrics,
  formatMetric,
  type ConsoleDirectoryMetrics
} from './consoleDirectoryMetrics';

export type { ConsoleDirectoryMetrics } from './consoleDirectoryMetrics';

export interface ConsoleDirectory {
  organizations: Organization[];
  isLoading: boolean;
  /** null when the last read was verified. A reason when it was not. */
  directoryError: string | null;
  reload: () => Promise<void>;
  metrics: ConsoleDirectoryMetrics;
  metric: (value: number | null | undefined, suffix?: string) => string;
}

export function useConsoleDirectory(): ConsoleDirectory {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchAllOrganizations();
      setOrganizations(result.organizations);
      setDirectoryError(result.error);
    } catch (err: unknown) {
      console.error('Failed to load organizations', err);
      setOrganizations([]);
      setDirectoryError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not reach the organization directory.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const metrics = useMemo<ConsoleDirectoryMetrics>(
    () => computeConsoleMetrics(organizations, directoryError),
    [organizations, directoryError]
  );

  const metric = useCallback((value: number | null | undefined, suffix = '') => formatMetric(value, suffix), []);

  return { organizations, isLoading, directoryError, reload, metrics, metric };
}
