"""Download LaMa weights ahead of time so first batch doesn't stall.
Run: python scripts/download_models.py
Requires simple-lama-inpainting installed (see requirements.txt).
"""
from __future__ import annotations

import sys


def main() -> int:
    if sys.platform == "win32":
        print("Note: Windows binaries for lama weights can be big; ensure the GPU box has disk+VRAM.")
    try:
        from simple_lama_inpainting.simple_lama import SimpleLama

        SimpleLama()
        print("LaMa weights loaded / cached successfully.")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to load LaMa: {exc}")
        print("Install with: pip install simple-lama-inpainting  (CUDA-capable on the GPU box)")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())