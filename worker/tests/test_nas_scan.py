from __future__ import annotations

from nas_scan import scan_nas


def _write_csv(path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def test_scan_actions_use_worker_nas_root_and_metadata_names(tmp_path):
    base = tmp_path / "nas"
    sg = "N93E70"
    run = "BP_20220630"
    pano = base / "03_Stitching" / "Project-OUT" / "Grid 1" / sg / run / "panoramas"
    final = base / "05_Final" / "Project-OUT" / "Grid 1" / sg / "20220904"
    metadata = base / "01_Metadata" / "Grid 1" / sg / run / f"{run}.csv"
    raw_run = base / "00_Raw_data" / "Grid 1" / sg / "20220904"
    pano.mkdir(parents=True)
    final.mkdir(parents=True)
    raw_run.mkdir(parents=True)
    (pano / "003485-20220630-170708-000000001.jpg").write_bytes(b"pano-1")
    (pano / "003485-20220630-170708-000000002.jpg").write_bytes(b"pano-2")
    (final / "N93E70-0001.jpg").write_bytes(b"final")
    _write_csv(
        metadata,
        "filename,latitude,longitude,heading,date,time,distancetoprevious\n"
        "N93E70-0093.jpg,2.5,102.7,195.7,30/6/2022,06:54.6,0\n"
        "N93E70-0094.jpg,2.6,102.8,197.6,30/6/2022,06:55.0,0.948\n",
    )

    subgrids = scan_nas(str(base), "subgrids")
    assert [s["code"] for s in subgrids["subgrids"]] == [sg]
    assert subgrids["subgrids"][0]["existsInStitching"] is True

    folders = scan_nas(str(base), "survey-folders", sg)
    assert folders["folders"][0]["id"] == run
    assert folders["folders"][0]["panoramasCount"] == 2
    assert folders["folders"][0]["gpsCount"] == 2

    csv_data = scan_nas(str(base), "read-csv", sg, run, f"{run}.csv")
    assert csv_data["records"][0]["sourceFilename"] == "N93E70-0093.jpg"
    assert csv_data["records"][0]["targetFilename"] == "N93E70-0093.jpg"
    assert csv_data["records"][1]["distanceToPrevious"] == 0.948

    folder_images = scan_nas(str(base), "folder-images", sg, run)
    assert folder_images["images"] == [
        "003485-20220630-170708-000000001.jpg",
        "003485-20220630-170708-000000002.jpg",
    ]
    final_images = scan_nas(str(base), "final-images", sg, "20220904")
    assert final_images["images"] == ["N93E70-0001.jpg"]

    registry = scan_nas(str(base), "registry")["registry"]
    assert registry[0]["subgrid"] == sg
    assert registry[0]["totals"] == {
        "surveys": 2,
        "stitchedRuns": 1,
        "metadataTotal": 2,
        "imagesTotal": 2,
    }


def test_scan_rejects_path_traversal(tmp_path):
    try:
        scan_nas(str(tmp_path), "final-images", "../outside", "run")
    except ValueError as exc:
        assert "Invalid subgrid" in str(exc)
    else:
        raise AssertionError("expected unsafe subgrid to be rejected")


def test_adaptive_scan_with_alternate_grid_number(tmp_path):
    """Verify adaptive discovery works when client uses Grid 2 instead of Grid 1."""
    base = tmp_path / "nas_grid2"
    sg = "N95E80"
    run = "RUN_20230501"
    pano = base / "03_Stitching" / "Project-OUT" / "Grid 2" / sg / run / "panoramas"
    metadata = base / "01_Metadata" / "Grid 2" / sg / run / f"{run}.csv"
    pano.mkdir(parents=True)
    (pano / "pano_001.jpg").write_bytes(b"image")
    _write_csv(
        metadata,
        "filename,latitude,longitude,heading\n"
        "pano_001.jpg,3.12,101.65,180.0\n",
    )

    subgrids = scan_nas(str(base), "subgrids")
    assert [s["code"] for s in subgrids["subgrids"]] == [sg]
    assert subgrids["subgrids"][0]["existsInStitching"] is True

    folders = scan_nas(str(base), "survey-folders", sg)
    assert len(folders["folders"]) == 1
    assert folders["folders"][0]["id"] == run
    assert folders["folders"][0]["path"] == f"/03_Stitching/Project-OUT/Grid 2/{sg}/{run}/"

    csv_data = scan_nas(str(base), "read-csv", sg, run)
    assert len(csv_data["records"]) == 1
    assert csv_data["records"][0]["latitude"] == 3.12


def test_adaptive_scan_with_custom_stage_names_and_flat_structure(tmp_path):
    """Verify adaptive discovery works with custom stage folder names (Stitched, GPS) without Grid or Project-OUT."""
    base = tmp_path / "nas_custom"
    sg = "N100E20"
    run = "SURVEY_20240115"
    pano = base / "Stitched_Output" / sg / run
    metadata = base / "GPS_Telemetry" / sg / run / f"{run}.csv"
    pano.mkdir(parents=True)
    (pano / "frame_001.jpg").write_bytes(b"frame")
    _write_csv(
        metadata,
        "filename,lat,lon,heading\n"
        "frame_001.jpg,4.21,100.95,90.0\n",
    )

    subgrids = scan_nas(str(base), "subgrids")
    assert [s["code"] for s in subgrids["subgrids"]] == [sg]
    assert subgrids["subgrids"][0]["existsInStitching"] is True

    folders = scan_nas(str(base), "survey-folders", sg)
    assert len(folders["folders"]) == 1
    assert folders["folders"][0]["id"] == run
    assert folders["folders"][0]["path"] == f"/Stitched_Output/{sg}/{run}/"

    folder_images = scan_nas(str(base), "folder-images", sg, run)
    assert folder_images["images"] == ["frame_001.jpg"]

    csv_data = scan_nas(str(base), "read-csv", sg, run)
    assert len(csv_data["records"]) == 1
    assert csv_data["records"][0]["latitude"] == 4.21


def test_adaptive_scan_with_env_stage_overrides(tmp_path, monkeypatch):
    """Verify client can explicitly override stage relative paths via environment variables."""
    base = tmp_path / "nas_override"
    sg = "N50E50"
    run = "RUN_OVERRIDE"
    pano = base / "CustomFolder" / "Runs" / sg / run
    metadata = base / "CustomMeta" / sg / run / "telemetry.csv"
    pano.mkdir(parents=True)
    (pano / "pano_custom.jpg").write_bytes(b"custom")
    _write_csv(
        metadata,
        "filename,latitude,longitude\n"
        "pano_custom.jpg,5.0,105.0\n",
    )

    monkeypatch.setenv("NAS_STITCH_STAGE", "CustomFolder/Runs")
    monkeypatch.setenv("NAS_METADATA_STAGE", "CustomMeta")

    subgrids = scan_nas(str(base), "subgrids")
    assert [s["code"] for s in subgrids["subgrids"]] == [sg]
    assert subgrids["subgrids"][0]["existsInStitching"] is True

    folders = scan_nas(str(base), "survey-folders", sg)
    assert folders["folders"][0]["path"] == f"/CustomFolder/Runs/{sg}/{run}/"

    csv_data = scan_nas(str(base), "read-csv", sg, run)
    assert len(csv_data["records"]) == 1
