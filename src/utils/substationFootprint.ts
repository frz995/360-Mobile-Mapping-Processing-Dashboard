import type { Substation3DConfig } from './substationTypes';

export interface SubstationFeatureProperties {
  substation_type: string;
  substation_voltage: string;
  substation_height: number;
  substation_color: string;
  original_lng?: number;
  original_lat?: number;
  display_label: string;
  station_name?: string;
  [key: string]: unknown;
}

/**
 * Flattens a (possibly nested) geometry into a list of simple geometries.
 * MultiPoint is expanded into individual Points; GeometryCollection is recursed
 * into. Polygon / MultiPolygon / Point pass through unchanged. A missing geometry
 * yields an empty list.
 */
function geometryList(geometry: GeoJSON.Geometry | null | undefined): GeoJSON.Geometry[] {
  if (!geometry) return [];
  if (geometry.type === 'GeometryCollection') {
    return geometry.geometries.flatMap(geometryList);
  }
  if (geometry.type === 'MultiPoint') {
    return geometry.coordinates.map((coordinates) => ({ type: 'Point', coordinates }));
  }
  return [geometry];
}

/** Arithmetic mean of a ring / coordinate list (badge placement). */
function averagePoints(points: Array<[number, number]>): [number, number] | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const [x, y] of points) {
    if (isFinite(x) && isFinite(y)) {
      sumX += x;
      sumY += y;
      count++;
    }
  }
  return count > 0 ? [sumX / count, sumY / count] : null;
}

/** A single representative point for a geometry, for overhead badge labels. */
function geometryAnchorPoint(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates as [number, number];
  }
  if (geometry.type === 'MultiPoint' && Array.isArray(geometry.coordinates)) {
    return averagePoints(geometry.coordinates as Array<[number, number]>);
  }
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return averagePoints((geometry.coordinates[0] || []) as Array<[number, number]>);
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return averagePoints((geometry.coordinates[0]?.[0] || []) as Array<[number, number]>);
  }
  return null;
}

/**
 * Converts a GeoJSON FeatureCollection containing Point (or Polygon) substation assets
 * into synthetic rectangular footprint polygons sized in real meters.
 */
