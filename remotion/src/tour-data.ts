export interface TourModule {
    id: string;
    order: string;
    title: string;
    subtitle: string;
    blurb: string;
    tag: string;
    icon: string;
    accent: string;
    screenshots: string[];
    steps: string[];
}

export const TOUR_FPS = 30;
export const TOUR_DURATION_FRAMES = 340; // ~11.3s

export const TOUR_BG = '#05070a';
export const TOUR_PANEL = '#0c1119';
export const TOUR_LINE = 'rgba(255, 255, 255, 0.08)';
export const TOUR_TEXT_MUTED = '#8b98a9';
export const TOUR_RED = '#ef4444';

/** White GeoSphere arrow + wordmark lockup — the single logo used across the videos. */
export const TOUR_LOGO = '/branding/geosphere-full-logo-white.png';

/** White GeoSphere arrow mark on its own (for compact chips). */
export const TOUR_ICON = '/branding/geosphere-icon-white.png';

export const TOUR_MODULES: TourModule[] = [
    {
        id: 'webgis',
        order: '01 / 06',
        title: 'Executive Dashboard\n& Spatial Telemetry',
        subtitle: 'Geodetic Telemetry, Trajectory Tracking & Live Status Stream',
        blurb: 'Command center for live spatial telemetry, the vector map and the 360° panorama.',
        tag: 'SPATIAL EXPLORER',
        icon: '/icon module/production_webgis.png',
        accent: '#3275F8',
        screenshots: [
            '/screenshots/Dashboard_UI_1.png',
            '/screenshots/Dashboard_UI_13.png',
            '/screenshots/Dashboard_UI_5.png',
            '/screenshots/Dashboard_UI_6.png',
            '/screenshots/Dashboard_UI_7.png',
            '/screenshots/Dashboard_UI_8.png',
        ],
        steps: ['Scanning committed subgrids', 'Filtering trajectory layers', 'Opening 360° panorama'],
    },
    {
        id: 'data',
        order: '02 / 06',
        title: 'Data Management\n& Masterlist Ledgers',
        subtitle: 'Subgrid Masterlist, Daily Collections & Folder Verification',
        blurb: 'Masterlist and ledger control for every survey asset shipped from the field.',
        tag: 'FIELD INGESTION',
        icon: '/icon module/data_management.png',
        accent: '#34d399',
        screenshots: [
            '/screenshots/Dashboard_UI_17.png',
            '/screenshots/Dashboard_UI_2.png',
            '/screenshots/Dashboard_UI_4.png',
            '/screenshots/Dashboard_UI_18.png',
        ],
        steps: ['Ingesting survey batches', 'Verifying NAS masterlist', 'Locking daily ledger'],
    },
    {
        id: 'production',
        order: '03 / 06',
        title: 'Production Workspace,\nNAS & Lineage',
        subtitle: '4-Station Desktop Pipeline, GPU Worker & Asset Lineage',
        blurb: 'Multi-station GPU pipeline with immutable asset lineage through the NAS.',
        tag: 'GPU PIPELINE',
        icon: '/icon module/Production_pipeline.png',
        accent: '#f59e0b',
        screenshots: [
            '/screenshots/Dashboard_UI_29.png',
            '/screenshots/Dashboard_UI_30.png',
            '/screenshots/Dashboard_UI_34.png',
            '/screenshots/Dashboard_UI_31.png',
            '/screenshots/Dashboard_UI_32.png',
            '/screenshots/Dashboard_UI_33.png',
            '/screenshots/Dashboard_UI_35.png',
        ],
        steps: ['Dispatching GPU worker', 'Stitching 360° pairs', 'Tracing asset lineage'],
    },
    {
        id: 'qaqc',
        order: '04 / 06',
        title: 'Panoramic StreetView\n& QA/QC Workspace',
        subtitle: 'Tenengrad Sharpness, Pitch/Yaw Check & Defect Flags',
        blurb: 'Optical QA with automated sharpness scoring and precise defect flags.',
        tag: 'OPTICAL QA/QC',
        icon: '/icon module/qaqc.png',
        accent: '#f43f5e',
        screenshots: [
            '/screenshots/Dashboard_UI_26.png',
            '/screenshots/Dashboard_UI_27.png',
            '/screenshots/Dashboard_UI_28.png',
            '/screenshots/Dashboard_UI_3.png',
        ],
        steps: ['Auto-scoring sharpness', 'Flagging nadir defects', 'Publishing clean set'],
    },
    {
        id: 'postgis',
        order: '05 / 06',
        title: 'PostGIS Spatial Hub\n& Vector Staging',
        subtitle: 'Relational Spatial Staging, GIST Indexing & Map Sync',
        blurb: 'PostGIS staging, GIST indexing and cloud sync for every vector layer.',
        tag: 'SPATIAL HUB',
        icon: '/icon module/database_management.png',
        accent: '#38bdf8',
        screenshots: [
            '/screenshots/Dashboard_UI_9.png',
            '/screenshots/Dashboard_UI_10.png',
            '/screenshots/Dashboard_UI_11.png',
            '/screenshots/Dashboard_UI_12.png',
        ],
        steps: ['Staging vector extracts', 'Joining spatial queries', 'Syncing cloud layers'],
    },
    {
        id: 'reports',
        order: '06 / 06',
        title: 'Executive Reports,\nAudit Trail & RBAC',
        subtitle: 'Immutable Event Logging, Milestone Ledgers & Role-Based Access',
        blurb: 'Immutable audit trail, formal reports and role-based governance.',
        tag: 'GOVERNANCE',
        icon: '/icon module/security-audit.png',
        accent: '#a78bfa',
        screenshots: [
            '/screenshots/Dashboard_UI_39.png',
            '/screenshots/Dashboard_UI_37.png',
            '/screenshots/Dashboard_UI_36.png',
            '/screenshots/Dashboard_UI_38.png',
            '/screenshots/Dashboard_UI_14.png',
            '/screenshots/Dashboard_UI_15.png',
        ],
        steps: ['Compiling audit trail', 'Generating PDF pack', 'Exporting CSV report'],
    },
];