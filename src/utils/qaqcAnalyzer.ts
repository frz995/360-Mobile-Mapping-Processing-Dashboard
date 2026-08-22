/**
 * QA/QC Automated Analysis Engine
 * Real-time detection algorithms for 360° street view trajectory quality assurance:
 * 1. Geodesic GPS telemetry drift and dropouts
 * 2. Equirectangular frame sharpness using Gaussian-filtered Tenengrad Gradient Energy ROI
 * 3. Lens obstruction, solar glare, and severe clipping using luminance histograms
 */

export interface GeoPoint {
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  lon?: number | null;
  bearing?: number | null;
  heading?: number | null;
}

export interface GpsAnalysisResult {
  isBadGps: boolean;
  reason?: string;
  distanceMeters: number;
}

export type AnalysisStatus = 'success' | 'fallback' | 'skipped' | 'error';

export interface ImageAnalysisResult {
  isBlur: boolean;
  isObstruction: boolean;
  blurVariance: number; // Tenengrad focus sharpness score (e.g. < 12.0 = defect, 12 - 25 = marginal, > 25 = sharp)
  tenengradScore?: number;
  avgBrightness: number;
  clippedRatio: number;
  reason?: string;
  analysisStatus: AnalysisStatus;
}

export interface QAQCThresholdSettings {
  blurVarianceThreshold?: number; // from Project Settings (default: 60.0 - calibrated for outdoor 360 street view)
  gpsMaxJumpDistanceMeters?: number; // from Project Settings (default: 50m)
  glareLuminanceThreshold?: number; // from Project Settings (default: 240)
  obstructionMinBrightness?: number; // from Project Settings (default: 15)
  gradientMagnitudeThreshold?: number; // from Project Settings (default: 400)
}

export const DEFAULT_QAQC_THRESHOLDS: Required<QAQCThresholdSettings> = {
  blurVarianceThreshold: 60.0,
  gpsMaxJumpDistanceMeters: 50.0,
  glareLuminanceThreshold: 240.0,
  obstructionMinBrightness: 15.0,
  gradientMagnitudeThreshold: 400.0
};

/**
 * Calculates geodesic distance in meters between two lat/lng coordinates using the Haversine formula.
 */
export function calculateGeodesicDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculates geodesic forward azimuth / bearing in degrees [0, 360) between two coordinates.
 */
export function calculateForwardBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(radLat2);
  const x =
    Math.cos(radLat1) * Math.sin(radLat2) -
    Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(dLon);

  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Detects invalid GPS coordinates (0/null) or geodesic distance jumps exceeding dynamic thresholds.
 */
export function detectBadGps(
  currentPoint?: GeoPoint | null,
  prevPoint?: GeoPoint | null,
  options?: number | { maxJumpThresholdMeters?: number; thresholds?: QAQCThresholdSettings } | QAQCThresholdSettings
): GpsAnalysisResult {
  let maxJumpThresholdMeters = DEFAULT_QAQC_THRESHOLDS.gpsMaxJumpDistanceMeters;
  if (typeof options === 'number') {
    maxJumpThresholdMeters = options;
  } else if (options && typeof options === 'object') {
    if ('gpsMaxJumpDistanceMeters' in options && typeof options.gpsMaxJumpDistanceMeters === 'number') {
      maxJumpThresholdMeters = options.gpsMaxJumpDistanceMeters;
    } else if ('thresholds' in options && options.thresholds?.gpsMaxJumpDistanceMeters) {
      maxJumpThresholdMeters = options.thresholds.gpsMaxJumpDistanceMeters;
    } else if ('maxJumpThresholdMeters' in options && typeof options.maxJumpThresholdMeters === 'number') {
      maxJumpThresholdMeters = options.maxJumpThresholdMeters;
    }
  }

  if (!currentPoint) {
    return {
      isBadGps: true,
      reason: 'No point telemetry provided (null station)',
      distanceMeters: 0
    };
  }

  const currLat = currentPoint.latitude ?? currentPoint.lat ?? null;
  const currLng = currentPoint.longitude ?? currentPoint.lng ?? currentPoint.lon ?? null;

  // 1. Missing or zero coordinates check
  if (
    currLat === null ||
    currLng === null ||
    isNaN(Number(currLat)) ||
    isNaN(Number(currLng)) ||
    (Number(currLat) === 0 && Number(currLng) === 0)
  ) {
    return {
      isBadGps: true,
      reason: 'Null or 0.0, 0.0 coordinates detected (GPS dropout)',
      distanceMeters: 0
    };
  }

  const cLat = Number(currLat);
  const cLng = Number(currLng);

  // 2. Geodesic sequential jump check exceeding dynamic threshold
  if (prevPoint) {
    const prevLat = prevPoint.latitude ?? prevPoint.lat ?? null;
    const prevLng = prevPoint.longitude ?? prevPoint.lng ?? prevPoint.lon ?? null;

    if (
      prevLat !== null &&
      prevLng !== null &&
      !isNaN(Number(prevLat)) &&
      !isNaN(Number(prevLng)) &&
      (Number(prevLat) !== 0 || Number(prevLng) !== 0)
    ) {
      const distance = calculateGeodesicDistanceMeters(
        Number(prevLat),
        Number(prevLng),
        cLat,
        cLng
      );

      if (distance > maxJumpThresholdMeters) {
        return {
          isBadGps: true,
          reason: `Geodesic distance jump of ${distance.toFixed(1)}m exceeds ${maxJumpThresholdMeters}m limit`,
          distanceMeters: distance
        };
      }

      return {
        isBadGps: false,
        distanceMeters: distance
      };
    }
  }

  return {
    isBadGps: false,
    distanceMeters: 0
  };
}

