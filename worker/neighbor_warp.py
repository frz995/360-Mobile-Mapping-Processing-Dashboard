"""Neighbor-frame real-pixel ground fill (prototype) for MASK jobs.

In a continuous mobile-mapping capture the road that the car currently hides
was already photographed one capture-interval behind. Instead of letting the
generative-fill model hallucinate the whole nadir band, we register the
nearest sibling frames to the current frame and warp their real ground pixels
into the masked region. The output is (filled_image, residual_mask) where the
residual is the deep under-car sliver that still needs the generative-fill:
anything that is not confidently real is deliberately left masked.

Registration is deliberately conservative — a template match must be a clear,
unambiguous peak inside a physically plausible parallax window or the frame is
rejected (falls back to generative-fill over the whole mask). Worst case a
neighbor is unhelpful; it can never paste garbage.

Off by default. Enable per job with settings.mask.useNeighborWarp=true or the
MASK_NEIGHBOR_WARP=1 environment variable.
"""
from __future__ import annotations

import logging
import os
import time

import cv2
import numpy as np

logger = logging.getLogger("nas-worker.neighbor_warp")

_ENABLE_ENV = "MASK_NEIGHBOR_WARP"
_IMG_EXTS = {".jpg", ".jpeg", ".png"}

# Neighbor frames are read at reduced width; registration cost stays low and
# the real-pixel ground patch is rescaled back when it is pasted.
_WORK_W = 2560
_ECC_ITERS = 40
_CAR_TOP_GUARD = 2       # px above the neighbor's own car top that is trusted
_DARK_FILL_FLOOR = 12.0  # luminance floor for accepted source pixels
_PEAK_MIN_SCORE = 0.50   # TM_CCOEFF_NORMED floor for a trusted match
_PEAK_MARGIN = 0.05      # the top score must clearly beat the runner-up


def neighbor_warp_enabled(settings: dict | None) -> bool:
    """Master switch: per-job setting or environment variable."""
    flag = bool((settings or {}).get("mask", {}).get("useNeighborWarp"))
    env = os.environ.get(_ENABLE_ENV, "0").strip().lower()
    return flag or env in {"1", "true", "yes", "on"}


_SIBLING_CACHE: dict[str, tuple[float, list[str]]] = {}
_SIBLING_TTL = 5.0


def _siblings(frame_dir: str | None) -> list[str]:
    """All image siblings in `frame_dir`, cached briefly for batch runs."""
    if not frame_dir:
        return []
    try:
        mtime = os.path.getmtime(frame_dir)
    except OSError:
        return []
    cached = _SIBLING_CACHE.get(frame_dir)
    now = time.monotonic()
    if cached and cached[0] > now - _SIBLING_TTL and cached[1]:
        return cached[1]
    try:
        listing = [
            os.path.join(frame_dir, f)
            for f in sorted(os.listdir(frame_dir))
            if os.path.splitext(f)[1].lower() in _IMG_EXTS
        ]
    except OSError:
        return []
    if listing:
        _SIBLING_CACHE[frame_dir] = (now, listing)
    return listing


def _read(path: str, work_w: int) -> np.ndarray | None:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    if w > work_w:
        s = work_w / float(w)
        img = cv2.resize(
            img, (int(round(work_w)), max(1, int(round(h * s)))),
            interpolation=cv2.INTER_AREA,
        )
    return img


