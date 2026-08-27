import { useMemo } from 'react';

export interface DynamicStorageSettings {
  storageProvider?: 'cloudflare_r2' | 'supabase' | 'aws_s3' | 'custom_cdn' | 'nas_local' | 'gcs' | 'azure_blob' | 'wasabi' | string;
  panoramaMode?: 'multi_res' | 'single_equirectangular' | string;
  imageStorageStrategy?: 'multires_tiles' | 'single_equirectangular' | string;
  r2Domain?: string;
  r2PublicDomain?: string;
  supabaseUrl?: string;
  supabaseBucket?: string;
  customStorageUrl?: string;
  customCdnUrl?: string;
  cloudStorageBaseUrl?: string;
  multiResTilePattern?: string;
  tilePathPattern?: string;
  singleImagePathPattern?: string;
  imageFormatPattern?: string;
  [key: string]: any;
}

export interface ViewerSelectionResult {
  shouldUseMultiRes: boolean;
  viewerDisplayName: string;
  engineName: string;
}

export function usePanoramaViewer(projectSettings?: DynamicStorageSettings): ViewerSelectionResult {
  const shouldUseMultiRes = useMemo(() => {
    if (!projectSettings) return false;

    // 1. Explicit user override from Project Settings
    if (projectSettings.panoramaMode === 'multi_res') return true;
    if (projectSettings.panoramaMode === 'single_equirectangular') return false;
    if (projectSettings.imageStorageStrategy === 'multires_tiles') return true;
    if (projectSettings.imageStorageStrategy === 'single_equirectangular') return false;

    // 2. Dynamic provider inference (Cloudflare R2 defaults to Multi-Res)
    const provider = (projectSettings.storageProvider || '').toLowerCase().trim();
    return provider === 'cloudflare_r2' || provider === 'r2';
  }, [projectSettings?.panoramaMode, projectSettings?.imageStorageStrategy, projectSettings?.storageProvider]);

  const viewerDisplayName = useMemo(() => {
    return shouldUseMultiRes ? 'PSV Multi-Res' : 'PSV Equirectangular';
  }, [shouldUseMultiRes]);

  const engineName = useMemo(() => {
    return shouldUseMultiRes
      ? 'PhotoSphereViewer (EquirectangularTilesAdapter)'
      : 'PhotoSphereViewer (Standard Equirectangular)';
  }, [shouldUseMultiRes]);

  return {
    shouldUseMultiRes,
    viewerDisplayName,
    engineName
  };
}

export default usePanoramaViewer;