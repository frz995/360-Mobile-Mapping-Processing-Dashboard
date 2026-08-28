// =====================================================================
// Image enhancement pipeline — browser parameter designer.
// The dashboard is the "designer": sliders produce EnhancementParams which
// the NAS GPU Worker applies deterministically to the whole batch.
// This module only powers live preview + single-frame export for trials.
// =====================================================================

import type { EnhancementParams } from '../types/production';

/** CSS filter string mapping for cheap, live <img> preview. */
export function enhancementToCssFilter(params: EnhancementParams): string {
  const parts: string[] = [];
  const brightness = 1 + (params.brightness + params.exposure) / 200; // exposure folded into brightness approx
  const contrast = 1 + params.contrast / 100;
  const saturation = 1 + params.saturation / 100;
  const blur = params.denoise > 0 ? Math.max(0, params.denoise / 10) : 0;

  if (brightness !== 1) parts.push(`brightness(${brightness.toFixed(3)})`);
  if (contrast !== 1) parts.push(`contrast(${contrast.toFixed(3)})`);
  if (saturation !== 1) parts.push(`saturate(${saturation.toFixed(3)})`);
  if (blur > 0) parts.push(`blur(${blur.toFixed(2)}px)`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Full pixel-level pipeline on an ImageData.
 * Sharpness uses an unsharp mask (once); denoise uses a light box blur of the
 * luma channel. All other controls are per-pixel adjustments.
 */
export function applyEnhancementToImageData(data: ImageData, params: EnhancementParams): ImageData {
  const { data: px } = data;
  const n = px.length;

  const brightness = params.brightness / 100; // +1 → +255
  const exposure = params.exposure / 100;
  const contrastFactor = 1 + params.contrast / 100;
  const saturationFactor = 1 + params.saturation / 100;
  const sharpen = params.sharpness > 0 ? params.sharpness / 100 : 0;
  const denoise = params.denoise > 0 ? params.denoise / 100 : 0;

  // 1) Light denoise (box blur on luma, applied to RGB) before sharpening.
  if (denoise > 0) {
    const { width, height } = data;
    const radius = Math.max(1, Math.round(6 * denoise));
    const src = new Uint8ClampedArray(px);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // skip edges for speed; negligible on previews
        if (x < radius || y < radius || x >= width - radius || y >= height - radius) continue;
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const row = (y + dy) * width;
          for (let dx = -radius; dx <= radius; dx++) {
            const i = (row + x + dx) * 4;
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
            count += 1;
          }
        }
        const i = (y * width + x) * 4;
        const blend = 0.55 * denoise;
        px[i] = clampByte(src[i] * (1 - blend) + (r / count) * blend);
        px[i + 1] = clampByte(src[i + 1] * (1 - blend) + (g / count) * blend);
        px[i + 2] = clampByte(src[i + 2] * (1 - blend) + (b / count) * blend);
      }
    }
  }

  for (let i = 0; i < n; i += 4) {
    let r = px[i];
    let g = px[i + 1];
    let b = px[i + 2];

    // Brightness + exposure
    r += (brightness + exposure) * 255;
    g += (brightness + exposure) * 255;
    b += (brightness + exposure) * 255;

    // Contrast around mid-gray
    r = (r - 127.5) * contrastFactor + 127.5;
    g = (g - 127.5) * contrastFactor + 127.5;
    b = (b - 127.5) * contrastFactor + 127.5;

    // Saturation (luma-preserving)
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + (r - luma) * saturationFactor;
    g = luma + (g - luma) * saturationFactor;
    b = luma + (b - luma) * saturationFactor;

    px[i] = clampByte(r);
    px[i + 1] = clampByte(g);
    px[i + 2] = clampByte(b);
  }

  // 2) Unsharp mask — sharpen by subtracting a blurred copy.
  if (sharpen > 0) {
    const { width, height } = data;
    const radius = Math.max(1, Math.round(3 * sharpen));
    const strength = 0.6 * sharpen;
    const src = new Uint8ClampedArray(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < radius || y < radius || x >= width - radius || y >= height - radius) continue;
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const row = (y + dy) * width;
          for (let dx = -radius; dx <= radius; dx++) {
            const i = (row + x + dx) * 4;
            r += src[i];
            g += src[i + 1];
            b += src[i + 2];
            count += 1;
          }
        }
        const i = (y * width + x) * 4;
        px[i] = clampByte(px[i] + (px[i] - r / count) * strength);
        px[i + 1] = clampByte(px[i + 1] + (px[i + 1] - g / count) * strength);
        px[i + 2] = clampByte(px[i + 2] + (px[i + 2] - b / count) * strength);
      }
    }
  }

  return data;
}

/** Render an image element into a processed canvas at bounded scale (default 0.5). */
export function renderEnhancedCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  params: EnhancementParams,
  scale = 0.5
): HTMLCanvasElement {
  const srcW = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const srcH = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.drawImage(source, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  applyEnhancementToImageData(imageData, params);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Export an enhanced canvas to a JPEG blob for download / NAS placement. */
export function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = 0.92
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to export canvas blob.'))),
      'image/jpeg',
      quality
    );
  });
}

/** Trigger a browser download of a blob (operator then places it on the NAS). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Load an image from a URL into an HTMLImageElement with CORS + retry. */
export function loadImageWithRetry(
  url: string,
  maxAttempts = 2
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const attempt = (n: number) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        if (n > 1) {
          attempt(n - 1);
        } else {
          reject(new Error(`Image load failed: ${url}`));
        }
      };
      img.src = url;
    };
    attempt(maxAttempts);
  });
}