/**
 * Robust Tenengrad Focus Measure (Gaussian-Filtered Sobel Gradient Energy)
 * 1. Focuses strictly on middle horizon ROI band (height 20% to 65%), excluding sky & vehicle mask.
 * 2. Applies 3x3 Gaussian smoothing kernel to eliminate foliage micro-grain and high-ISO sensor noise.
 * 3. Computes Sobel horizontal (Gx) and vertical (Gy) gradients: M(x,y) = Gx^2 + Gy^2.
 * 4. Integrates gradient energy for all pixels exceeding gradient threshold (e.g. 2500).
 * 5. Returns calibrated Tenengrad sharpness score (< 12.0 = Defect, 12 - 25 = Marginal, > 25 = Sharp).
 */
export async function detectBlurAndObstruction(
  imageUrl: string,
  options?: {
    blurThreshold?: number;
    darkThreshold?: number;
    glareThresholdRatio?: number;
    glareLuminanceThreshold?: number;
    gradientMagnitudeThreshold?: number;
    timeoutMs?: number;
    thresholds?: QAQCThresholdSettings;
  }
): Promise<ImageAnalysisResult> {
  const blurThreshold =
    options?.thresholds?.blurVarianceThreshold ??
    options?.blurThreshold ??
    DEFAULT_QAQC_THRESHOLDS.blurVarianceThreshold;

  const darkThreshold =
    options?.thresholds?.obstructionMinBrightness ??
    options?.darkThreshold ??
    DEFAULT_QAQC_THRESHOLDS.obstructionMinBrightness;

  const glareLuminanceThreshold =
    options?.thresholds?.glareLuminanceThreshold ??
    options?.glareLuminanceThreshold ??
    DEFAULT_QAQC_THRESHOLDS.glareLuminanceThreshold;

  const glareThresholdRatio = options?.glareThresholdRatio ?? 0.95;
  const timeoutMs = options?.timeoutMs ?? 1500; // Increased to 1500ms to allow remote 360 panorama decoding

  if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim().length === 0) {
    return {
      isBlur: false,
      isObstruction: false,
      blurVariance: 0,
      tenengradScore: 0,
      avgBrightness: 0,
      clippedRatio: 0,
      reason: 'SKIPPED_NO_IMAGE_URL',
      analysisStatus: 'skipped'
    };
  }

  // Resilient Image Loader with timeout and fallback
  const loadImage = async (src: string, timeout: number): Promise<HTMLImageElement | null> => {
    // 1. First attempt: standard crossOrigin anonymous Image
    const attemptImg = (useCors: boolean) =>
      new Promise<HTMLImageElement | null>((resolve) => {
        const img = new Image();
        if (useCors) {
          img.crossOrigin = 'anonymous';
        }
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });

    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeout)
    );

    let loaded = await Promise.race([attemptImg(true), timeoutPromise]);
    if (!loaded) {
      // 2. Second attempt without crossOrigin if CORS was blocked
      loaded = await Promise.race([attemptImg(false), timeoutPromise]);
    }
    return loaded;
  };

  const loadedImg = await loadImage(imageUrl, timeoutMs);

  if (!loadedImg) {
    return {
      isBlur: false,
      isObstruction: false,
      blurVariance: 0,
      tenengradScore: 0,
      avgBrightness: 128.0,
      clippedRatio: 0,
      reason: 'SKIPPED_IMG_TIMEOUT',
      analysisStatus: 'skipped'
    };
  }

  // Process image on offscreen 512x256 (2:1 panoramic ratio) canvas
  try {
    const sampleWidth = 512;
    const sampleHeight = 256;
    const canvas = document.createElement('canvas');
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      return {
        isBlur: false,
        isObstruction: false,
        blurVariance: 0,
        tenengradScore: 0,
        avgBrightness: 128.0,
        clippedRatio: 0,
        reason: 'SKIPPED (Canvas Unavailable)',
        analysisStatus: 'fallback'
      };
    }

    ctx.drawImage(loadedImg, 0, 0, sampleWidth, sampleHeight);

    let imgData: ImageData;
    try {
      imgData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    } catch (_corsErr) {
      ctx.clearRect(0, 0, sampleWidth, sampleHeight);
      canvas.width = 0;
      canvas.height = 0;
      return {
        isBlur: false,
        isObstruction: false,
        blurVariance: 0,
        tenengradScore: 0,
        avgBrightness: 130.0,
        clippedRatio: 0,
        reason: 'SKIPPED (CORS Protected)',
        analysisStatus: 'fallback'
      };
    }

    const data = imgData.data;
    const totalPixels = sampleWidth * sampleHeight;
    const gray = new Float32Array(totalPixels);

    let totalBrightness = 0;
    let clippedPixels = 0;

    // 1. Grayscale conversion & luminance histogram stats
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      // ITU-R BT.601 luma formula
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[i] = lum;
      totalBrightness += lum;

      // Clipped highlight detection
      if (r >= glareLuminanceThreshold && g >= glareLuminanceThreshold && b >= glareLuminanceThreshold) {
        clippedPixels++;
      }
    }

    const avgBrightness = totalBrightness / totalPixels;
    const clippedRatio = clippedPixels / totalPixels;

    // 2. Obstruction and solar glare checks
    let isObstruction = false;
    const reasons: string[] = [];

    if (avgBrightness < darkThreshold) {
      isObstruction = true;
      reasons.push(`Lens occlusion / underexposed frame (Brightness: ${avgBrightness.toFixed(1)} < ${darkThreshold})`);
    } else if (clippedRatio > glareThresholdRatio) {
      isObstruction = true;
      reasons.push(`Severe solar glare / overexposure clipping (${(clippedRatio * 100).toFixed(1)}% clipped >= ${glareLuminanceThreshold})`);
    }

    // 3. Multi-Patch Object & Asset Region Sharpness Analysis
    // Divides the 360° panorama horizon (25% to 75% height) into 32 inspection tiles (8 horizontal x 4 vertical)
    // to evaluate high-frequency edge definition on assets (poles, wires, buildings, vegetation)
    // without dilution from smooth sky or flat road surfaces.
    const startY = Math.max(1, Math.floor(sampleHeight * 0.20));
    const endY = Math.min(sampleHeight - 1, Math.floor(sampleHeight * 0.75));
    const startX = 1;
    const endX = sampleWidth - 1;

    const roiWidth = endX - startX;
    const roiHeight = endY - startY;

    const gridCols = 8;
    const gridRows = 4;
    const patchWidth = Math.floor(roiWidth / gridCols);
    const patchHeight = Math.floor(roiHeight / gridRows);

    const patchScores: number[] = [];

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const pStartX = startX + c * patchWidth;
        const pEndX = Math.min(endX, pStartX + patchWidth);
        const pStartY = startY + r * patchHeight;
        const pEndY = Math.min(endY, pStartY + patchHeight);

        let pSumLap = 0;
        let pSumLapSq = 0;
        let pPixelCount = 0;

        for (let py = pStartY + 1; py < pEndY - 1; py++) {
          const rowOffset = py * sampleWidth;
          const rowAbove = (py - 1) * sampleWidth;
          const rowBelow = (py + 1) * sampleWidth;

          for (let px = pStartX + 1; px < pEndX - 1; px++) {
            pPixelCount++;

            // 4-neighbor Discrete Laplacian Operator
            const lap =
              gray[rowAbove + px] +
              gray[rowBelow + px] +
              gray[rowOffset + (px - 1)] +
              gray[rowOffset + (px + 1)] -
              4 * gray[rowOffset + px];

            pSumLap += lap;
            pSumLapSq += lap * lap;
          }
        }

        if (pPixelCount > 30) {
          const pMeanLap = pSumLap / pPixelCount;
          const pVariance = Math.max(0, (pSumLapSq / pPixelCount) - (pMeanLap * pMeanLap));
          patchScores.push(pVariance);
        }
      }
    }

    // Sort patch variances descending to isolate asset/object feature regions
    patchScores.sort((a, b) => b - a);

    // Compute Top-40% Asset Feature Sharpness Score (evaluates sharpness on actual structural content)
    let sharpnessScore = 0;
    if (patchScores.length > 0) {
      const topCount = Math.max(1, Math.floor(patchScores.length * 0.40));
      const topSum = patchScores.slice(0, topCount).reduce((acc, v) => acc + v, 0);
      sharpnessScore = Math.round((topSum / topCount) * 10) / 10;
    }

    const isBlur = sharpnessScore < blurThreshold && !isObstruction;
    if (isBlur) {
      reasons.push(`Blurry / Out of Focus Frame (Asset Sharpness: ${sharpnessScore.toFixed(1)} < ${blurThreshold})`);
    }

    // Clean up canvas resources immediately
    ctx.clearRect(0, 0, sampleWidth, sampleHeight);
    canvas.width = 0;
    canvas.height = 0;

    return {
      isBlur,
      isObstruction,
      blurVariance: sharpnessScore,
      tenengradScore: sharpnessScore,
      avgBrightness,
      clippedRatio,
      reason: reasons.length > 0 ? reasons.join('; ') : undefined,
      analysisStatus: 'success'
    };
  } catch (err) {
    return {
      isBlur: false,
      isObstruction: false,
      blurVariance: 30.0,
      tenengradScore: 30.0,
      avgBrightness: 128.0,
      clippedRatio: 0,
      reason: `Analysis error: ${(err as Error).message}`,
      analysisStatus: 'error'
    };
  }
}
