import { useMemo } from 'react';

export interface DynamicStorageSettings {
  storageProvider?: string;
  panoramaMode?: string;
  imageStorageStrategy?: string;
  r2PublicDomain?: string;
  supabaseUrl?: string;
  supabaseBucket?: string;
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
    const provider = (projectSettings.storageProvider || '').toLowerCase().trim();
    // Supabase MMS_PIC storage bucket hosts full equirectangular JPGs, never multires tile pyramids
    if (provider === 'supabase') return false;

    if (projectSettings.panoramaMode === 'multi_res') return true;
    if (projectSettings.panoramaMode === 'single_equirectangular') return false;
    if (projectSettings.imageStorageStrategy === 'multires_tiles') return true;
    if (projectSettings.imageStorageStrategy === 'single_equirectangular') return false;

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
    engineName,
  };
}

export default usePanoramaViewer;