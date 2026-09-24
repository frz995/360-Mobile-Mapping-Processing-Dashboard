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

from neighbor_warp import neighbor_fill, neighbor_warp_enabled

logger = logging.getLogger("nas-worker.masking")

# Keep the ~200MB big-lama checkpoint off the (often full) system drive.
os.environ.setdefault("TORCH_HOME", r"D:\model-cache\torch")

# LaMa inference is region-limited (mask bbox + margin) so a 5.7K panorama
# fits in a 4GB GPU. Crops longer than this are downscaled for inference
# and the filled result is blended back at native resolution.
_LAMA_MAX_SIDE = 2048
_LAMA_MARGIN_FRAC = 0.25


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


def _inpaint_lama(img: np.ndarray, mask: np.ndarray, backend) -> np.ndarray:
    """Region-limited LaMa inference: run the model only on the mask's
    bounding box (+ margin), downscaling oversized crops, and feather-blend
    the filled pixels back into the full-resolution frame. Fits small GPUs
    and keeps context tight for clean texture reconstruction."""
    h, w = img.shape[:2]
    ys, xs = np.where(mask > 0)
    if ys.size == 0:
        return img
    my0, my1 = int(ys.min()), int(ys.max()) + 1
    mx0, mx1 = int(xs.min()), int(xs.max()) + 1
    m = int(round(max(my1 - my0, mx1 - mx0) * _LAMA_MARGIN_FRAC))
    cy0, cy1 = max(0, my0 - m), min(h, my1 + m)
    cx0, cx1 = max(0, mx0 - m), min(w, mx1 + m)

    crop = img[cy0:cy1, cx0:cx1].copy()
    cmask = (mask[cy0:cy1, cx0:cx1] > 0).astype(np.uint8) * 255
    ch, cw = crop.shape[:2]

    scale = 1.0
    if max(ch, cw) > _LAMA_MAX_SIDE:
        scale = _LAMA_MAX_SIDE / float(max(ch, cw))
    if scale < 1.0:
        small = cv2.resize(crop, (max(1, int(round(cw * scale))), max(1, int(round(ch * scale))),), interpolation=cv2.INTER_AREA)
        smask = cv2.resize(cmask, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_NEAREST)
    else:
        small, smask = crop, cmask

    # simple-lama operates on RGB and pads to modulo 8 internally.
    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    filled = backend(rgb, smask)
    filled = cv2.cvtColor(np.asarray(filled), cv2.COLOR_RGB2BGR)
    if filled.shape[:2] != (small.shape[0], small.shape[1]):
        filled = cv2.resize(filled, (small.shape[1], small.shape[0]), interpolation=cv2.INTER_LANCZOS4)

    if scale < 1.0:
        filled = cv2.resize(filled, (cw, ch), interpolation=cv2.INTER_LANCZOS4)

    # Feathered paste: only masked (dilated+blurred) pixels take LaMa output.
    keep = cv2.dilate(cmask, np.ones((9, 9), np.uint8), iterations=1)
    keep = cv2.GaussianBlur(keep, (31, 31), 0).astype(np.float32) / 255.0
    keep = keep[..., None]
    crop_out = crop.astype(np.float32) * (1 - keep) + filled.astype(np.float32) * keep
    img[cy0:cy1, cx0:cx1] = np.clip(crop_out, 0, 255).astype(np.uint8)
    return img


def apply_mask_pipeline(img: np.ndarray, settings: dict, frame_dir: str | None = None, frame_name: str | None = None) -> np.ndarray:
    """Apply generative-fill to the derived mask region; return the inpainted image.

    When the neighbor-warp step is enabled (settings.mask.useNeighborWarp or
    MASK_NEIGHBOR_WARP=1) and a usable sibling frame exists, real ground pixels
    from the previous/next capture fill the masked band first and the
    generative-fill model only cleans the residual under-car sliver.
    """
    mask = derive_mask(img, settings) * 255
    if not mask.any():
        return img

    work, residual, used_neighbor = img, mask, False
    if neighbor_warp_enabled(settings):
        try:
            filled, nb_residual = neighbor_fill(
                img, mask, frame_dir=frame_dir, frame_name=frame_name, settings=settings
            )
            if filled is not None:
                work, residual, used_neighbor = filled, nb_residual, True
        except Exception as exc:  # noqa: BLE001
            logger.warning("neighbor warp failed (%s) — falling back to generative-fill only.", exc)

    backend, name = _lama_backend()
    if name == "lama" and backend is not None:
        try:
            return _inpaint_lama(work, residual, backend)
        except Exception as exc:  # noqa: BLE001
            logger.warning("LaMa inference failed (%s) — falling back to TELEA.", exc)

    logger.info("Using OpenCV TELEA inpaint (preview-grade). Install simple-lama-inpainting for production generative-fill.")
    return cv2.inpaint(work, residual, 3, cv2.INPAINT_TELEA)


def run_external_models() -> None:
    """Download/prepare model weights once (see scripts/download_models.py)."""
    if os.getenv("LAZY_MODEL_DOWNLOAD", "0") == "1":
        from simple_lama_inpainting import SimpleLama  # nosec (validated import)
        SimpleLama()


run_external_models.__doc__ = "Download model weights on first successful import."