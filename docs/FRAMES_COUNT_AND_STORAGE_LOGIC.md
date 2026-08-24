# 📸 Survey Frame Count & Real-Time Storage Verification Logic

## 1. Core Principle
In the Mobile Mapping Processing Dashboard, **POI Count** and **Image Frame Count** represent two distinct but related metrics:
- **POI Count**: Total coordinate points recorded in the survey CSV trajectory for that pass (e.g. 100 POI).
- **Images / Frame Count**: Total actual `.jpg` panorama image files that are **currently uploaded and available in the Supabase `MMS_PIC` storage bucket** (e.g. 90 frames).

> **Crucial Rule**: Frame count MUST ALWAYS be verified live against the Supabase `MMS_PIC` storage bucket. It should never be assumed to equal POI count unless all corresponding `.jpg` files actually exist in the bucket.

---

## 2. Filename Sequence Architecture
Surveys are split into daily passes with sequential image naming conventions:
- **Pass 1**: `N93E70-0001.jpg` &rarr; `N93E70-0014.jpg` (14 POIs)
- **Pass 2**: `N93E70-0015.jpg` &rarr; `N93E70-0114.jpg` (100 POIs)
- **Pass 3**: `N93E70-0116.jpg` &rarr; `N93E70-0165.jpg` (50 POIs)
- **Consolidated Subgrid Total**: `N93E70` &rarr; **164 POIs** total across all 3 passes.

### Example Scenario:
If an operator uploads 90 `.jpg` files for Pass 2 into `MMS_PIC` (`0015.jpg` to `0104.jpg`) and 10 files are still pending upload (`0105.jpg` to `0114.jpg`):
- **Daily Table for Pass 2**: Displays **100 POI** with **90 frames**.
- **Masterlist Batch for N93E70**: Displays **164 POI** with **154 frames** (`14 + 90 + 50`).
- When the remaining 10 images are uploaded into `MMS_PIC`, the dashboard live-scans the bucket and dynamically updates the frame count to **100 frames** (and **164 frames** on Masterlist).

---

## 3. Code Implementation References
1. **[src/services/supabase.ts](file:///d:/Webmap/360%20web%20mapping/processing%20Dashboard/src/services/supabase.ts)**:
   - `fetchSupabaseData`: Pre-fetches the list of files in the `MMS_PIC` bucket using `supabase.storage.from('MMS_PIC').list()` in batches of 100 with 0 HTTP HEAD probing overhead.
   - `verifyFilenamesAgainstStorage`: Compares the survey pass's expected POI image filenames against the bucket file registry. Returns exact verified count and array of verified filenames.
   - `verifyCsvImageFilenamesInStorage`: Checks newly imported CSV rows against the bucket on upload.

2. **[src/App.tsx](file:///d:/Webmap/360%20web%20mapping/processing%20Dashboard/src/App.tsx)**:
   - `getImagesProcessedCount`: Prioritizes `availableImagesCount` from storage verification.
   - `reconcileBatchLogs`: Accurately sums `totalImages` and `totalKm` across all daily survey passes for that subgrid.
