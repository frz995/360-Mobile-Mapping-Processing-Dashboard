# 📸 Mobile Mapping Track & Frame Count Verification Rules

## 1. Golden Rules for Frame Counts
1. **Never Assume Frames Equal POIs**:
   - `poiCount` = Number of coordinate rows in the trajectory CSV.
   - `imagesProcessed` / `availableImagesCount` = Number of actual `.jpg` images currently uploaded to the Supabase `MMS_PIC` storage bucket matching that track's exact filename sequence.
   - If an imported track has 50 POIs but 0 images are uploaded to the bucket, its frame count MUST BE `0 frames`.

2. **Strict Per-Track Filename Matching**:
   - Do NOT use whole-subgrid count fallbacks.
   - Every individual track has a distinct continuous filename sequence (e.g. Track 1: `0001-0014`, Track 2: `0015-0114`, Track 3: `0116-0165`).
   - Each track's frame count is calculated ONLY by checking how many of its own filenames exist in the storage bucket.

3. **Masterlist Aggregation**:
   - Masterlist for a subgrid sums all tracks for that subgrid:
     - `totalPoi = sum(track.poiCount)`
     - `totalImages = sum(track.availableImagesCount)`
     - `totalKm = sum(track.kmProcessed)`
   - Status is `"Ongoing"` until `totalImages >= totalPoi`.

4. **Implementation Standard**:
   - In `src/services/supabase.ts`, `verifyFilenamesAgainstStorage` filters exact filenames against `storageFileSet`.
   - In `src/App.tsx`, `getImagesProcessedCount` strictly adheres to `availableImagesCount` from storage verification.
