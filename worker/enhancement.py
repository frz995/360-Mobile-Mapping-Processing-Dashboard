"""Deterministic batch enhancement — the NAS GPU Worker applies the exact
EnhancementParams designed in the dashboard to every frame.
"""
from __future__ import annotations

import cv2
import numpy as np


def apply_enhancement(img, params: dict) -> np.ndarray:
    """img: BGR numpy array. params mirrors the dashboard EnhancementParams."""
    brightness = float(params.get("brightness", 0)) / 100.0
    exposure = float(params.get("exposure", 0)) / 100.0
    contrast = float(params.get("contrast", 0)) / 100.0
    saturation = float(params.get("saturation", 0)) / 100.0
    sharpen = float(params.get("sharpness", 0)) / 100.0
    denoise = float(params.get("denoise", 0)) / 100.0

    out = img.astype(np.float32)

    # 1) Denoise (light, preserves edges)
    if denoise > 0:
        strength = 1 + 8 * denoise
        denoised = cv2.fastNlMeansDenoisingColored(
            np.clip(out, 0, 255).astype(np.uint8), None,
            h=2.0 + 8 * denoise, hColor=2.0 + 6 * denoise,
            templateWindowSize=7, searchWindowSize=21,
        )
        out = (denoised.astype(np.float32) * (1 - 0.45 * denoise) + out * (0.45 * denoise)).astype(np.float32)

    # 2) Brightness + exposure
    out += (brightness + exposure) * 255.0

    # 3) Contrast around mid-gray (BGR mean percentile keeps color balance)
    factor = 1.0 + contrast
    out = (out - 127.5) * factor + 127.5

    # 4) Saturation (luma-preserving)
    if saturation != 0:
        yuv = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_BGR2YUV).astype(np.float32)
        yuv[:, :, 1] *= 1.0 + saturation
        yuv[:, :, 2] *= 1.0 + saturation
        out = cv2.cvtColor(np.clip(yuv, 0, 255).astype(np.uint8), cv2.COLOR_YUV2BGR).astype(np.float32)

    out = np.clip(out, 0, 255).astype(np.uint8)

    # 5) Unsharp mask
    if sharpen > 0:
        radius = max(1, int(round(4 * sharpen)))
        ksize = (2 * radius + 1, 2 * radius + 1)
        blurred = cv2.GaussianBlur(out, ksize, 0)
        out = cv2.addWeighted(out, 1 + 0.8 * sharpen, blurred, -0.8 * sharpen, 0)

    return out