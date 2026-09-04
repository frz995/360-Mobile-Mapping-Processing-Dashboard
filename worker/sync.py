"""Optional Supabase sync — pushes job progress into `processing_jobs` so the
dashboard's single source of truth stays live. Uses the PostgREST endpoint with
the service-role key (worker-side only; never exposed to the browser).

If SUPABASE_URL / service role key are absent the worker runs standalone and the
dashboard polls the HTTP endpoints instead.
"""
from __future__ import annotations

import collections
import logging
import os
import time
from typing import Deque

try:
    import requests  # type: ignore
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

LOGGER = logging.getLogger("nas-worker.sync")


class SupabaseSyncer:
    def __init__(
        self,
        url: str,
        service_role_key: str,
        table: str = "processing_jobs",
        max_retries: int = 3,
        dead_letter_max: int = 100,
    ) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        self.table = table
        self.max_retries = max(1, max_retries)
        self.dead_letter_queue: Deque[dict] = collections.deque(maxlen=dead_letter_max)

    @classmethod
    def from_env(cls) -> "SupabaseSyncer | None":
        url = os.environ.get("SUPABASE_URL", "").strip()
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not (url and key and requests):
            return None
        return cls(url, key)

    def push(self, job_id: str, fields: dict) -> bool:
        """Push status update to Supabase with exponential backoff and dead-letter queue."""
        if not requests:
            self.dead_letter_queue.append({
                "job_id": job_id,
                "fields": fields,
                "error": "requests library not available",
                "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
            })
            return False

        url = f"{self.base}/{self.table}?id=eq.{job_id}"
        payload = {
            **fields,
            "updated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        }

        last_error: str | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                resp = requests.patch(url, headers=self.headers, json=payload, timeout=10)
                if resp.status_code < 400:
                    return True
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                LOGGER.warning(
                    "Supabase sync PATCH %s attempt %d/%d failed: %s",
                    job_id, attempt, self.max_retries, last_error
                )
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                LOGGER.warning(
                    "Supabase sync push %s attempt %d/%d network error: %s",
                    job_id, attempt, self.max_retries, exc
                )

            if attempt < self.max_retries:
                time.sleep(0.2 * (2 ** (attempt - 1)))

        # Exhausted retries -> append to dead-letter queue
        LOGGER.error(
            "Supabase sync permanently failed for job %s after %d attempts. Queued in dead-letter buffer. Error: %s",
            job_id, self.max_retries, last_error
        )
        self.dead_letter_queue.append({
            "job_id": job_id,
            "payload": payload,
            "error": last_error,
            "timestamp": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        })
        return False