"""Privacy blur (faces + license plates) — the NAS GPU Worker's native BLUR job.

Mirrors the real 'Privacy Keeper' behaviour: detect faces (and optionally license
plates) with OpenCV cascades, then Gaussian-blur each detection box so pedestrians
and vehicle plates are unreadable before stitching.

Never touches the source image; always writes to the output folder.
If no detector is available (missing cascade file) or nothing is detected, it falls
back to a configurable full-frame Gaussian blur so the pipeline never stalls.
"""
from __future__ import annotations

import logging
import os

import cv2
import numpy as np

logger = logging.getLogger("nas-worker.blur")

# Cascade search order: explicit setting path, worker-local data dir, then the
# OpenCV package data directory bundled with cv2.
_FACE_CASCADE_NAMES = (
    "haarcascade_frontalface_default.xml",
    "haarcascade_frontalface_alt.xml",
)

_PLATE_CASCADE_NAMES = (
    "haarcascade_russian_plate_number.xml",
    "haarcascade_licence_plate_russian.xml",
)


def _cascade_path(config: dict, kind: str, candidates) -> str | None:
    """Resolve the first existing cascade file path for the given kind."""
    explicit = config.get(f"{kind}CascadePath")
    if explicit and os.path.isfile(explicit):
        return explicit

    search_dirs = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "cascades"),
    ]
    cv2_data = os.path.join(os.path.dirname(cv2.__file__), "data")
    if cv2_data not in search_dirs:
        search_dirs.append(cv2_data)

    for name in candidates:
        for base in search_dirs:
            p = os.path.join(base, name)
            if os.path.isfile(p):
                return p
    return None


def _default_blur_strength(img: np.ndarray) -> int:
    """Scale a sensible Gaussian kernel to the image width."""
    return max(15, int(round(img.shape[1] * 0.01)) // 2 * 2 + 1)


def apply_privacy_blur(img, settings: dict) -> np.ndarray:
    """img: BGR numpy array. settings mirrors the dashboard ProductionJobSettings.blur.

    Strategy:
      1. Detect faces (required) via Haar cascade -> Gaussian blur each box.
      2. Detect plates (only if detectPlates + a plate cascade exists) -> same blur.
      3. If nothing was detected and fullFrameBlur > 0, Gaussian-blur the whole frame.
    """
    blur_cfg = settings or {}
    detect_faces = bool(blur_cfg.get("detectFaces", True))
    detect_plates = bool(blur_cfg.get("detectPlates", False))
    strength = int(blur_cfg.get("blurStrength", 8) or 8)
    box_margin = int(blur_cfg.get("boxMargin", 6) or 6)
    full_frame = int(blur_cfg.get("fullFrameBlur", 0) or 0)

    def _kernel(s: int) -> int:
        s = max(1, s)
        k = s if s % 2 == 1 else s + 1
        return k

    def _gauss(region: np.ndarray, s: int) -> np.ndarray:
        return cv2.GaussianBlur(region, (_kernel(s), _kernel(s)), 0)

    blurred_any = False
    out = img

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    if detect_faces:
        face_path = _cascade_path(blur_cfg, "face", _FACE_CASCADE_NAMES)
        if face_path:
            try:
                cascade = cv2.CascadeClassifier(face_path)
                faces = cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40)
                )
                if len(faces):
                    out = img.copy() if blurred_any else img
                    for (x, y, fw, fh) in faces:
                        x0, y0 = max(0, x - box_margin), max(0, y - box_margin)
                        x1 = min(w, x + fw + box_margin)
                        y1 = min(h, y + fh + box_margin)
                        out[y0:y1, x0:x1] = _gauss(out[y0:y1, x0:x1], strength)
                        blurred_any = True
            except Exception as exc:  # noqa: BLE001
                logger.warning("Face cascade blur failed (%s); continuing.", exc)
        else:
            logger.info("No face cascade found; skipping face detection.")

    if detect_plates:
        plate_path = _cascade_path(blur_cfg, "plate", _PLATE_CASCADE_NAMES)
        if plate_path:
            try:
                plate_cascade = cv2.CascadeClassifier(plate_path)
                plates = plate_cascade.detectMultiScale(
                    gray, scaleFactor=1.1, minNeighbors=4, minSize=(24, 24)
                )
                if len(plates):
                    out = img.copy() if not blurred_any else out
                    for (x, y, fw, fh) in plates:
                        x0, y0 = max(0, x - box_margin), max(0, y - box_margin)
                        x1 = min(w, x + fw + box_margin)
                        y1 = min(h, y + fh + box_margin)
                        out[y0:y1, x0:x1] = _gauss(out[y0:y1, x0:x1], strength)
                        blurred_any = True
            except Exception as exc:  # noqa: BLE001
                logger.warning("Plate cascade blur failed (%s); continuing.", exc)
        else:
            logger.info("Plate detection enabled but no plate cascade found.")

    if not blurred_any:
        if full_frame > 0:
            logger.info("No detections; applying full-frame blur (strength=%s).", full_frame)
            out = _gauss(img, full_frame)
        else:
            logger.info("No detections and fullFrameBlur=0; returning original.")

    return out
