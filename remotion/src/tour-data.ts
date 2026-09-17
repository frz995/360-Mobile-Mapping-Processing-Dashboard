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
        id: 'data',
        order: '01 / 06',
        title: 'Project Management',
        subtitle: 'Survey projects, areas, datasets & project ledgers',
        blurb: 'Survey project setup, subgrid ledgers and file validation before processing begins.',
        tag: 'SURVEY SETUP',
        icon: '/icon module/data_management.png',
        accent: '#34d399',
        screenshots: [
            '/screenshots/Dashboard_UI_17.png',
            '/screenshots/Dashboard_UI_2.png',
            '/screenshots/Dashboard_UI_4.png',
            '/screenshots/Dashboard_UI_18.png',
        ],
        steps: ['Setting up survey projects', 'Verifying NAS masterlist', 'Reconciling daily ledgers'],
    },
    {
        id: 'qaqc',
        order: '02 / 06',
        title: '360° Imagery',
        subtitle: 'Panoramic review with sharpness scoring & defect flags',
        blurb: 'Review captured panoramic imagery alongside spatial locations and survey metadata.',
        tag: 'PANORAMIC REVIEW',
        icon: '/icon module/qaqc.png',
        accent: '#f43f5e',
        screenshots: [
            '/screenshots/Dashboard_UI_26.png',
            '/screenshots/Dashboard_UI_27.png',
            '/screenshots/Dashboard_UI_28.png',
            '/screenshots/Dashboard_UI_3.png',
        ],
        steps: ['Sequencing trajectory frames', 'Auto-scoring sharpness', 'Flagging nadir defects'],
    },
    {
        id: 'production',
        order: '03 / 06',
        title: 'Processing Pipeline',
        subtitle: 'Blurring, stitching, enhancement & asset lineage',
        blurb: 'Multi-station GPU pipeline tracking jobs, progress, failures and outputs.',
        tag: 'PRODUCTION PIPELINE',
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
        id: 'reports',
        order: '04 / 06',
        title: 'QA / QC',
        subtitle: 'Quality review, audit trail & delivery readiness',
        blurb: 'Review survey data and identify issues before final delivery.',
        tag: 'QUALITY REVIEW',
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
        steps: ['Compiling QA results', 'Verifying defect rates', 'Generating PDF report'],
    },
    {
        id: 'webgis',
        order: '05 / 06',
        title: 'GIS Workspace',
        subtitle: 'Spatial analysis over the operational map',
        blurb: 'View, analyse and manage spatial datasets directly within the operational map.',
        tag: 'SPATIAL OPERATIONS',
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
        id: 'postgis',
        order: '06 / 06',
        title: 'Data Management',
        subtitle: 'Spatial registry, staging & cloud sync',
        blurb: 'Maintain datasets, metadata, files and processing records in one environment.',
        tag: 'SPATIAL REGISTRY',
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
];