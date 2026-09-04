-- =====================================================================
-- Migration 0013: Prune Bloated roadAnalysisState from auth.users
--
-- Fixes HTTP 431 (Request Header Fields Too Large) caused by spatial /
-- GeoJSON data mistakenly stored in auth.users.raw_user_meta_data.
--
-- In Supabase, raw_user_meta_data is embedded into JWT access tokens.
-- Storing GeoJSON in user metadata bloats the JWT header > 8KB,
-- causing API gateways (Kong/Cloudflare) to reject requests with HTTP 431.
--
-- Authoritative Road Analysis state is persisted in `public.project_settings`.
--
-- Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- Idempotent: safe to run repeatedly.
-- =====================================================================

UPDATE auth.users 
SET raw_user_meta_data = raw_user_meta_data - 'roadAnalysisState'
WHERE raw_user_meta_data ? 'roadAnalysisState';
