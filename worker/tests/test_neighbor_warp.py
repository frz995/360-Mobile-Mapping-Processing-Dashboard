"""Neighbor-frame real-pixel ground fill tests (MASK pipeline prototype).

A synthetic rig simulates a street-moving camera: the ground is a textured
ramp (distinct speckle per world row) that shifts by `MOVE` world rows between
adjacent frames, and the car band is a black full-width slab. The neighbor
frames therefore contain real pixels for a sliver of road under the current
car's mask; the warp must transport them in and the residual must keep the
never-seen deep part masked for the generative-fill stage.
"""
from __future__ import annotations

import os

import cv2
import numpy as np
import pytest

from masking import apply_mask_pipeline
from neighbor_warp import neighbor_fill, neighbor_warp_enabled

H, W = 200, 320
T = 120          # true car band top (rows T..H are black in every frame)
MOVE = 11        # world rows per capture interval (inside the parallax band)

_RNG = np.random.default_rng(7)
_BASE = np.clip(40 + np.arange(H, dtype=np.float32)[:, None] * 0.6, 0, 180)
_GUTTERS = np.where((np.arange(W) // 16) % 2 == 0, 16, 0)
_SPECKLE = _RNG.integers(-18, 19, size=(H + 32, W)).astype(np.float32)
_WORLD = np.clip(_BASE + _GUTTERS, 0, 255)


def _frame(off: int) -> np.ndarray:
    im = np.empty((H, W, 3), np.uint8)
    for r in range(H):
        sr = r + off
        if 0 <= sr < H:
            v = np.clip(_WORLD[sr] + _SPECKLE[sr], 0, 255)
        else:
            v = 0
        im[r, :, 0] = im[r, :, 1] = im[r, :, 2] = v
    im[T:] = 0
    return im


@pytest.fixture()
def rig(tmp_path) -> tuple[str, np.ndarray, np.ndarray]:
    cv2.imwrite(str(tmp_path / "frame_0.jpg"), _frame(MOVE))
    cv2.imwrite(str(tmp_path / "frame_1.jpg"), _frame(0))
    cv2.imwrite(str(tmp_path / "frame_2.jpg"), _frame(-MOVE))
    cur = _frame(0)
    mask = np.zeros((H, W), np.uint8)
    mask[130:] = 255  # detector-consistent derived band (starts below car top)
    return str(tmp_path), cur, mask


def _band_stats(band: np.ndarray) -> dict:
    rows = (band > 30).any(axis=2).sum(axis=1)
    where = np.where(rows > 0)[0]
    return {"first": int(where.min()) if where.size else -1,
            "n": int((rows > 0).sum()),
            "mean": float(band.mean())}


def test_neighbor_warp_enabled_switches():
    assert neighbor_warp_enabled({"mask": {"useNeighborWarp": True}}) is True
    assert neighbor_warp_enabled({"mask": {}}) is False
    assert neighbor_warp_enabled(None) is False


def test_fills_mask_top_sliver_with_real_pixels(rig):
    d, cur, mask = rig
    filled, residual = neighbor_fill(cur, mask, d, "frame_1.jpg",
                                     {"mask": {"useNeighborWarp": True}})
    assert filled is not None and residual is not None
    stats = _band_stats(filled[130:])
    assert stats["first"] >= 0
    assert stats["n"] >= 3          # a few real rows parked into the band top
    # the sliver itself is genuinely bright (real ground, not black)
    assert float(filled[130:142].mean()) > 30
    # residual must stay smaller than the full mask (deep sliver is kept)
    assert residual.sum() < mask.sum()
    # interior of the filled band must be well above the dark floor at the top
    assert float(filled[132:136].mean()) > 30


def test_residual_keeps_deep_never_seen_rows_masked(rig):
    d, cur, mask = rig
    filled, residual = neighbor_fill(cur, mask, d, "frame_1.jpg", {"mask": {}})
    assert filled is not None
    deep = residual[185:]
    assert deep.any()  # bottom rows were never photographed -> stay masked


def test_no_sibling_frames_returns_none(rig, tmp_path):
    d, cur, mask = rig
    solo = tmp_path / "solo"
    solo.mkdir()
    cv2.imwrite(str(solo / "frame_5.jpg"), _frame(0))
    got = neighbor_fill(cur, mask, str(solo), "frame_5.jpg", {"mask": {}})
    assert got == (None, None)
    got_none = neighbor_fill(cur, mask)
    assert got_none == (None, None)
    got_passthrough = neighbor_fill(cur, mask, d, "missing.jpg", {"mask": {}})
    assert got_passthrough == (None, None)


def test_apply_mask_pipeline_gates_neighbor_warp(rig, monkeypatch):
    d, cur, mask = rig
    calls = {"n": 0}

    def spy(img, mask, frame_dir=None, frame_name=None, settings=None):
        calls["n"] += 1
        return None, None

    monkeypatch.setattr("masking.neighbor_fill", spy)
    out = apply_mask_pipeline(cur.copy(), {"mask": {}}, frame_dir=d, frame_name="frame_1.jpg")
    assert calls["n"] == 0           # flag off -> warp never invoked
    assert out.shape == cur.shape
    out2 = apply_mask_pipeline(cur.copy(), {"mask": {"useNeighborWarp": True}},
                               frame_dir=d, frame_name="frame_1.jpg")
    assert calls["n"] == 1           # flag on -> warp invoked, fell back to TELEA


def test_e2e_pipeline_band_is_brighter_with_neighbor_warp(rig):
    d, cur, _mask = rig
    plain = apply_mask_pipeline(cur.copy(), {"mask": {}}, frame_dir=d, frame_name="frame_1.jpg")
    fused = apply_mask_pipeline(cur.copy(), {"mask": {"useNeighborWarp": True}},
                                frame_dir=d, frame_name="frame_1.jpg")
    b_plain = _band_stats(plain[130:])
    b_fused = _band_stats(fused[130:])
    assert b_fused["mean"] > b_plain["mean"]
    assert b_fused["mean"] > 30