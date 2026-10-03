import { describe, it, expect } from 'vitest';
import {
  LEGACY_CAPABILITY_ALIASES,
  can,
  isAuthzCapability,
  resolveMatrix,
  DEFAULT_ROLE_PERMISSIONS,
  type RolePermissionsMatrix
} from '../authz';

/**
 * Stored `project_settings.role_permissions` rows on any existing deployment use
 * the pre-track-split 11-id vocabulary. These tests pin the upgrade path so a
 * live deployment never silently loses (or gains) a capability when the matrix
 * is read under the new catalogue.
 */

/** The exact 11-id vocabulary the previous Administration matrix persisted. */
const LEGACY_MATRIX: Record<string, Record<string, boolean>> = {
  Administrator: {
    manageUsers: true,
    manageSettings: true,
    publishSequences: true,
    runPipeline: true,
    reviewQaqc: true,
    deleteData: true,
    webgisUpload: true,
    webgisEditAttributes: true,
    webgisCameraCalibration: true,
    webgisFlagDefects: true,
    webgisExportData: true
  },
  'Survey Operator': {
    manageUsers: false,
    manageSettings: false,
    publishSequences: false,
    runPipeline: true,
    reviewQaqc: false,
    deleteData: true,
    webgisUpload: true,
    webgisEditAttributes: false,
    webgisCameraCalibration: true,
    webgisFlagDefects: true,
    webgisExportData: true
  },
  'QA Inspector': {
    manageUsers: false,
    manageSettings: false,
    publishSequences: true,
    runPipeline: false,
    reviewQaqc: true,
    deleteData: false,
    webgisUpload: false,
    webgisEditAttributes: true,
    webgisCameraCalibration: false,
    webgisFlagDefects: true,
    webgisExportData: true
  },
  Viewer: {
    manageUsers: false,
    manageSettings: false,
    publishSequences: false,
    runPipeline: false,
    reviewQaqc: false,
    deleteData: false,
    webgisUpload: false,
    webgisEditAttributes: false,
    webgisCameraCalibration: false,
    webgisFlagDefects: false,
    webgisExportData: true
  },
  guest: {
    manageUsers: false,
    manageSettings: false,
    publishSequences: false,
    runPipeline: false,
    reviewQaqc: false,
    deleteData: false,
    webgisUpload: false,
    webgisEditAttributes: false,
    webgisCameraCalibration: false,
    webgisFlagDefects: false,
    webgisExportData: false
  }
};

describe('legacy capability aliases', () => {
  it('maps every legacy id that still has a counterpart', () => {
    expect(LEGACY_CAPABILITY_ALIASES.publishSequences).toEqual([
      'publishSequences',
      'publishToWebGIS'
    ]);
    expect(LEGACY_CAPABILITY_ALIASES.webgisUpload).toEqual(['importDatasets']);
    expect(LEGACY_CAPABILITY_ALIASES.webgisEditAttributes).toEqual(['manageDatasets']);
    expect(LEGACY_CAPABILITY_ALIASES.webgisFlagDefects).toEqual(['flagDefects']);
    expect(LEGACY_CAPABILITY_ALIASES.webgisExportData).toEqual(['exportPublishedReports']);
  });

  it('deliberately has no target for webgisCameraCalibration', () => {
    // It described a control inside the separate WebGIS app, which this repo
    // embeds via iframe and cannot gate.
    expect(LEGACY_CAPABILITY_ALIASES.webgisCameraCalibration).toBeUndefined();
  });

  it('only ever aliases onto real capability ids', () => {
    for (const targets of Object.values(LEGACY_CAPABILITY_ALIASES)) {
      for (const target of targets) {
        expect(isAuthzCapability(target), `${target} must exist in the catalogue`).toBe(true);
      }
    }
  });
});

