"""Car-roof / black-mask removal with generative-fill (LaMa) on the NAS GPU Worker.

Primary engine: LaMa (via `simple-lama-inpainting` or `lama-cleaner`) for clean,
context-aware large-mask fills. If the LaMa backend is unavailable (dev box without
GPU / models), falls back to OpenCV TELEA inpainting marked as preview-grade so the
pipeline still runs end-to-end.

Never touches the source image; always writes to the output folder.
"""
from __future__ import annotations

import logging
import os

import cv2
import numpy as np

logger = logging.getLogger("nas-worker.masking")


def derive_mask(img, settings: dict) -> np.ndarray:
    """Produce a binary mask (255 = inpaint region) for the stitch-method
    car-roof / black-mask footprint.

    - If settings.mask.maskB64 present: decode that mask override.
    - If detectAutomatically (default): luminance-threshold the bottom band,
      exactly mirroring the dashboard detector so results are reproducible.
    - Else: fill a straight band using settings.mask.bottomBandHeight.
    """
    h, w = img.shape[:2]
    mask_cfg = (settings.get("mask") or {})

    # 1) Explicit mask image override (annotated in dashboard).
    b64 = mask_cfg.get("maskB64")
    if b64:
        try:
            import base64
            raw = base64.b64decode(b64.split(",")[-1])
            arr = np.frombuffer(raw, np.uint8)
            decoded = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
            if decoded is not None:
                return cv2.resize(decoded, (w, h)) > 127
        except Exception as exc:  # noqa: BLE001
            logger.warning("maskB64 decode failed, falling back to auto-detect: %s", exc)

    band_frac = float(mask_cfg.get("bottomBandHeight", 0.18) or 0.18)
    detect = bool(mask_cfg.get("detectAutomatically", True))

    if detect:
        # Scan bottom region, same threshold family as the dashboard detector.
        scan_bottom = 0.35
        start = int(h * (1 - scan_bottom))
        gray = cv2.cvtColor(img[start:], cv2.COLOR_BGR2GRAY)
        dark = gray <= 18
        row_ratio = dark.mean(axis=1)  # fraction of dark pixels per row
        # Contiguous solid rows anchored at the bottom.
        solid = 0
        for ratio in reversed(row_ratio):
            if ratio >= 0.65:
                solid += 1
            else:
                break
        if solid >= max(1, int(row_ratio.shape[0] * 0.05)):
            band_h = max(1, int(round((solid / row_ratio.shape[0]) * scan_bottom * h)))
        else:
            band_h = max(1, int(round(band_frac * h)))
    else:
        band_h = max(1, int(round(band_frac * h)))

    mask = np.zeros((h, w), np.uint8)
    mask[h - band_h:, :] = 255
    return mask


def _lama_backend() -> tuple:
    """Return (callable, description) for the strongest installed backend."""
    try:
        from simple_lama_inpainting import SimpleLama  # type: ignore

        logger.info("LaMa backend: simple-lama-inpainting (CUDA-capable)")
        return SimpleLama(), "lama"
    except ImportError:
        pass
    try:
        from lama_cleaner.model_manager import ModelManager  # type: ignore  # noqa: F401

        logger.info("LaMa backend: lama-cleaner available")
        # lama-cleaner spins its own runtime; using it fully is out of scope here.
    except ImportError:
        pass
    return None, "opencv-fallback"


_MASK_CACHE: dict = {}


def apply_mask_pipeline(img: np.ndarray, settings: dict) -> np.ndarray:
    """Apply generative-fill to the derived mask region; return the inpainted image."""
    mask = derive_mask(img, settings) * 255
    if not mask.any():
        return img

    backend, name = _lama_backend()
    if name == "lama" and backend is not None:
        try:
            # simple-lama operates on RGB.
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            filled = backend(rgb, mask)
            return cv2.cvtColor(np.asarray(filled), cv2.COLOR_RGB2BGR)
        except Exception as exc:  # noqa: BLE001
            logger.warning("LaMa inference failed (%s) — falling back to TELEA.", exc)

    logger.info("Using OpenCV TELEA inpaint (preview-grade). Install simple-lama-inpainting for production generative-fill.")
    return cv2.inpaint(img, mask, 3, cv2.INPAINT_TELEA)


def run_external_models() -> None:
    """Download/prepare model weights once (see scripts/download_models.py)."""
    if os.getenv("LAZY_MODEL_DOWNLOAD", "0") == "1":
        from simple_lama_inpainting import SimpleLama  # nosec (validated import)
        SimpleLama()


run_external_models.__doc__ = "Download model weights on first successful import."