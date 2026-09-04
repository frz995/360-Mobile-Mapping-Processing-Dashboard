# The Two Tracks — WebGIS · Published View vs Production Pipeline

The TNB 360 Mobile Mapping System runs on **two tracks**. Understanding which track you are in is the key to using the system correctly.

## Track 1 — WebGIS · Published View

**What it is:** what TNB sees **live on the map**. The published, QA-accepted result. A read-mostly view for management and the public WebGIS.

**Workspaces (nav group "WebGIS · Published View"):**
- Main Dashboard
- Data Management
- Survey Analytics
- Reports
- Road Analysis

## Track 2 — Production Pipeline

**What it is:** the **internal processing** that builds the published view. The operator-facing factory.

**Flow:** RAW intake → blur → stitch → enhance → mask → acceptance QA → deliverable pack → published to WebGIS

**Workspaces (nav group "Production"):**
- Production Workspace
- Processing Center
- Data Lineage
- NAS / Raw Storage Manager

## Governance

Cross-cutting control: **Administration**.

## Terminology (shared words, two meanings)

| Term | WebGIS / Published View | Production Pipeline |
| :--- | :--- | :--- |
| **Publish** | *Publish to WebGIS* — make data live on the public map | *Deliverable pack* — produce the final processed image set (the pipeline "Publish" stage) |
| **Staging / Staged** | "Not yet on the WebGIS" (unpublished survey runs) | Internal *Data staging* step into `staging_panoramas` |
| **Production** | The *live* PostGIS/WebGIS tables | The *internal* processing pipeline |
| **Deliverable** | Final report/PDF | `DELIVERABLE` dataset (processed images) |

**Rule of thumb:** if you are in the **WebGIS** track, "published/staged" is about what is on the public map. If you are in the **Production** track, those words describe internal file/staging steps that end in a deliverable pack — which is only *later* published to the WebGIS.