def _bright_run(img: np.ndarray, start_row: int, end_row: int) -> int:
    """Rows of the window (starting at `start_row`) that are definitely
    ground, i.e. not luminance-threshold dark like the car roof. The detector
    starts its scan some rows below the true car top, so the margin between
    the window top and the detected band can still contain car pixels."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    dark = gray <= 18
    count = 0
    for r in range(start_row, end_row):
        if dark[r].mean() >= 0.5:
            break
        count += 1
    return count


def _estimate_transform(
    template: np.ndarray,
    canvas: np.ndarray,
    l0: int,
    t1: int,
) -> np.ndarray | None:
    """Return the 2x3 translation mapping `canvas -> template` or None.

    The template is the pure-ground strip of the window (everything above the
    car band top): it is ground in BOTH frames, so it never contains car
    pixels. The strip is matched against a search region of `canvas` that
    spans only the physically plausible parallax band (diopter positions
    given by `l0`, strip height `t1`). A match is trusted only when its
    normalised correlation is a clear peak over the runner-up, so
    smooth/gradient road can never yield a wrong registration.
    """
    h, w = template.shape[:2]
    if h < 8 or w < 16 or canvas.shape[1] != w:
        return None
    tf = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
    mf = cv2.cvtColor(canvas, cv2.COLOR_BGR2GRAY)
    t1 = max(8, min(int(round(t1)), h))
    if l0 + t1 > canvas.shape[0]:
        return None
    tmpl = tf[0:t1]
    res = cv2.matchTemplate(mf, tmpl, cv2.TM_CCOEFF_NORMED)
    # cv2.minMaxLoc returns (minVal, maxVal, minLoc, maxLoc).
    min_val, max_val, _min_loc, max_loc = cv2.minMaxLoc(res)
    best = float(max_val)
    if best < _PEAK_MIN_SCORE:
        return None
    runner = res.copy()
    bx, by = int(max_loc[0]), int(max_loc[1])
    runner[max(0, by - 1): by + 2, max(0, bx - 1): bx + 2] = -2.0
    second = float(runner.max()) if runner.size else -2.0
    if best - second < _PEAK_MARGIN:
        return None
    lx, ly = bx, by
    if abs(lx) > 0.25 * w:
        return None
    # warpAffine: dst(x,y) reads src(x + M13, y + M23). Template row 0 (the
    # window's ground top) lives at canvas row l0+ly, so dst row t must read
    # canvas row t + (l0+ly).
    dy = float(l0 + ly)
    m = np.array([[1.0, 0.0, -float(lx)], [0.0, 1.0, dy]], np.float32)

    slice_t = tf[0:t1]
    slice_m = mf[l0 + ly: l0 + ly + t1, lx: lx + w]
    if slice_m.shape == slice_t.shape and slice_t.size >= 32 * 32:
        criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, _ECC_ITERS, 1e-4)
        init = np.array([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], np.float32)
        try:
            _cost, refined = cv2.findTransformECC(
                slice_t, slice_m, init, motionType=cv2.MOTION_TRANSLATION, criteria=criteria
            )
            if refined is not None:
                m[0, 2] += float(refined[0, 2])
                m[1, 2] += float(refined[1, 2])
        except cv2.error:
            pass
    return m


def _car_top_row(img: np.ndarray, settings: dict | None) -> int:
    """Neighbor's own detected car band top row (in `img`'s coordinates)."""
    from masking import derive_mask

    m = derive_mask(img, settings or {}) * 255
    ys = np.where(m > 0)[0]
    return int(ys.min()) if ys.size else -1


def neighbor_fill(
    img: np.ndarray,
    mask: np.ndarray,
    frame_dir: str | None = None,
    frame_name: str | None = None,
    settings: dict | None = None,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Fill the masked band of `img` with real ground pixels from the
    previous/next frame.

    Returns (filled_bgr, residual_mask) in full resolution, or (None, None)
    when no usable neighbor is available so the caller falls back to the
    generative-fill model on the whole mask.
    """
    settings = settings or {}
    if frame_dir is None or frame_name is None:
        return None, None

    ys, xs = np.where(mask > 0)
    if ys.size == 0:
        return None, None
    h, w = img.shape[:2]
    my0, my1 = int(ys.min()), int(ys.max()) + 1
    mx0, mx1 = int(xs.min()), int(xs.max()) + 1
    bh = my1 - my0
    win_y0 = max(0, my0 - max(1, int(bh * 0.35)))
    win_y1 = min(h, my1 + max(1, int(bh * 0.10)))
    win_x0 = max(0, mx0 - max(1, int((mx1 - mx0) * 0.10)))
    win_x1 = min(w, mx1 + max(1, int((mx1 - mx0) * 0.10)))
    h_win, w_win = win_y1 - win_y0, win_x1 - win_x0
    if h_win < 24 or w_win < 24:
        return None, None

    siblings = _siblings(frame_dir)
    idx = -1
    if frame_name:
        base = os.path.basename(frame_name)
        for i, p in enumerate(siblings):
            if os.path.basename(p) == base:
                idx = i
                break
    candidates: list[str] = []
    if idx >= 0:
        if idx - 1 >= 0:
            candidates.append(siblings[idx - 1])
        if idx + 1 < len(siblings):
            candidates.append(siblings[idx + 1])
    if not candidates:
        return None, None

    acc_val: np.ndarray | None = None
    acc_cnt: np.ndarray | None = None
    reg_size = 0

    for path in candidates:
        nb = _read(path, _WORK_W)
        if nb is None:
            continue
        nh, nw = nb.shape[:2]
        s_nb = nw / float(w)
        cy0 = int(round(win_y0 * s_nb))
        cy1 = int(round(win_y1 * s_nb))
        cx0 = int(round(win_x0 * s_nb))
        cx1 = int(round(win_x1 * s_nb))
        ch = max(1, cy1 - cy0)
        cw = max(1, cx1 - cx0)
        if ch < 24 or cw < 24:
            continue
        # Only physically plausible parallax is trusted: the neighbor's copy
        # of the window's ground strip may sit up to `maxp` reduced px above/
        # below the window. `pad` just gives the canvas room for that.
        maxp = max(8, int(round(0.12 * ch)))
        pad = max(maxp, int(round(0.40 * bh * s_nb)))
        nwy0 = max(0, cy0 - pad)
        nwy1 = min(nh, cy1 + pad)
        nb_win = nb[nwy0:nwy1, cx0:cx1]

        # Template = the pure-ground strip above the car band top (downscaled
        # rows); the search region must be able to hold it at every plausible
        # parallax position. Clip to the bright run so a car that pokes above
        # the detected band top can never contaminate the match.
        t1_max = max(16, int(round((my0 - win_y0) * s_nb)))
        bright = int(round(_bright_run(img, win_y0, my0) * s_nb))
        if bright < 8:
            continue
        t1 = min(t1_max, bright)
        if t1 + 2 * maxp + 1 > nb_win.shape[0]:
            continue
        l0 = max(0, cy0 - maxp - nwy0)
        search = nb_win[l0: l0 + t1 + 2 * maxp, :]
        resize_w = search.shape[1]
        curr_red = cv2.resize(
            img[win_y0:win_y1, win_x0:win_x1], (resize_w, ch), interpolation=cv2.INTER_AREA
        )
        m = _estimate_transform(curr_red, search, l0, t1)
        if m is None:
            continue
        warped = cv2.warpAffine(
            nb_win, m, (cw, ch),
            flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0,
        )
        band_top = _car_top_row(nb, settings)
        if band_top < 0:
            continue
        # Source neighborhood-coordinates of each warped output pixel:
        # dst(x,y) reads nb_win(x + M13, y + M23) which is neighbourhood
        # column x + M13 + cx0 and row y + M23 + nwy0.
        yy, xx = np.mgrid[0:ch, 0:cw].astype(np.float32)
        sx = xx + m[0, 2] + cx0
        sy = yy + m[1, 2] + nwy0
        in_bounds = (sx >= 0) & (sx < nw) & (sy >= 0) & (sy < nh)
        not_home = sy < (band_top - _CAR_TOP_GUARD)
        lum = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        valid = in_bounds & not_home & (lum >= _DARK_FILL_FLOOR)

        if acc_val is None:
            reg_size = (ch, cw)
            acc_val = np.zeros((ch, cw, 3), np.float32)
            acc_cnt = np.zeros((ch, cw), np.float32)
        if (ch, cw) != reg_size:
            continue
        acc_val += warped.astype(np.float32) * valid[..., None].astype(np.float32)
        acc_cnt += valid.astype(np.float32)

    if acc_val is None or acc_cnt is None or (acc_cnt > 0).sum() == 0:
        return None, None

    kept = acc_cnt > 0
    mix = acc_val / np.maximum(acc_cnt[..., None], 1.0)
    patch = cv2.resize(mix, (w_win, h_win), interpolation=cv2.INTER_LANCZOS4)
    alpha = (
        cv2.resize((kept.astype(np.uint8) * 255), (w_win, h_win),
                   interpolation=cv2.INTER_NEAREST)
        > 0
    )

    filled = img.copy()
    region = filled[win_y0:win_y1, win_x0:win_x1]
    alpha = alpha & (mask[win_y0:win_y1, win_x0:win_x1] > 0)
    region[alpha] = patch[alpha]

    # The confidently-real interior replaces the mask; the 1px rim plus the
    # deep under-car sliver stay masked for the generative-fill refinement.
    strong = np.zeros_like(mask, np.uint8)
    strong[win_y0:win_y1, win_x0:win_x1] = alpha.astype(np.uint8)
    strong = cv2.erode(strong, np.ones((3, 3), np.uint8))
    residual = (mask > 0) & (strong == 0)
    return filled, (residual.astype(np.uint8) * 255)