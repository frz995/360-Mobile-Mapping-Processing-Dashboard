/**
 * Canonical subgrid name extraction utility.
 * Consolidates the two divergent implementations that previously existed
 * in App.tsx and services/supabase.ts into a single source of truth.
 */

/**
 * Dynamically extracts subgrid prefix from any filename or string.
 * Priority order:
 * 1. GIS coordinate syntax: NxxExx / SxxWxx
 * 2. General prefix before hyphen or underscore
 * 3. File basename without extension
 */
export function extractSubgridName(filenameOrSubgrid?: string): string {
  if (!filenameOrSubgrid) return '';
  const clean = filenameOrSubgrid.split('/').pop()?.trim() || filenameOrSubgrid.trim();

  // 1. Check GIS coordinate syntax: NxxExx / SxxWxx
  const coordMatch = clean.match(/([NS]\d+[EW]\d+)/i);
  if (coordMatch) return coordMatch[1].toUpperCase();

  // 2. Check general prefix before hyphen or underscore
  const prefixMatch = clean.match(/^([A-Za-z0-9]+)[-_]/);
  if (prefixMatch) return prefixMatch[1].toUpperCase();

  // 3. Fallback: file basename without extension
  return clean.replace(/\.[^/.]+$/, '').toUpperCase();
}
