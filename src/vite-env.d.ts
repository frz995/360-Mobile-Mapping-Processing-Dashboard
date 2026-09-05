/// <reference types="vite/client" />

declare module '*.geojson?raw' {
  const content: string;
  export default content;
}

declare module '*.mjs?url' {
  const url: string;
  export default url;
}

interface ImportMetaEnv {
  readonly VITE_MAP_URL?: string;
  readonly VITE_ROAD_EXTRACTION_ROUTE?: string;
  readonly VITE_ROAD_EXTRACTION_URL?: string;
  readonly VITE_ROAD_EXTRACTION_KEY?: string;
  readonly VITE_ROAD_EXTRACTION_PROXY?: string;
  readonly VITE_ROAD_EXTRACTION_DIRECT?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_KEY?: string;
  readonly VITE_SUPABASE_BUCKET?: string;
  readonly VITE_STORAGE_BUCKET?: string;
  readonly VITE_STORAGE_PROVIDER?: string;
  readonly VITE_R2_DOMAIN?: string;
  readonly VITE_R2_ACCOUNT_ID?: string;
  readonly VITE_R2_BUCKET?: string;
  readonly VITE_IMAGE_CDN_URL?: string;
  readonly VITE_S3_BUCKET?: string;
  readonly VITE_S3_REGION?: string;
  readonly VITE_GCS_BUCKET?: string;
  readonly VITE_AZURE_ACCOUNT?: string;
  readonly VITE_AZURE_CONTAINER?: string;
  readonly VITE_WASABI_BUCKET?: string;
  readonly VITE_WASABI_REGION?: string;
  readonly VITE_NAS_SERVER_URL?: string;
  readonly VITE_PSV_SERVER_URL?: string;
  readonly VITE_DB_PANORAMAS_TABLE?: string;
  readonly VITE_DB_SUMMARY_VIEW?: string;
  readonly VITE_DB_BATCH_LOGS_TABLE?: string;
  readonly VITE_DB_QA_DEFECTS_TABLE?: string;
  readonly VITE_DB_AUDIT_LOGS_TABLE?: string;
  readonly VITE_DB_STAGING_TABLE?: string;
  readonly VITE_DB_NOTIFICATIONS_TABLE?: string;
  readonly VITE_DB_QAQC_RUNS_TABLE?: string;
  readonly VITE_DATA_QUIET?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_ENV_KEYS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'leaflet/dist/leaflet.css';

declare module 'shapefile' {
  export function open(shp: any, dbf?: any): Promise<any>;
}

declare module '@tmcw/togeojson' {
  export function kml(doc: Document): any;
  export function gpx(doc: Document): any;
  export function tcx(doc: Document): any;
}
