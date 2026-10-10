import type React from 'react';

/**
 * Dynamic CSS properties for a range slider thumb so it follows the colour the
 * slider controls. Shared by the catalog panel and the extracted 3D editor.
 */
export function getSliderStyle(color?: string): React.CSSProperties {
  if (!color) return {};
  const glow = color.startsWith('#') && color.length === 7 ? `${color}40` : color;
  return {
    '--slider-thumb-color': color,
    '--slider-thumb-glow': glow,
    accentColor: color
  } as React.CSSProperties;
}
