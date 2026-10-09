import os
import shutil
from unittest.mock import patch
import pytest

# Ensure STATION_ID is set for import
os.environ.setdefault("STATION_ID", "stitch")
os.environ.setdefault("WATCH_ROOT", "C:\\temp")

from app import _build_cli, SyncBucketRequest


def test_build_cli_requires_subgrid(tmp_path):
    req = SyncBucketRequest(provider="r2", stage_dir="DELIVERABLES", subgrid="")
    with pytest.raises(ValueError, match="subgrid is required"):
        _build_cli(req, str(tmp_path))


def test_build_cli_unsupported_provider(tmp_path):
    req = SyncBucketRequest(provider="unknown_cloud", stage_dir="DELIVERABLES", subgrid="N93E70")
    with pytest.raises(ValueError, match="Unsupported provider"):
        _build_cli(req, str(tmp_path))


@patch("shutil.which")
def test_build_cli_no_shell_operators_in_argv(mock_which, tmp_path):
    """Verify that '&&' is never placed in argv for any provider, preventing subprocess errors."""
    mock_which.side_effect = lambda bin_name: f"/usr/bin/{bin_name}"

    # Create dummy manifest.json
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text("{}", encoding="utf-8")

    providers = ["r2", "s3", "wasabi", "gcs", "azure", "supabase_cli", "nas_local"]

    for provider in providers:
        req = SyncBucketRequest(
            provider=provider,
            stage_dir="DELIVERABLES/N93E70",
            subgrid="N93E70",
            bucket="test-bucket",
            include_manifest=True,
        )
        steps, desc = _build_cli(req, str(tmp_path))

        assert len(steps) >= 1
        for argv, step_desc in steps:
            assert isinstance(argv, list)
            # Critical assertion: "&&" must never appear as a command argument
            assert "&&" not in argv, f"Provider {provider} still contains '&&' in argv: {argv}"
            assert len(argv) > 0
            assert isinstance(step_desc, str)


@patch("shutil.which")
def test_build_cli_s3_multi_step_manifest(mock_which, tmp_path):
    mock_which.side_effect = lambda bin_name: f"/mock/{bin_name}"
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text("{}", encoding="utf-8")

    req = SyncBucketRequest(
        provider="s3",
        stage_dir="DELIVERABLES/N93E70",
        subgrid="N93E70",
        bucket="my-mms-bucket",
        region="ap-southeast-1",
        include_manifest=True,
    )
    steps, desc = _build_cli(req, str(tmp_path))

    assert len(steps) == 2
    # Step 1: sync dataset
    assert steps[0][0][0] == "/mock/aws"
    assert steps[0][0][1:3] == ["s3", "sync"]
    assert "s3://my-mms-bucket/N93E70/" in steps[0][0]

    # Step 2: copy manifest
    assert steps[1][0][0] == "/mock/aws"
    assert steps[1][0][1:3] == ["s3", "cp"]
    assert "s3://my-mms-bucket/manifest.json" in steps[1][0]
    assert "&&" not in steps[0][0]
    assert "&&" not in steps[1][0]


@patch("shutil.which")
def test_build_cli_without_manifest_flag(mock_which, tmp_path):
    mock_which.side_effect = lambda bin_name: f"/mock/{bin_name}"
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text("{}", encoding="utf-8")

    req = SyncBucketRequest(
        provider="s3",
        stage_dir="DELIVERABLES/N93E70",
        subgrid="N93E70",
        bucket="my-mms-bucket",
        include_manifest=False,
    )
    steps, desc = _build_cli(req, str(tmp_path))

    # When include_manifest is False, only 1 step should be generated
    assert len(steps) == 1
    assert "manifest.json" not in steps[0][0]