describe('migrating a stored legacy matrix', () => {
  const migrated = resolveMatrix(LEGACY_MATRIX);

  it('produces exactly the four real roles', () => {
    expect(Object.keys(migrated).sort()).toEqual([
      'Administrator',
      'QA Inspector',
      'Survey Operator',
      'Viewer'
    ]);
    expect('guest' in migrated).toBe(false);
  });

  it('preserves the Survey Operator production-pipeline grants', () => {
    expect(migrated['Survey Operator'].runPipeline).toBe(true);
    expect(migrated['Survey Operator'].deleteData).toBe(true);
    expect(migrated['Survey Operator'].reviewQaqc).toBe(false);
  });

  it('splits the old publishSequences toggle into bucket upload + WebGIS release', () => {
    // Survey Operator had publishSequences:false -> neither half granted.
    expect(migrated['Survey Operator'].publishSequences).toBe(false);
    expect(migrated['Survey Operator'].publishToWebGIS).toBe(false);
    // QA Inspector had publishSequences:true -> both halves granted.
    expect(migrated['QA Inspector'].publishSequences).toBe(true);
    expect(migrated['QA Inspector'].publishToWebGIS).toBe(true);
  });

  it('renames the webgis* ids onto their published-view counterparts', () => {
    expect(migrated['Survey Operator'].importDatasets).toBe(true); // webgisUpload
    expect(migrated['Survey Operator'].manageDatasets).toBe(false); // webgisEditAttributes
    expect(migrated['QA Inspector'].manageDatasets).toBe(true);
    expect(migrated['QA Inspector'].flagDefects).toBe(true);
    expect(migrated.Viewer.exportPublishedReports).toBe(true);
    expect(migrated.Viewer.flagDefects).toBe(false);
  });

  it('drops webgisCameraCalibration entirely', () => {
    for (const role of Object.keys(migrated) as (keyof RolePermissionsMatrix)[]) {
      expect(Object.keys(migrated[role])).not.toContain('webgisCameraCalibration');
    }
  });

  it('leaves no legacy id anywhere in the migrated matrix', () => {
    const legacyIds = new Set(Object.keys(LEGACY_MATRIX.Administrator));
    for (const role of Object.keys(migrated) as (keyof RolePermissionsMatrix)[]) {
      for (const id of Object.keys(migrated[role])) {
        expect(legacyIds.has(id) && !isAuthzCapability(id), `${role}.${id} is legacy`).toBe(false);
      }
    }
  });

  it('keeps the read-only baseline for every role, including the legacy guest row', () => {
    for (const role of Object.keys(migrated) as (keyof RolePermissionsMatrix)[]) {
      expect(migrated[role].viewAll, `${role}.viewAll`).toBe(true);
    }
  });

  it('keeps the Administrator governance rights but leaves other roles denied', () => {
    // The legacy matrix had manageUsers/manageSettings:false for every non-admin.
    expect(migrated.Administrator.manageUsers).toBe(true);
    expect(migrated.Administrator.manageSettings).toBe(true);
    for (const role of ['Survey Operator', 'QA Inspector', 'Viewer'] as const) {
      expect(migrated[role].manageUsers, `${role}.manageUsers`).toBe(false);
      expect(migrated[role].manageSettings, `${role}.manageSettings`).toBe(false);
    }
  });

  it('fills capabilities that never existed in the legacy vocabulary from defaults', () => {
    // runIntake / operateStations / manageStorage / manageRoadAnalysis /
    // sharePublishedMaps / manageProjects had no legacy source at all.
    expect(migrated['Survey Operator'].runIntake).toBe(
      DEFAULT_ROLE_PERMISSIONS['Survey Operator'].runIntake
    );
    expect(migrated['Survey Operator'].operateStations).toBe(
      DEFAULT_ROLE_PERMISSIONS['Survey Operator'].operateStations
    );
    expect(migrated.Viewer.manageRoadAnalysis).toBe(
      DEFAULT_ROLE_PERMISSIONS.Viewer.manageRoadAnalysis
    );
  });

  it('preserves the enforced RLS grants the SQL layer still relies on', () => {
    expect(can('Survey Operator', 'deleteData', migrated)).toBe(true);
    expect(can('QA Inspector', 'reviewQaqc', migrated)).toBe(true);
    expect(can('Viewer', 'viewAll', migrated)).toBe(true);
  });
});
