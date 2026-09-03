import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getAuthStorageUserKey,
  getRoadAnalysisStorageKey,
  loadRoadAnalysisState,
  computeRoadAnalysisFingerprint,
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
    const baseExtracted = [{ id: '1', name: 'Road A', coordinates: [[100, 1], [100.1, 1.1]] as Array<[number, number]>, lengthKm: 1.5, source: 'osm' }];

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
  });
});
