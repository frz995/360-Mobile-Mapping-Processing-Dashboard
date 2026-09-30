// =====================================================================
// Shared helpers + prop types for the Image Production workspace tabs.
// =====================================================================

import type { ExtendedProjectSettings } from '../../types/admin';
import type { ProductionApiSettings } from '../../types/production';

export type TranslateFn = (key: string) => string;

export function getProductionApiSettings(
  projectSettings: ExtendedProjectSettings
): ProductionApiSettings {
  return {
    mode: projectSettings?.productionApiMode || 'http',
    baseUrl:
      projectSettings?.productionApiUrl ||
      import.meta.env.VITE_PRODUCTION_API_URL ||
      '',
    concurrency: projectSettings?.productionConcurrency || 4,
    nasWorkBasePath:
      projectSettings?.nasWorkBasePath ||
      import.meta.env.VITE_NAS_WORK_BASE_PATH ||
      '',
    apiKey:
      projectSettings?.productionApiKey ||
      import.meta.env.VITE_PRODUCTION_API_KEY ||
      ''
  };
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '—';
  }
}

const EARTH_RADIUS_M = 6371008.8;
const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres, or null when a coordinate is unusable. */
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number | null {
  if (![aLat, aLon, bLat, bLon].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const dLat = toRadians(bLat - aLat);
  const dLon = toRadians(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Summed track length over an ordered coordinate list, in metres. Returns null
 * when fewer than two usable points exist, so callers can report "not
 * computable" instead of a per-frame distance constant.
 */
export function trackLengthMeters(
  points: Array<{ latitude: number; longitude: number }>
): number | null {
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const leg = haversineMeters(
      points[i - 1].latitude,
      points[i - 1].longitude,
      points[i].latitude,
      points[i].longitude
    );
    if (leg !== null) total += leg;
  }
  return total;
}