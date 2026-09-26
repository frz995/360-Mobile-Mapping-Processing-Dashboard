import { useEffect, useMemo, useRef, useState } from 'react';
import type { StationAgentObservation, WorkstationStationConfig } from '../types/production';
import { probeAllStationAgents } from '../services/stationAgentApi';

const DEFAULT_INTERVAL_MS = 10_000;

export interface StationAgentsState {
  observations: Record<string, StationAgentObservation>;
  lastTickAt?: string;
}

/**
 * Polls every configured workstation agent (LAN HTTP) on a fixed interval and
 * returns the latest observations keyed by station id. Used by the 4-PC
 * Multi-Station Flight Board to auto-flip statuses without operator clicks.
 */
export function useStationAgents(
  workstations: WorkstationStationConfig[] | undefined,
  intervalMs: number = DEFAULT_INTERVAL_MS
): StationAgentsState {
  const [observations, setObservations] = useState<Record<string, StationAgentObservation>>({});
  const [lastTickAt, setLastTickAt] = useState<string | undefined>(undefined);
  const inFlightRef = useRef(false);

  const wsSignature = (workstations || [])
    .filter((w) => w.ipAddress && w.enabled !== false)
    .map((w) => `${w.id}:${w.ipAddress}:${w.port || 8000}:${w.agentToken || ''}`)
    .join('|');

  const stationList = useMemo<WorkstationStationConfig[]>(() => {
    if (!wsSignature) return [];
    return (workstations || []).filter((w) => w.ipAddress && w.enabled !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsSignature]);

  useEffect(() => {
    if (stationList.length === 0) {
      setObservations({});
      return;
    }
    let disposed = false;
    const tick = () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      probeAllStationAgents(stationList)
        .then((map) => {
          if (disposed) return;
          setObservations((prev) => {
            const merged: Record<string, StationAgentObservation> = { ...prev, ...map };
            for (const w of stationList) {
              if (!map[w.id]) {
                merged[w.id] = { stationId: w.id, online: false, lastProbeAt: new Date().toISOString() };
              }
            }
            return merged;
          });
          setLastTickAt(new Date().toISOString());
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };
    tick();
    const iv = setInterval(tick, intervalMs);
    return () => {
      disposed = true;
      clearInterval(iv);
    };
  }, [stationList, intervalMs]);

  return { observations, lastTickAt };
}
