// =====================================================================
// Car-roof / black-mask footprint detector.
// Panorama stitch methods (car-mounted MMS) leave a dark mask footprint at
// the bottom of the equirectangular frame. This scans a bounded region and
// reports the detected band so a MASK job can be generated for the NAS GPU
// Worker (generative-fill / LaMa).
// =====================================================================

import type { MaskFootprint } from '../types/production';

export interface DetectOptions {
  /** Fraction of image height to scan from the bottom (default 0.35). */
  scanBottomFraction?: number;
  /** Absolute luma threshold for "mask dark" (0..255, default 18). */
  darkThreshold?: number;
  /** Min fraction of dark pixels in a row for that row to count as mask row. */
  rowDarkRatioThreshold?: number;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Analyze the bottom band of an equirectangular image and report the mask
 * footprint. src must already be decoded (HTMLImageElement / canvas).
 */
export function detectMaskFootprint(
  src: HTMLImageElement | HTMLCanvasElement,
  opts: DetectOptions = {}
): MaskFootprint {
  const scanBottom = opts.scanBottomFraction ?? 0.35;
  const darkThreshold = opts.darkThreshold ?? 18;
  const rowDarkRatioThreshold = opts.rowDarkRatioThreshold ?? 0.65;

  const srcW = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const srcH = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  if (!srcW || !srcH) {
    return { detected: false, bottomBandHeight: 0, maskRatio: 0, confidence: 0 };
  }

  // Downscale to a bounded width for fast analysis.
  const maxW = 1024;
  const scale = Math.min(1, maxW / srcW);
  const w = Math.max(2, Math.round(srcW * scale));
  const h = Math.max(2, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { detected: false, bottomBandHeight: 0, maskRatio: 0, confidence: 0 };
  }
  ctx.drawImage(src, 0, 0, w, h);

  const scanStartRow = Math.floor(h * (1 - scanBottom));
  const imageData = ctx.getImageData(0, scanStartRow, w, h - scanStartRow);
  const px = imageData.data;
  const scanH = imageData.height;

  // Row-wise analysis: fraction of dark pixels per row.
  const rowDark = new Array<number>(scanH).fill(0);
  let totalDark = 0;
  for (let y = 0; y < scanH; y++) {
    let dark = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (luminance(px[i], px[i + 1], px[i + 2]) <= darkThreshold) dark += 1;
    }
    const ratio = dark / w;
    rowDark[y] = ratio;
    totalDark += ratio;
  }
  const meanRatio = totalDark / scanH;

  // Detect contiguous band of heavily-dark rows anchored at or near the bottom.
  let bottomSolidRows = 0;
  for (let y = scanH - 1; y >= 0; y--) {
    if (rowDark[y] >= rowDarkRatioThreshold) bottomSolidRows += 1;
    else break;
  }

  const fraction = bottomSolidRows / scanH; // of scan region
  const failsSolid = bottomSolidRows < Math.max(1, scanH * 0.05);

  if (failsSolid && meanRatio < 0.12) {
    return { detected: false, bottomBandHeight: 0, maskRatio: meanRatio, confidence: 0 };
  }

  // Confidence blends band solidity + overall + anchoredness.
  const anchoredPenalty = fraction;
  const confidence = Math.min(
    1,
    bottomSolidRows > 0
      ? (Math.min(1, bottomSolidRows / Math.max(1, scanH * 0.18)) * 0.7 +
          Math.min(1, meanRatio / 0.4) * 0.15 +
          Math.min(1, fraction + 0.2) * 0.15) *
          (0.6 + 0.4 * anchoredPenalty)
      : 0
  );

  const detected = confidence >= 0.45;
  return {
    detected,
    bottomBandHeight: (bottomSolidRows / scanH) * (scanBottom || 0),
    maskRatio: Math.min(1, meanRatio),
    confidence: Number(confidence.toFixed(2))
  };
}