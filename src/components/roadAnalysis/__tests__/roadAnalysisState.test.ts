import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAuthStorageUserKey,
  getRoadAnalysisStorageKey,
  loadRoadAnalysisState,
  persistRoadAnalysisCache,
  mirrorRoadAnalysisToCache,
  computeRoadAnalysisFingerprint,
  ROAD_ANALYSIS_CACHE_VERSION,
  type RoadAnalysisSavedState
} from '../../RoadAnalysisWorkspace';

describe('RoadAnalysisWorkspace state persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe('getAuthStorageUserKey', () => {
    it('returns "guest" when isGuestUser is true', () => {
      expect(getAuthStorageUserKey({ user: { id: 'usr-123', email: 'user@example.com' } }, true)).toBe('guest');
      expect(getAuthStorageUserKey(undefined, true)).toBe('guest');
    });

    it('returns user id when authenticated session has id', () => {
      const session = { user: { id: 'user-abc-123', email: 'surveyor@tnb.com' } };
      expect(getAuthStorageUserKey(session, false)).toBe('user-abc-123');
    });

    it('returns normalized email when session has no id', () => {
      const session = { user: { email: '  Admin.User@TNB.COM.MY  ' } };
      expect(getAuthStorageUserKey(session, false)).toBe('admin.user@tnb.com.my');
    });

    it('falls back to cached supabase session in localStorage if authSession prop is missing', () => {
      const mockSupabaseToken = {
        user: { id: 'stored-sb-uuid-456', email: 'cached@tnb.com' }
      };
      localStorage.setItem('sb-abcdefgh-auth-token', JSON.stringify(mockSupabaseToken));

      expect(getAuthStorageUserKey(undefined, false)).toBe('stored-sb-uuid-456');
    });

    it('returns "anonymous" when no session or stored token is found', () => {
      expect(getAuthStorageUserKey(undefined, false)).toBe('anonymous');
      expect(getAuthStorageUserKey(null, false)).toBe('anonymous');
    });
  });

  describe('getRoadAnalysisStorageKey', () => {
    it('generates consistent storage keys scoped by user', () => {
      expect(getRoadAnalysisStorageKey('user-1')).toBe('geosphere_road_analysis_state_user-1');
      expect(getRoadAnalysisStorageKey('guest')).toBe('geosphere_road_analysis_state_guest');
    });
  });

  describe('loadRoadAnalysisState and saving state isolation', () => {
    it('loads null when no state is saved', () => {
      expect(loadRoadAnalysisState('user-1')).toBeNull();
    });

    it('saves and restores state accurately for an authenticated user', () => {
      const state: RoadAnalysisSavedState = {
        activeTab: 'region',
        selectedStateCode: 'JHR',
        selectedDistrictIds: ['JHR-007', 'JHR-009'],
        planSource: 'system',
        mapBasemap: 'ofm-dark',
        showRoadLines: true
      };

      const key = getRoadAnalysisStorageKey('user-alice');
      localStorage.setItem(key, JSON.stringify(state));

      const loaded = loadRoadAnalysisState('user-alice');
      expect(loaded).toEqual(state);
      expect(loaded?.selectedStateCode).toBe('JHR');
      expect(loaded?.selectedDistrictIds).toEqual(['JHR-007', 'JHR-009']);
      expect(loaded?.showRoadLines).toBe(true);
    });

    it('isolates state between different users', () => {
      const stateUserA: RoadAnalysisSavedState = {
        activeTab: 'region',
        selectedStateCode: 'JHR',
        selectedDistrictIds: ['JHR-007', 'JHR-009']
      };

      const stateUserB: RoadAnalysisSavedState = {
        activeTab: 'plan',
        selectedStateCode: 'SEL',
        selectedDistrictIds: ['SEL-001']
      };

      localStorage.setItem(getRoadAnalysisStorageKey('user-A'), JSON.stringify(stateUserA));
      localStorage.setItem(getRoadAnalysisStorageKey('user-B'), JSON.stringify(stateUserB));

      expect(loadRoadAnalysisState('user-A')?.selectedStateCode).toBe('JHR');
      expect(loadRoadAnalysisState('user-A')?.selectedDistrictIds).toEqual(['JHR-007', 'JHR-009']);

      expect(loadRoadAnalysisState('user-B')?.selectedStateCode).toBe('SEL');
      expect(loadRoadAnalysisState('user-B')?.selectedDistrictIds).toEqual(['SEL-001']);
    });
  });

  describe('Supabase cloud persistence functions', () => {
    it('executes saveRoadAnalysisStateToSupabase safely with auth context', async () => {
      const { saveRoadAnalysisStateToSupabase } = await import('../../../services/supabase');
      const statePayload = {
        activeTab: 'region' as const,
        selectedStateCode: 'JHR',
        selectedDistrictIds: ['JHR-007', 'JHR-009'],
        planSource: 'system' as const,
        mapBasemap: 'ofm-dark',
        showRoadLines: true
      };

      const res = await saveRoadAnalysisStateToSupabase(statePayload, {
        id: 'usr-prod-001',
        email: 'engineer@tnb.com.my'
      });

      expect(typeof res.success).toBe('boolean');
    });

    it('executes fetchRoadAnalysisStateFromSupabase safely', async () => {
      const { fetchRoadAnalysisStateFromSupabase } = await import('../../../services/supabase');
      const state = await fetchRoadAnalysisStateFromSupabase();
      expect(state === null || typeof state === 'object').toBe(true);
    });
  });

  describe('computeRoadAnalysisFingerprint', () => {
    const baseExtracted = [{ id: '1', name: 'Road A', coordinates: [[100, 1], [100.1, 1.1]] as Array<[number, number]> }];

    it('generates identical fingerprint regardless of district array ordering', () => {
      const fp1 = computeRoadAnalysisFingerprint('JHR', ['JHR-007', 'JHR-009'], 'system', 'ofm-dark', true, null, []);
      const fp2 = computeRoadAnalysisFingerprint('JHR', ['JHR-009', 'JHR-007'], 'system', 'ofm-dark', true, null, []);
      expect(fp1).toBe(fp2);
    });

    it('detects changes in selected state or districts', () => {
      const base = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, []);
      const diffState = computeRoadAnalysisFingerprint('SEL', ['JHR-007'], 'system', 'ofm-dark', true, null, []);
      const diffDist = computeRoadAnalysisFingerprint('JHR', ['JHR-007', 'JHR-009'], 'system', 'ofm-dark', true, null, []);

      expect(base).not.toBe(diffState);
      expect(base).not.toBe(diffDist);
    });

    it('detects changes in basemap choice', () => {
      const fpDark = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, []);
      const fpSat = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'google-satellite', true, null, []);

      expect(fpDark).not.toBe(fpSat);
    });

    it('detects changes in plan source choice', () => {
      const fpSys = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, []);
      const fpExt = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'extracted', 'ofm-dark', true, null, []);
      const fpMan = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'manual', 'ofm-dark', true, null, []);

      expect(fpSys).not.toBe(fpExt);
      expect(fpSys).not.toBe(fpMan);
    });

    it('detects changes in road extraction data', () => {
      const fpEmpty = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, []);
      const fpExtracted = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, baseExtracted);

      expect(fpEmpty).not.toBe(fpExtracted);
    });

    it('detects changes in System Baseline styles (opacity / stroke width)', () => {
      const base = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, []);
      const styled = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, [], undefined, {
        districtBoundary: { visible: true, color: '#e2e8f0', opacity: 0.8, strokeWidth: 2.5 },
        capturedPoints: { visible: true, opacity: 0.9, pointRadius: 6 },
        roadPlan: { visible: true, color: '#10b981', opacity: 1, strokeWidth: 3 }
      });
      const tweaked = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, [], undefined, {
        districtBoundary: { visible: true, color: '#e2e8f0', opacity: 0.55, strokeWidth: 2.5 },
        capturedPoints: { visible: true, opacity: 0.9, pointRadius: 6 },
        roadPlan: { visible: true, color: '#10b981', opacity: 1, strokeWidth: 3 }
      });

      expect(base).not.toBe(styled);
      expect(styled).not.toBe(tweaked);
    });

    it('detects changes in catalog layer style (stroke width / fill opacity / radius)', () => {
      const layerA = { id: 'L1', name: 'Road A', visible: true, color: '#38bdf8', opacity: 0.9, strokeWidth: 2, geojson: { type: 'FeatureCollection', features: [] } } as any;
      const layerB = { ...layerA, strokeWidth: 4 };
      const layerC = { ...layerA, fillOpacity: 0.3, pointRadius: 6 };

      const fpA = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, [], [layerA]);
      const fpB = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, [], [layerB]);
      const fpC = computeRoadAnalysisFingerprint('JHR', ['JHR-007'], 'system', 'ofm-dark', true, null, [], [layerC]);

      expect(fpA).not.toBe(fpB);
      expect(fpA).not.toBe(fpC);
    });
  });

  describe('local cache metadata (single source of truth / sync markers)', () => {
    it('persistRoadAnalysisCache marks edits as unsaved and bumps the local-edit clock', () => {
      const state: RoadAnalysisSavedState = { planSource: 'extracted', showRoadLines: true };
      persistRoadAnalysisCache('user-cache-1', state);

      const cache = loadRoadAnalysisState('user-cache-1')!;
      expect(cache.schemaVersion).toBe(ROAD_ANALYSIS_CACHE_VERSION);
      expect(cache.savedToCloud).toBe(false);
      expect(typeof cache.lastLocalEditAt).toBe('string');
      expect(Date.parse(cache.lastLocalEditAt!)).not.toBeNaN();
      expect(cache.planSource).toBe('extracted');
    });

    it('a later edit produces a strictly newer lastLocalEditAt', async () => {
      persistRoadAnalysisCache('user-cache-2', { planSource: 'extracted' });
      const first = loadRoadAnalysisState('user-cache-2')!.lastLocalEditAt!;
      await new Promise((r) => setTimeout(r, 5));
      persistRoadAnalysisCache('user-cache-2', { planSource: 'manual' });

      const second = loadRoadAnalysisState('user-cache-2')!.lastLocalEditAt!;
      expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
      expect(loadRoadAnalysisState('user-cache-2')!.savedToCloud).toBe(false);
    });

    it('mirrorRoadAnalysisToCache marks a snapshot as synced with the cloud timestamp', () => {
      const savedAt = '2026-09-04T08:30:00.000Z';
      mirrorRoadAnalysisToCache('user-cache-3', {
        activeTab: 'plan',
        planSource: 'extracted',
        extractedLines: [
          {
            id: 'r1',
            name: 'Road',
            coordinates: [
              [100, 1], [100.1, 1.1]
            ] as Array<[number, number]>
          }
        ],
        updatedAt: savedAt
      });

      const cache = loadRoadAnalysisState('user-cache-3')!;
      expect(cache.savedToCloud).toBe(true);
      expect(cache.cloudUpdatedAt).toBe(savedAt);
      expect(cache.updatedAt).toBe(savedAt);
      expect(cache.extractedLines?.length).toBe(1);
      expect(cache.schemaVersion).toBe(ROAD_ANALYSIS_CACHE_VERSION);
    });

    it('clears the unsaved marker once mirrored (savedToCloud true)', () => {
      persistRoadAnalysisCache('user-cache-4', { planSource: 'extracted' });
      expect(loadRoadAnalysisState('user-cache-4')!.savedToCloud).toBe(false);

      mirrorRoadAnalysisToCache('user-cache-4', {
        planSource: 'extracted',
        updatedAt: '2026-09-04T09:00:00.000Z'
      });
      expect(loadRoadAnalysisState('user-cache-4')!.savedToCloud).toBe(true);
    });

    it('persists System Baseline style tweaks and restores them with the unsaved marker', () => {
      const systemStyles = {
        districtBoundary: { visible: true, color: '#e2e8f0', opacity: 0.65, strokeWidth: 1.8 },
        capturedPoints: { visible: true, opacity: 0.9, pointRadius: 6 },
        roadPlan: { visible: true, color: '#10b981', opacity: 1, strokeWidth: 4 }
      };
      persistRoadAnalysisCache('user-cache-5', { systemStyles });

      const cache = loadRoadAnalysisState('user-cache-5')!;
      expect(cache.savedToCloud).toBe(false);
      expect(cache.systemStyles?.districtBoundary?.opacity).toBe(0.65);
      expect(cache.systemStyles?.roadPlan?.strokeWidth).toBe(4);
    });

    it('persists catalog layer edits with the full layer payload', () => {
      const layer = { id: 'L1', name: 'Road A', visible: true, color: '#38bdf8', opacity: 0.9, strokeWidth: 3.5, geojson: { type: 'FeatureCollection', features: [] } } as any;
      persistRoadAnalysisCache('user-cache-6', { catalogLayers: [layer] });

      const cache = loadRoadAnalysisState('user-cache-6');
      expect(cache?.catalogLayers?.[0]?.strokeWidth).toBe(3.5);
      expect(cache?.catalogLayers?.[0]?.name).toBe('Road A');
      expect(cache?.savedToCloud).toBe(false);
    });

    it('a partial edit does not clobber previously cached style state', () => {
      persistRoadAnalysisCache('user-cache-7', {
        systemStyles: {
          districtBoundary: { visible: true, color: '#e2e8f0', opacity: 0.7, strokeWidth: 2 },
          capturedPoints: { visible: true, opacity: 0.9, pointRadius: 6 },
          roadPlan: { visible: true, color: '#10b981', opacity: 1, strokeWidth: 3 }
        },
        selectedDistrictIds: ['JHR-007']
      });
      persistRoadAnalysisCache('user-cache-7', { mapBasemap: 'google-satellite' });

      const cache = loadRoadAnalysisState('user-cache-7')!;
      expect(cache.mapBasemap).toBe('google-satellite');
      expect(cache.selectedDistrictIds).toEqual(['JHR-007']);
      expect(cache.systemStyles?.districtBoundary?.opacity).toBe(0.7);
    });
  });
});
