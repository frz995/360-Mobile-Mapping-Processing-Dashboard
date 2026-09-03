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
  export function gpx(doc: Document): any;
  export function tcx(doc: Document): any;
}
