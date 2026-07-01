/// <reference types="vite/client" />

declare module 'shapefile' {
  export function open(shp: any, dbf?: any): Promise<any>;
}

declare module '@tmcw/togeojson' {
  export function kml(doc: Document): any;
  export function gpx(doc: Document): any;
  export function gpx(doc: Document): any;
  export function tcx(doc: Document): any;
}
