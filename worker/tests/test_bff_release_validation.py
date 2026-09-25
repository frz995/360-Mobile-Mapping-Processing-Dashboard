import pytest
from fastapi import HTTPException

from bff import app as bff_module


PROJECT_ID = "11111111-1111-4111-8111-111111111111"
RUN_ID = "22222222-2222-4222-8222-222222222222"
ATTEMPT_ID = "33333333-3333-4333-8333-333333333333"


def _body(**overrides):
    body = {
        "project_id": PROJECT_ID,
        "run_id": RUN_ID,
        "attempt_id": ATTEMPT_ID,
        "subgrid": "N93E70",
        "run_code": "N93E70-2026-09-25-R001",
        "capture_date": "2026-09-25",
        "source_folder": "05_Final/N93E70",
        "release_folder": "/DELIVERABLES/N93E70/N93E70-2026-09-25-R001",
    }
    body.update(overrides)
    return body


def _install_rows(monkeypatch, run_overrides=None, attempt_rows=None):
    run = {
        "id": RUN_ID,
        "project_id": PROJECT_ID,
        "subgrid": "N93E70",
        "capture_date": "2026-09-25",
        "run_code": "N93E70-2026-09-25-R001",
        "source_folder": "05_Final/N93E70",
    }
    run.update(run_overrides or {})

    def rows(table, _params):
        if table == "production_runs":
            return [run]
        if table == "production_run_attempts":
            return attempt_rows if attempt_rows is not None else [{
                "id": ATTEMPT_ID,
                "project_id": PROJECT_ID,
                "production_run_id": RUN_ID,
            }]
        return []

    monkeypatch.setattr(bff_module, "_supabase_rows", rows)


def test_validate_release_request_accepts_a_canonical_matching_run(monkeypatch):
    _install_rows(monkeypatch)

    result = bff_module._validate_release_request(_body(source_folder="05_Final/N93E70/"))

    assert result["project_id"] == PROJECT_ID
    assert result["release_folder"] == "/DELIVERABLES/N93E70/N93E70-2026-09-25-R001"


def test_validate_release_request_rejects_a_mismatched_run(monkeypatch):
    _install_rows(monkeypatch, run_overrides={"subgrid": "N93E71"})

    with pytest.raises(HTTPException) as exc:
        bff_module._validate_release_request(_body())

    assert exc.value.status_code == 400
    assert "does not match" in exc.value.detail


def test_validate_release_request_rejects_a_mismatched_source_folder(monkeypatch):
    _install_rows(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        bff_module._validate_release_request(_body(source_folder="05_Final/N93E71"))

    assert exc.value.status_code == 400
    assert "source_folder" in exc.value.detail


def test_validate_release_request_rejects_an_unrelated_attempt(monkeypatch):
    _install_rows(monkeypatch, attempt_rows=[])

    with pytest.raises(HTTPException) as exc:
        bff_module._validate_release_request(_body())

    assert exc.value.status_code == 404
    assert "attempt" in exc.value.detail


def test_validate_release_request_rejects_noncanonical_release_paths():
    with pytest.raises(HTTPException) as exc:
        bff_module._validate_release_request(_body(release_folder="C:/deliverables/N93E70/N93E70-2026-09-25-R001"))

    assert exc.value.status_code == 400
    assert "release_folder" in exc.value.detail


def test_validate_release_request_requires_uuid_identifiers():
    with pytest.raises(HTTPException) as exc:
        bff_module._validate_release_request(_body(run_id="run-1"))

    assert exc.value.status_code == 400
    assert "run_id" in exc.value.detail


def test_resolve_app_role_requires_an_active_account(monkeypatch):
    class Response:
        def __init__(self, rows):
            self.status_code = 200
            self.rows = rows

        def json(self):
            return self.rows

    monkeypatch.setattr(bff_module, "SUPABASE_URL", "https://supabase.test")
    monkeypatch.setattr(bff_module, "SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setattr(bff_module.requests, "get", lambda *args, **kwargs: Response([
        {"role": "Survey Operator", "status": "active"}
    ]))
    assert bff_module._resolve_app_role("operator@example.com") == bff_module.OPERATOR

    monkeypatch.setattr(bff_module.requests, "get", lambda *args, **kwargs: Response([
        {"role": "Survey Operator", "status": "suspended"}
    ]))
    assert bff_module._resolve_app_role("operator@example.com") == bff_module.VIEWER
