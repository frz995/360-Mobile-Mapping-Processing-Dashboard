-- =====================================================================
-- GeoSphere 360 — Public Panorama Imagery Buckets (Migration 0047)
--
-- Enables public read for standard 360 viewer streaming on panorama
-- buckets (MMS_PIC, panoramas). Standard WebGL/Three.js texture loaders
-- and <img> tags in PhotoSphereViewer load directly without custom
-- Authorization headers.
--
-- Storage objects RLS still governs all INSERT, UPDATE, and DELETE operations.
-- Sensitive geometry buckets (road-analysis-geometry) remain strictly private.
-- =====================================================================

BEGIN;

UPDATE storage.buckets
   SET public = TRUE
 WHERE id IN ('MMS_PIC', 'panoramas');

COMMIT;

NOTIFY pgrst, 'reload schema';
