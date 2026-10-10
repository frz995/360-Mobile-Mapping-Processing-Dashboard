import { buildSubstationPopupBadge } from './substationMapLayers';

/**
 * Builds the HTML body for a catalog feature-click popup. Extracted from
 * RoadAnalysisMap to keep that god file within its size budget; behaviour is
 * byte-for-byte the previous inline template.
 */
export function buildCatalogFeaturePopupHtml(params: {
  name: string;
  geometryType: string;
  props: Record<string, unknown>;
  lat: number;
  lng: number;
}): string {
  const { name, geometryType, props, lat, lng } = params;
  const propKeys = Object.keys(props).slice(0, 6);

  const rowsHtml = propKeys
    .map(
      (k) =>
        `<div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
                   <span style="color: var(--text-muted, #94a3b8); font-size: 10px; text-transform: uppercase; font-weight: 500;">${k}:</span>
                   <span style="font-weight: 500; font-family: monospace; color: var(--text-primary, #f1f5f9); text-align: right; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${String(props[k])}</span>
                 </div>`
    )
    .join('');

  const subBadgeHtml = buildSubstationPopupBadge(props);

  return `
              <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 11px; line-height: 1.4; color: var(--text-primary, #f1f5f9); padding: 10px 12px; min-width: 200px; max-width: 280px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; padding-bottom: 5px; border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); padding-right: 22px;">
                  <span style="font-weight: 600; color: var(--text-primary, #f1f5f9); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${name.replace(/"/g, '&quot;')}">
                    ${name}
                  </span>
                  <span style="font-size: 9px; font-weight: 600; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--text-muted, #94a3b8); border: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); flex-shrink: 0;">
                    ${geometryType}
                  </span>
                </div>
                ${subBadgeHtml}
                <div style="display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px;">
                  ${rowsHtml || '<span style="color: var(--text-muted, #94a3b8);">No attribute table found.</span>'}
                </div>
                <div style="color: var(--text-muted, #64748b); font-size: 9px; font-family: monospace; border-top: 1px solid var(--border-subtle, rgba(255,255,255,0.08)); padding-top: 4px;">
                  ${lat.toFixed(5)}° N, ${lng.toFixed(5)}° E
                </div>
              </div>
            `;
}
