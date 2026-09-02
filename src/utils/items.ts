/**
 * Shared item-identity utilities.
 * Extracted from App.tsx so that extracted components can import them
 * without creating circular dependencies.
 */

// Helper: Unique ID generator for daily runs and batch items
export function getItemId(item: any): string {
  if (!item) return '';
  if (item.id) return String(item.id);
  if (item._id) return String(item._id);
  if (item.runId) return String(item.runId);
  const poi = item.poiCount || item.imagesProcessed || item.images || (item.panoramas ? item.panoramas.length : 0);
  const km = item.kmProcessed || 0;
  return `row-${item.date || 'nodate'}-${item.subgrid || item.imageFilename || 'nosub'}-${poi}-${km}`;
}