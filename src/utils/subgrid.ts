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

/**
 * Generates a list of numbered image filenames for a subgrid, used by the
 * subgrid image list modal and the QC audit integrity checker.
 */
export function generateImageFilenamesList(subgrid: string, count: number, baseFilename?: string): string[] {
  const total = count > 0 ? count : 1;
  const cleanSubgrid = (subgrid || extractSubgridName(baseFilename) || '').toUpperCase().trim();

  if (!baseFilename) {
    const prefix = cleanSubgrid || 'SUBGRID';
    return Array.from({ length: total }, (_, i) => `${prefix}-${String(i + 1).padStart(4, '0')}.jpg`);
  }

  const clean = baseFilename.split('/').pop()?.trim() || baseFilename.trim();
  const match = clean.match(/^(.*?)-?(\d+)(\.[a-z0-9]+)?$/i);
  if (!match) {
    const prefix = cleanSubgrid || clean.replace(/\.[a-z0-9]+$/i, '');
    const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.')) : '.jpg';
    return Array.from({ length: total }, (_, i) => `${prefix}-${String(i + 1).padStart(4, '0')}${ext}`);
  }

  const prefix = match[1] || cleanSubgrid || clean.split('-')[0];
  const numStr = match[2];
  const ext = match[3] || '.jpg';
  const startNum = parseInt(numStr, 10);
  const padLen = Math.max(numStr.length, 4);

  const list: string[] = [];
  for (let i = 0; i < total; i++) {
    const nextNum = String(startNum + i).padStart(padLen, '0');
    list.push(`${prefix}-${nextNum}${ext}`);
  }
  return list;
}