# =====================================================================
# GeoSphere 360 — Backend-For-Frontend (BFF) gateway (Stream A2)
#
# A thin FastAPI service that sits in front of the NAS GPU Worker and the
# Supabase REST API. It:
#   1. Verifies the caller's Supabase access token via Supabase Auth
#      (/auth/v1/user) so the browser never talks to the worker directly.
#   2. Resolves the caller's APPLICATION role from `user_accounts` (using
#      the service-role key, which bypasses client RLS by design).
#   3. Enforces capabilities per route (mirrors sec.can() / A1).
#   4. Proxies the worker routes to the NAS GPU Worker, injecting the
#      worker shared token server-side (never exposed to the browser).
#
# Route-compatible with the worker's /api/* contract, so the dashboard's
# ProductionApiClient only needs its `baseUrl` pointed here (see
# VITE_API_MODE / docs/ENV.md). Additive: the existing worker is untouched.
#
# Run:  uvicorn bff.app:app --host 0.0.0.0 --port 9000
# =====================================================================
from __future__ import annotations

import logging
import os
from typing import Optional

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("bff")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
WORKER_BASE_URL = os.environ.get("WORKER_BASE_URL", "http://localhost:8000").rstrip("/")
WORKER_TOKEN = os.environ.get("NAS_WORKER_TOKEN", "")
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("BFF_ALLOWED_ORIGINS", "").split(",") if o.strip()]

app = FastAPI(title="GeoSphere 360 BFF Gateway", version="1.0.0")

if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )


# ---------------------------------------------------------------------
# Role / capability resolution (mirrors src/lib/authz.ts + sec.can())
# ---------------------------------------------------------------------
ADMIN = "Administrator"
OPERATOR = "Survey Operator"
INSPECTOR = "QA Inspector"
VIEWER = "Viewer"

_NORMALIZE = {
    "administrator": ADMIN, "admin": ADMIN,
    "survey operator": OPERATOR, "operator": OPERATOR,
    "qa inspector": INSPECTOR, "inspector": INSPECTOR, "qa officer": INSPECTOR,
    "viewer": VIEWER, "guest": VIEWER,
}


def _normalize_role(raw: Optional[str]) -> str:
    return _NORMALIZE.get((raw or "").strip().lower(), VIEWER)


def _role_can(role: str, capability: str) -> bool:
    if role == ADMIN:
        return True
    if role == OPERATOR:
        return capability in ("deleteData", "runQaqc", "viewAll")
    if role == INSPECTOR:
        return capability in ("runQaqc", "reviewQaqc", "viewAll")
    return capability == "viewAll"


class AuthContext:
    __slots__ = ("email", "role")

    def __init__(self, email: str, role: str) -> None:
        self.email = email
        self.role = role


def _verify_supabase_token(token: str) -> dict:
    """Validate the caller's Supabase access token and return the user dict."""
    if not token:
        raise HTTPException(status_code=401, detail="Missing Authorization token.")
    resp = requests.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={"Authorization": f"Bearer {token}", "apikey": token},
        timeout=10,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")
    data = resp.json()
    email = data.get("email") or ""
    # The JWT `role` claim is a Supabase auth role (authenticated/anon), not our
    # app role; use it only as a fallback pre-check but resolve app role below.
    return {"email": email, "id": data.get("id", ""), "auth_role": data.get("role", "")}


def _resolve_app_role(email: str) -> str:
    """Authoritative app role from user_accounts via the service-role key."""
    if not (SERVICE_ROLE_KEY and SUPABASE_URL):
        return VIEWER  # cannot resolve -> narrowest (read-only) default
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/user_accounts",
            params={"select": "role", "email": f"eq.{email}"},
            headers={
                "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
                "apikey": SERVICE_ROLE_KEY,
            },
            timeout=10,
        )
        if resp.status_code == 200:
            rows = resp.json()
            if rows and "role" in rows[0]:
                return _normalize_role(rows[0]["role"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("role lookup failed for %s: %s", email, exc)
    return VIEWER


def _authenticate(request: Request) -> AuthContext:
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip() if auth else ""
    user = _verify_supabase_token(token)
    role = _resolve_app_role(user["email"])
    return AuthContext(email=user["email"], role=role)


def _require(capability: str) -> AuthContext:
    def dependency(request: Request) -> AuthContext:
        ctx = _authenticate(request)
        if not _role_can(ctx.role, capability):
            raise HTTPException(status_code=403, detail=f"Forbidden: requires '{capability}'.")
        return ctx

    return dependency


# ---------------------------------------------------------------------
# Proxy helpers
# ---------------------------------------------------------------------
def _worker_headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if WORKER_TOKEN:
        headers["Authorization"] = f"Bearer {WORKER_TOKEN}"
    return headers


def _proxy(path: str, method: str = "GET", body: Optional[dict] = None):
    try:
        resp = requests.request(
            method, f"{WORKER_BASE_URL}{path}",
            json=body if body is not None else None,
            headers=_worker_headers(),
            timeout=30,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Worker unreachable: {exc}")
    try:
        data = resp.json()
    except ValueError:
        data = {"status": resp.status_code}
    if resp.status_code >= 400:
        raise HTTPException(
            status_code=resp.status_code,
            detail=data.get("detail") if isinstance(data, dict) else str(data),
        )
    return data


# ---------------------------------------------------------------------
# Routes (identical contract to the NAS GPU Worker)
# ---------------------------------------------------------------------
@app.get("/health")
def health():
    return {"status": "ok", "gateway": True, "worker": WORKER_BASE_URL}


@app.post("/api/jobs", dependencies=[Depends(_require("runQaqc"))])
async def submit_job(request: Request):
    body = await request.json()
    return _proxy("/api/jobs", "POST", body)


@app.get("/api/jobs/{job_id}", dependencies=[Depends(_require("viewAll"))])
def get_job(job_id: str):
    return _proxy(f"/api/jobs/{job_id}")


@app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(_require("runQaqc"))])
def cancel_job(job_id: str):
    # FIX: the worker's own /cancel was unauthenticated (_guard(None)).
    # Here every cancel requires an authorized operator/admin token AND the
    # worker token is injected by the gateway, never the browser.
    return _proxy(f"/api/jobs/{job_id}/cancel", "POST")


@app.get("/api/folders", dependencies=[Depends(_require("viewAll"))])
def list_folders(path: str = ""):
    return _proxy(f"/api/folders?path={requests.utils.quote(path or '')}")


@app.get("/api/storage", dependencies=[Depends(_require("viewAll"))])
def storage_info():
    return _proxy("/api/storage")
