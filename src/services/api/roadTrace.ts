import { supabase, getServiceProjectId } from './client';
import type { ExtractedRoadLine } from '../roadExtraction';
import { saveAuditLogToSupabase } from './admin';

export interface RoadAnalysisProductionState {
  activeTab?: 'region' | 'plan' | 'import' | 'catalog' | 'compare' | 'allocation' | 'print';
  selectedStateCode?: string;
  selectedDistrictIds?: string[];
  planSource?: 'system' | 'manual' | 'extracted';
  mapBasemap?: string;
  showRoadLines?: boolean;
  showCoverage?: boolean;
  manualGeoJson?: any;
  extractedLines?: ExtractedRoadLine[];
  catalogLayers?: any[];
  systemStyles?: any;
  catalogPlanLayerId?: string | null;
  planDistanceKm?: number;
  subgridPlanKm?: Record<string, number>;
  totalSubgrids?: number;
  updatedAt?: string;
  updatedBy?: string;
  projectId?: string;
}

/**
 * Persist Road Analysis region and workspace configuration to Supabase.
 * Authoritative store is the project_settings database table.
 * Does NOT write spatial or GeoJSON state to auth.users user_metadata to prevent
 * JWT header bloat (HTTP 431 Request Header Fields Too Large).
 */
export async function saveRoadAnalysisStateToSupabase(
  state: RoadAnalysisProductionState,
  user?: { id?: string; email?: string }
): Promise<{ success: boolean; error?: string; updatedAt?: string }> {
  try {
    const timestamp = new Date().toISOString();
    const userEmail = user?.email || 'authenticated-user';

    // 1. If user has legacy roadAnalysisState in auth metadata, prune it to keep token lean.
    // We NEVER write heavy road state to user_metadata because it gets embedded into JWT
    // headers and causes HTTP 431 (Request Header Fields Too Large).
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser?.user_metadata?.roadAnalysisState) {
        await supabase.auth.updateUser({
          data: { roadAnalysisState: null }
        });
      }
    } catch {
      // ignore
    }

    // 2. Persist via the narrow SECURITY DEFINER RPC (migration 0014). It updates
    //    ONLY the settings.roadAnalysisState key, so the shared project_settings row
    //    stays protected by the admin-only RLS policies from migration 0010, and any
    //    signed-in role can save their Road Analysis workspace.
    const currentPid = state.projectId || getServiceProjectId();
    const rpcPayload: RoadAnalysisProductionState = {
      ...state,
      projectId: currentPid || undefined,
      updatedAt: timestamp,
      updatedBy: userEmail
    };
    let cloudUpdatedAt: string | null = null;
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('save_road_analysis_state', {
        p_state: rpcPayload,
        p_updated_by: userEmail
      });
      const rpcOk = (rpcData as any)?.ok === true;
      if (!rpcError && rpcOk) {
        cloudUpdatedAt = (rpcData as any)?.updated_at || timestamp;
      } else if (rpcError && rpcError.code !== '42883' && rpcError.code !== 'PGRST202') {
        // Real RPC failure (e.g. permission denied): surface it.
        console.error('[Supabase] save_road_analysis_state RPC failed:', rpcError);
        return { success: false, error: rpcError.message || 'Failed to save to database' };
      }
      // Missing function (migration not deployed) / no-op client: fall through to the
      // legacy direct upsert so the path still works where the RPC does not exist.
    } catch {
      // fall through to the legacy upsert below
    }

    if (!cloudUpdatedAt) {
      // 2b. Legacy fallback: direct upsert of the whole row. This will be
      //     RLS-rejected for non-Administrator until migration 0014 is deployed.
      try {
        const { data } = await supabase
          .from('project_settings')
          .select('id, settings')
          .eq('id', 'default')
          .maybeSingle();

        const existingSettings = data?.settings || {};
        const updatedSettings = {
          ...existingSettings,
          roadAnalysisState: rpcPayload
        };

        const { error: dbError } = await supabase.from('project_settings').upsert(
          [
            {
              id: 'default',
              settings: updatedSettings,
              updated_at: timestamp
            }
          ],
          { onConflict: 'id' }
        );

        if (dbError) {
          console.error('[Supabase] project_settings upsert failed:', dbError);
          return { success: false, error: dbError.message || 'Failed to save to database' };
        }
        cloudUpdatedAt = timestamp;
      } catch (dbErr: any) {
        console.error('[Supabase] project_settings upsert exception:', dbErr);
        return {
          success: false,
          error: dbErr?.message || 'Failed to save to database (project_settings write error).'
        };
      }
    }

    // 3. Log to audit trail
    try {
      await saveAuditLogToSupabase({
        timestamp,
        type: 'EDIT',
        title: 'Road Analysis Region & Workspace Saved',
        details: `Saved region configuration (${state.selectedStateCode || 'N/A'}, ${state.selectedDistrictIds?.length || 0} districts) by ${userEmail}`,
        user: userEmail,
        status: 'success'
      });
    } catch {
      // ignore
    }

    return { success: true, updatedAt: cloudUpdatedAt || timestamp };
  } catch (err: any) {
    console.error('[Supabase] saveRoadAnalysisStateToSupabase exception:', err);
    return { success: false, error: err?.message || 'Failed to save to database' };
  }
}

/**
 * Fetch saved Road Analysis configuration from Supabase.
 * Authoritative source is the project_settings database table.
 */
export async function fetchRoadAnalysisStateFromSupabase(): Promise<RoadAnalysisProductionState | null> {
  try {
    const { data, error } = await supabase
      .from('project_settings')
      .select('settings')
      .eq('id', 'default')
      .maybeSingle();

    if (!error && data?.settings?.roadAnalysisState) {
      return data.settings.roadAnalysisState as RoadAnalysisProductionState;
    }
  } catch (err) {
    console.warn('[Supabase] fetchRoadAnalysisStateFromSupabase notice:', err);
  }

  return null;
}
