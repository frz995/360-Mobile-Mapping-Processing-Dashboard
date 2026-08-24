# 📸 Survey Frame Count & Real-Time Storage Verification Logic

## 1. Core Principle
In the Mobile Mapping Processing Dashboard, **POI Count** and **Image Frame Count** represent two distinct metrics:
- **POI Count**: Total coordinate points recorded in the survey trajectory for that track (e.g. 50 POI).
- **Images / Frame Count**: Total actual `.jpg` panorama image files that are **currently uploaded and available in the Supabase `MMS_PIC` storage bucket** for that specific track (e.g. 0 frames if pending upload).

> **Crucial Rule**: Frame count MUST ALWAYS be verified strictly per-track against the Supabase `MMS_PIC` storage bucket. If 0 images have been uploaded for Track 3, its frame count MUST display `0 frames` (not 50).

---

## 2. Filename Sequence Architecture
Surveys for the same subgrid are split into daily tracks with continuous sequential image naming conventions:
- **Track 1**: `N93E70-0001.jpg` &rarr; `N93E70-0014.jpg` (14 POIs) &mdash; 14 in bucket &rarr; **14 frames**
- **Track 2**: `N93E70-0015.jpg` &rarr; `N93E70-0114.jpg` (100 POIs) &mdash; 90 in bucket (`0015-0104`) &rarr; **90 frames**
- **Track 3**: `N93E70-0116.jpg` &rarr; `N93E70-0165.jpg` (50 POIs) &mdash; 0 in bucket &rarr; **0 frames**
- **Consolidated Subgrid Total**: `N93E70` &rarr; **164 POIs** total | **104 frames** available.

---

## 3. Masterlist Aggregation Logic
The Masterlist Batch Table aggregates all daily tracks into 1 unified subgrid record:
- **Total POI**: `sum(track.poiCount)` = `14 + 100 + 50 = 164`
- **Total Frames**: `sum(track.availableImagesCount)` = `14 + 90 + 0 = 104`
- **Total KM**: `sum(track.kmProcessed)`
- **Status**: `"Ongoing"` until `totalFrames >= totalPoi`.
- When the missing images are uploaded to `MMS_PIC`, the dashboard automatically detects them and updates the frame counts dynamically.
