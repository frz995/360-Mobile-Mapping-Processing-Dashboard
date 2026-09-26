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