export function generateSubstationFootprints(
  geojson: GeoJSON.FeatureCollection | GeoJSON.Feature | null | undefined,
  config: Substation3DConfig
): GeoJSON.FeatureCollection {
  if (!geojson) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features: GeoJSON.Feature[] = Array.isArray((geojson as GeoJSON.FeatureCollection).features)
    ? (geojson as GeoJSON.FeatureCollection).features
    : (geojson as GeoJSON.Feature).type === 'Feature'
      ? [geojson as GeoJSON.Feature]
      : [];

  const widthMeters = Math.max(1, config.footprintWidth || 8);
  const lengthMeters = Math.max(1, config.footprintLength || 6);
  const heightMeters = Math.max(1, config.height || 4.5);
  const wallColor = config.wallColor || '#2563eb';

  const extrudedFeatures: GeoJSON.Feature[] = [];

  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    if (!feat || !feat.geometry) continue;

    const props = (feat.properties || {}) as Record<string, unknown>;
    const stationName = String(
      props.name ||
      props.NAME ||
      props.station_name ||
      props.STATION_NAME ||
      props.substation ||
      props.pe_name ||
      props.id ||
      props.ID ||
      `Station ${i + 1}`
    );

    const label = `⚡ ${config.type} ${stationName} (${config.voltage})`.trim();

    const geometries = geometryList(feat.geometry);
    for (let gi = 0; gi < geometries.length; gi++) {
      const geom = geometries[gi];
      const idSuffix = geometries.length > 1 ? `-${gi}` : '';

      if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        const [lng, lat] = geom.coordinates;
        if (!isFinite(lng) || !isFinite(lat)) continue;

        // Approximate metric conversion on WGS84 ellipsoid
        const latRad = (lat * Math.PI) / 180;
        const metersPerDegLat = 110574;
        const metersPerDegLng = 111320 * Math.max(Math.cos(latRad), 0.01);

        const halfWidthDeg = (widthMeters / 2) / metersPerDegLng;
        const halfLengthDeg = (lengthMeters / 2) / metersPerDegLat;

        const minLng = lng - halfWidthDeg;
        const maxLng = lng + halfWidthDeg;
        const minLat = lat - halfLengthDeg;
        const maxLat = lat + halfLengthDeg;

        // Closed counter-clockwise polygon ring
        const polygonCoords: [number, number][][] = [[
          [minLng, minLat],
          [maxLng, minLat],
          [maxLng, maxLat],
          [minLng, maxLat],
          [minLng, minLat]
        ]];

        extrudedFeatures.push({
          type: 'Feature',
          id: feat.id ? `${feat.id}${idSuffix}` : `substation-poly-${i}${idSuffix}`,
          properties: {
            ...props,
            substation_type: config.type,
            substation_voltage: config.voltage,
            substation_height: heightMeters,
            substation_color: wallColor,
            original_lng: lng,
            original_lat: lat,
            display_label: label,
            station_name: stationName
          },
          geometry: {
            type: 'Polygon',
            coordinates: polygonCoords
          }
        });
      } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        // Direct polygon extrusion using original surveyed boundary
        extrudedFeatures.push({
          ...feat,
          id: feat.id ? `${feat.id}${idSuffix}` : `substation-poly-${i}${idSuffix}`,
          properties: {
            ...props,
            substation_type: config.type,
            substation_voltage: config.voltage,
            substation_height: heightMeters,
            substation_color: wallColor,
            display_label: label,
            station_name: stationName
          },
          geometry: geom
        });
      }
    }
  }

  return {
    type: 'FeatureCollection',
    features: extrudedFeatures
  };
}

/**
 * Extracts point coordinates for overhead 3D badges and labels floating over the substation roof.
 */
export function generateSubstationBadgePoints(
  geojson: GeoJSON.FeatureCollection | GeoJSON.Feature | null | undefined,
  config: Substation3DConfig
): GeoJSON.FeatureCollection {
  if (!geojson) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features: GeoJSON.Feature[] = Array.isArray((geojson as GeoJSON.FeatureCollection).features)
    ? (geojson as GeoJSON.FeatureCollection).features
    : (geojson as GeoJSON.Feature).type === 'Feature'
      ? [geojson as GeoJSON.Feature]
      : [];

  const badgeFeatures: GeoJSON.Feature[] = [];

  for (let i = 0; i < features.length; i++) {
    const feat = features[i];
    if (!feat || !feat.geometry) continue;

    const props = (feat.properties || {}) as Record<string, unknown>;
    const stationName = String(
      props.name ||
      props.NAME ||
      props.station_name ||
      props.STATION_NAME ||
      props.substation ||
      props.pe_name ||
      props.id ||
      props.ID ||
      `Station ${i + 1}`
    );

    const label = `⚡ ${config.type} ${stationName} (${config.voltage})`.trim();

    const geometries = geometryList(feat.geometry);
    for (let gi = 0; gi < geometries.length; gi++) {
      const ptCoords = geometryAnchorPoint(geometries[gi]);
      if (!ptCoords || !isFinite(ptCoords[0]) || !isFinite(ptCoords[1])) continue;

      const idSuffix = geometries.length > 1 ? `-${gi}` : '';
      badgeFeatures.push({
        type: 'Feature',
        id: `badge-${feat.id ?? i}${idSuffix}`,
        geometry: {
          type: 'Point',
          coordinates: ptCoords
        },
        properties: {
          ...props,
          substation_type: config.type,
          substation_voltage: config.voltage,
          substation_height: config.height || 4.5,
          substation_color: config.wallColor || '#2563eb',
          display_label: label,
          station_name: stationName
        }
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features: badgeFeatures
  };
}
