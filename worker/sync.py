"""Optional Supabase sync — pushes job progress into `processing_jobs` so the
dashboard's single source of truth stays live. Uses the PostgREST endpoint with
the service-role key (worker-side only; never exposed to the browser).

If SUPABASE_URL / service role key are absent the worker runs standalone and the
dashboard polls the HTTP endpoints instead.
"""
from __future__ import annotations

import logging
import os

try:
    import requests  # type: ignore
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

LOGGER = logging.getLogger("nas-worker.sync")


class SupabaseSyncer:
    def __init__(self, url: str, service_role_key: str, table: str = "processing_jobs") -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        self.table = table

    @classmethod
    def from_env(cls) -> "SupabaseSyncer | None":
        url = os.environ.get("SUPABASE_URL", "").strip()
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not (url and key and requests):
            return None
        return cls(url, key)

    def push(self, job_id: str, fields: dict) -> None:
        try:
            url = f"{self.base}/{self.table}?id=eq.{job_id}"
            payload = {
                **fields,
                "updated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            }
            resp = requests.patch(url, headers=self.headers, json=payload, timeout=10)
            if resp.status_code >= 400:
                LOGGER.warning("Supabase sync PATCH %s -> HTTP %s: %s", job_id, resp.status_code, resp.text[:300])
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning("Supabase sync push failed: %s", exc)