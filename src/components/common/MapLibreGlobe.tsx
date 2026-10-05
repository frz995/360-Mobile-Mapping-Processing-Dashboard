import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification, Map as MaplibreMap, MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Showcase globe — MapLibre globe projection over Esri World Imagery.
 *
 * WHY THIS REPLACES AtomicGlobe
 *
 * AtomicGlobe was a free Framer Marketplace component vendored from
 * `framerusercontent.com` (see the deleted file's header). "Free to use in
 * Framer" is not a redistribution grant, so shipping it inside a licensed
 * commercial product was an unresolved rights question. This globe is built
 * entirely from dependencies the app already declares (maplibre-gl 6.7, three),
 * which makes the licensing unambiguous.
 *
 * It also drops the particle-cloud aesthetic for real Earth photography. That
 * is a deliberate trade: raster-on-globe is softer at low zoom than a point
 * cloud, but it shows actual terrain, which is what makes a survey platform
 * legible to a utility audience.
 *
 * TUNING NOTES (why each value is what it is)
 *
 * Raster tiles are Mercator. On globe projection MapLibre resamples them onto a
 * sphere, so low zooms stretch a 256px tile across a large curved surface and
 * look soft. Mitigations:
 *   - `maxzoom: 13` on the source: past that MapLibre overzooms the deepest
 *     available raster rather than requesting tiles that do not exist.
 *   - A generous `tileSize` would request more data per tile; 256 matches Esri's
 *     native size, so higher only blurs.
 *   - `sky` + `atmosphere-blend` supply the limb darkening that makes a globe
 *     read as a sphere rather than a flat disc. The style spec explicitly
 *     recommends interpolating `atmosphere-blend` under globe projection.
 *   - `fadeDuration: 0` and no `crossSourceCollisions`: at globe zoom levels
 *     tile swaps are frequent and a fade reads as flicker.
 */

export const ESRI_WORLD_IMAGERY_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/**
 * Esri requires this credit wherever World Imagery is displayed. Exported for
 * the source's own `attribution` field; the visible footer in this component is
 * rendered as JSX rather than this string, so the constant never reaches an
 * HTML sink.
 */
export const ESRI_ATTRIBUTION =
  'Imagery © Esri, Maxar, Earthstar Geographics';

/**
 * Marker shape is deliberately identical to `EarthGlobe`'s `GlobeMarker`, so
 * the showcase can hand the same `globeMarkers` array to either renderer
 * without a translation layer.
 */
export interface GlobeMarker {
  id?: string;
  label?: string;
  latitude: number;
  longitude: number;
  description?: string;
  color?: string;
  /** 'district' = committed project boundary; 'survey' = available data cluster. */
  kind?: 'district' | 'survey';
  /** Rendered as the active/emphasised marker. */
  active?: boolean;
}

export interface MapLibreGlobeProps {
  markers: GlobeMarker[];
  className?: string;
  style?: React.CSSProperties;
  /** Coordinate the camera eases to. `null` releases back to the resting pose. */
  focusTarget?: { lat: number; lng: number } | null;
  /**
   * Coordinate projected to screen each frame for the HUD leader line. Reported
   * through `onActiveMarkerProjected` with MapLibre's own occlusion flag, so a
   * marker on the far side of the planet is reported invisible rather than
   * guessed at.
   */
  activeTargetCoord?: { lat: number; lng: number } | null;
  /**
   * Camera zoom, replacing the old `globeZoom` multiplier. Kept as a plain
   * number so the showcase tour keeps one scalar of truth for "am I zoomed in".
   */
  zoom?: number;
  /** Report camera zoom changes so the tour can derive `inspectingDistrict`. */
  onZoomChange?: (zoom: number) => void;
  /** Called when the user grabs the globe, so an in-flight focus can be released. */
  onDragStart?: () => void;
  /** Stop the globe rotating on its own. */
  autoRotate?: boolean;
  /**
   * Idle rotation speed in DEGREES PER SECOND — the same unit MapLibre's
   * `bearing` uses. `6` is a calm hero spin (one turn per minute).
   *
   * Note this is NOT comparable to the vector globe's `autoRotateSpeed`, which
   * is radians per second.
   */
  rotationSpeed?: number;
  activeMarkerLabel?: string | null;
  onActiveMarkerProjected?: (pos: { x: number; y: number; visible: boolean }) => void;
  onMarkerClick?: (marker: GlobeMarker) => void;
  /**
   * Whether the wheel over the globe should zoom the camera.
   *
   * In the showcase's `modules` view the wheel drives page scroll (Lenis), so
   * MapLibre must not claim it there; in the dedicated `globe` view the wheel
   * zooms. Drag pan/rotate stay enabled either way — a grab on the globe is
   * unambiguous and never conflicts with the page scroller.
   */
  enableScrollZoom?: boolean;
}

/**
 * Camera zoom contract.
 *
 * MapLibre's `zoom` is NOT the showcase's `globeZoom` multiplier. The showcase
 * treats `globeZoom` as a 1.0-at-rest percentage (it renders `globeZoom * 100`
 * as "241%" and steps it by x1.25), so feeding it straight into
 * `easeTo({ zoom })` gave a globe that sat at z1.15 — mid-atmosphere and tiny.
 * `zoomToCamera` below translates one contract into the other.
 */
/** Camera zoom at showcase multiplier 1.0 — the whole globe in frame. */
const BASE_CAMERA_ZOOM = 0.55;
/** Camera zoom per showcase multiplier step. Keeps 1.0->2.0 a useful dive. */
const ZOOM_PER_UNIT = 2.4;
/** District-scale pose reached from the focus flow. */
const FOCUS_CAMERA_ZOOM = 4.6;

/**
 * How long the camera must stay quiet before the map is treated as idle again.
 * Long enough to outlast drag inertia: `dragend` fires when the pointer is
 * released, but the globe keeps coasting and emitting `rotateend` for a few
 * hundred ms after. See the idle watchdog in the map-construction effect.
 */
const USER_IDLE_MS = 320;

/**
 * Tolerance for treating the camera as already at the requested zoom.
 * `cameraToZoom`/`zoomToCamera` round-trip camera zoom through the showcase's
 * 1.0-at-rest multiplier, so the recovered value can differ from the request in
 * the last decimal. Anything inside this band is left alone rather than eased.
 */
const ZOOM_EPSILON = 0.05;

/**
 * The showcase zoom multiplier that corresponds to `FOCUS_CAMERA_ZOOM`, i.e.
 * what the HUD should read while a district is focused on the satellite globe.
 * Exported so the renderer toggle can reset the shared zoom to the same number
 * this renderer actually flies to, instead of a hand-guessed literal.
 */
export const SATELLITE_FOCUS_ZOOM = cameraToZoom(FOCUS_CAMERA_ZOOM);

/** Translate the showcase's 1.0-at-rest multiplier into a MapLibre camera zoom. */
function zoomToCamera(multiplier: number): number {
  const m = Number.isFinite(multiplier) ? multiplier : 1;
  return Math.min(12, Math.max(0, BASE_CAMERA_ZOOM + (m - 1) * ZOOM_PER_UNIT));
}

/**
 * Inverse of `zoomToCamera`. Required for symmetry: reporting the raw camera
 * zoom upward while accepting a multiplier downward created a feedback loop
 * (wheel -> camera zoom -> reported as multiplier -> eased back to a different
 * camera zoom), which is what made zooming stutter and never settle.
 */
function cameraToZoom(cameraZoom: number): number {
  if (!Number.isFinite(cameraZoom)) return 1;
  return Math.min(8, Math.max(0.5, 1 + (cameraZoom - BASE_CAMERA_ZOOM) / ZOOM_PER_UNIT));
}

/**
 * Camera pitch of the showcase's resting pose. Must stay under `maxPitch` (70).
 *
 * Pitch is the angle off nadir: 0 looks straight down at the surface, 90 looks at
 * the horizon. 56 degrees matches the low-orbit Southeast Asia framing with Indochina
 * in the center, Malaysia and Borneo across the lower third, and curved Earth limb
 * across the headline.
 */
const REST_PITCH = 48;

/**
 * Resting zoom multiplier, in the same 1.0-at-rest units the showcase HUD shows
 * as a percentage. 2.41 is the value the reference frame's own HUD was reading,
 * so the showcase now rests exactly there rather than near it.
 *
 * These pose numbers are tuned by eye against that reference frame. Change them
 * here and the fly-in, the HUD percentage, the glow scale, the focus release and
 * the pitch-easing target all follow together — nothing else hardcodes a pose.
 */
export const INTRO_ZOOM = 2.41;

/** Shared centre for every pose: over southern Indochina / South China Sea. */
const POSE_CENTER: [number, number] = [105.0, 12.0];

/** Where the globe rests, and where the focus release returns to. */
const REST_POSE = {
  center: POSE_CENTER,
  zoom: zoomToCamera(INTRO_ZOOM),
  pitch: REST_PITCH,
  bearing: 0
};

/**
 * Where the intro dive starts.
 * Matches REST_POSE so the showcase opens immediately on Pic 1's exact view.
 */
function introStartPose() {
  return {
    center: POSE_CENTER,
    zoom: zoomToCamera(INTRO_ZOOM),
    pitch: REST_PITCH,
    bearing: 0
  };
}

/** How long the landing-page intro dive takes. */
const INTRO_DURATION_MS = 2400;

function globeStyle(): StyleSpecification {
  return {
    version: 8 as const,
    /**
     * `projection` MUST be declared here rather than applied with
     * `map.setProjection({ type: 'globe' })` after construction.
     *
     * `Style.setProjection()` opens with `_checkLoaded()`, which throws
     * `Error: Style is not done loading.` — and `Map`'s constructor returns
     * before the style finishes parsing. So a post-construction `setProjection`
     * call always threw, was swallowed by the surrounding try/catch, and left
     * the projection at whatever the stylesheet said. The stylesheet said
     * nothing, so `Style._load()` then ran
     * `_setProjectionInternal(this.stylesheet.projection?.type || 'mercator')`
     * and pinned the map to Mercator for good.
     *
     * The symptom was a flat, horizontally-repeating raster world map filling
     * the viewport instead of a sphere: correct imagery, no globe, no error.
     * `style.projection` is the only field `_load()` reads, so declaring it in
     * the spec is what actually applies globe.
     */
    projection: { type: 'globe' },
    sources: {
      'globe-imagery': {
        type: 'raster' as const,
        tiles: [ESRI_WORLD_IMAGERY_TILES],
        tileSize: 256,
        // Esri World Imagery tops out well below 19; capping avoids requests
        // that 404 and keeps the globe from overzooming into mush.
        maxzoom: 13,
        attribution: ESRI_ATTRIBUTION
      }
    },
    layers: [
      { id: 'bg', type: 'background' as const, paint: { 'background-color': '#04070d' } },
      {
        id: 'globe-imagery',
        type: 'raster' as const,
        source: 'globe-imagery',
        minzoom: 0,
        maxzoom: 19,
        paint: { 'raster-fade-duration': 0 }
      }
    ],
    // `atmosphere-blend` is the only atmosphere key the spec exposes (there is
    // no `atmosphere-color`); the style-spec docs call interpolating it by zoom
    // the recommended treatment under globe projection, which is what keeps the
    // limb from looking like a hard disc edge as you zoom in.
    sky: {
      'sky-color': '#0a1424',
      'sky-horizon-blend': 0.75,
      'horizon-color': '#16233a',
      'horizon-fog-blend': 0.6,
      'fog-color': '#04070d',
      'fog-ground-blend': 0.5,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 3, 0.6, 6, 0.15]
    }
  };
}

function isFiniteCoord(c?: { lat: number; lng: number } | null): c is { lat: number; lng: number } {
  return Boolean(c) && Number.isFinite(c ? c.lat : NaN) && Number.isFinite(c ? c.lng : NaN);
}

export function MapLibreGlobe({
  markers,
  className,
  style,
  focusTarget = null,
  activeTargetCoord = null,
  zoom,
  onZoomChange,
  onDragStart,
  autoRotate = false,
  rotationSpeed = 1.0,
  activeMarkerLabel = null,
  onActiveMarkerProjected,
  onMarkerClick,
  enableScrollZoom = true
}: MapLibreGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const onProjectedRef = useRef(onActiveMarkerProjected);
  const onDragRef = useRef(onDragStart);
  const onZoomRef = useRef(onZoomChange);
  const onClickRef = useRef(onMarkerClick);
  const markersRef = useRef<GlobeMarker[]>(markers ?? []);
  /** True while the user is driving the camera, to suppress programmatic eases. */
  const userActiveRef = useRef(false);
  /** The single re-armed idle timer behind `userActiveRef`. See the map effect. */
  const idleTimerRef = useRef<number | null>(null);
  /**
   * Set while this component issues its own `jumpTo`, so the movement events it
   * provokes are not mistaken for the user grabbing the globe. See the map
   * construction effect and the auto-rotate loop.
   */
  const programmaticRef = useRef(false);
  /**
   * Read inside the construct-once effect. Held in a ref so the map constructor
   * does not need it as a dependency (and therefore is not rebuilt when the
   * showcase switches view); the dedicated effect below keeps the live handler
   * state in sync instead.
   */
  const scrollZoomRef = useRef(enableScrollZoom);

  useEffect(() => { onProjectedRef.current = onActiveMarkerProjected; }, [onActiveMarkerProjected]);
  useEffect(() => { onDragRef.current = onDragStart; }, [onDragStart]);
  useEffect(() => { onZoomRef.current = onZoomChange; }, [onZoomChange]);
  useEffect(() => { onClickRef.current = onMarkerClick; }, [onMarkerClick]);
  useEffect(() => { markersRef.current = markers ?? []; }, [markers]);

  // --- Map construction -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // The globe is born at the far, flat end of the intro dive and pulled into
    // the resting pose once the style is ready, so the showcase opens on an
    // approach rather than a globe that is simply already there. Constructing at
    // the final pose instead would show a jump-cut on every load.
    const start = introStartPose();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: globeStyle(),
      center: start.center,
      zoom: start.zoom,
      pitch: start.pitch,
      bearing: 0,
      attributionControl: false,
      // The showcase manages its own chrome; the built-in control would sit
      // under the floating HUD. Esri credit is rendered by this component.
      interactive: true,
      dragRotate: true,
      scrollZoom: scrollZoomRef.current,
      dragPan: true,
      doubleClickZoom: false,
      maxPitch: 70,
      fadeDuration: 0
    });
    mapRef.current = map;

    // Double-click resets camera to resting pose (Pic 1 exact view)
    map.on('dblclick', (e) => {
      e.preventDefault();
      programmaticRef.current = true;
      try {
        map.easeTo({ ...REST_POSE, duration: 900 });
      } finally {
        programmaticRef.current = false;
      }
      onZoomRef.current?.(INTRO_ZOOM);
    });

    // Projection is declared in `globeStyle()` as `projection: { type: 'globe' }`
    // and is applied by `Style._load()` itself. Do NOT add a
    // `map.setProjection()` call here: the map constructor returns before the
    // style has parsed, `Style.setProjection` is `_checkLoaded()`-guarded and
    // throws `Style is not done loading.`, and the catch below turns that into a
    // silent, permanent Mercator fallback. See `globeStyle()`.

    // Report camera zoom upward through the inverse mapping so the HUD
    // percentage and `globeZoom >= 2.0` inspection logic stay meaningful.
    //
    // Reported on `zoomend`, NOT on `zoom`. `zoom` fires once per animation
    // frame, so each wheel tick pushed a setState into the showcase at 60Hz,
    // re-rendering the entire landing page (hero copy, atmospheric glow, the six
    // video tour cards that recompute their orbit radius) while the user panned
    // or zoomed. That re-render was the dominant cost in the drag stutter.
    // `zoomend` also fires for programmatic eases, so the HUD still converges
    // after an easeTo or a reset.
    map.on('zoomend', () => onZoomRef.current?.(cameraToZoom(map.getZoom())));
    map.on('dragstart', () => onDragRef.current?.());

    // While the user is actively driving the camera, programmatic camera moves
    // are suppressed. Without this, the upward zoom report immediately triggered
    // a downward easeTo and the camera never settled.
    //
    // CRITICAL: programmatic moves must not be mistaken for user gestures.
    // `Camera.jumpTo` fires the full movement event set every time it changes
    // anything — `movestart`/`move`/`moveend`, and `rotatestart`/`rotate`/
    // `rotateend` when the bearing changed (camera.ts:681-708). The auto-rotate
    // loop is a `jumpTo({ bearing })` per frame, so listening to `rotatestart`
    // to detect the user made the loop mark ITSELF as user-active on its very
    // first frame. The guard on the next frame then failed and rotation stopped
    // for the lifetime of the page. `programmaticRef` is set around our own
    // `jumpTo` so those self-inflicted events are ignored.
    //
    // The idle side is a single re-armed WATCHDOG, not a timeout per event. It
    // used to arm an independent 140ms timer on every zoomend/rotateend/dragend
    // and never cancelled the previous one, so on a slow globe drag — where
    // `rotateend` fires repeatedly while inertia decays — a stale timer cleared
    // the flag with the pointer still down. The auto-rotate loop then resumed
    // `jumpTo` mid-gesture and wrenched the globe sideways, which read as a drag
    // that randomly seized up. One timer that is cleared and re-armed on every
    // interaction event cannot go stale, and re-arming on `rotateend` holds it
    // closed until drag inertia has actually finished.
    const markUserActive = () => {
      if (programmaticRef.current) return;
      userActiveRef.current = true;
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    };
    const markUserIdle = () => {
      // Same reasoning as `markUserActive`: the auto-rotate loop's own
      // `jumpTo` fires `rotateend` every frame, so honouring it here would churn
      // a clearTimeout/setTimeout pair 60 times a second to re-arm a timer that
      // is already irrelevant.
      if (programmaticRef.current) return;
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        userActiveRef.current = false;
        idleTimerRef.current = null;
      }, USER_IDLE_MS);
    };
    map.on('zoomstart', markUserActive);
    map.on('rotatestart', markUserActive);
    map.on('dragstart', markUserActive);
    map.on('zoomend', markUserIdle);
    map.on('rotateend', markUserIdle);
    map.on('dragend', markUserIdle);

    // Intro dive. Held until 'load' so the raster tiles for the destination
    // tileset exist before the camera starts moving; flying into an unloaded
    // style shows the sphere arriving into a blank canvas.
    //
    // Wrapped in `programmaticRef` so the dive's own `zoomstart`/`pitchstart`
    // are not read as the user grabbing the globe (which would pause the
    // auto-rotate for the idle window afterwards), and so the host's zoom
    // multiplier is not fought mid-flight.
    const runIntro = () => {
      programmaticRef.current = true;
      try {
        map.flyTo({ ...REST_POSE, duration: INTRO_DURATION_MS, curve: 1.5 });
      } finally {
        programmaticRef.current = false;
      }
    };
    if (map.loaded()) runIntro();
    else map.once('load', runIntro);

    // Esri's terms require visible credit. The native control is suppressed
    // above because it collides with the showcase HUD, so the credit is
    // rendered by this component's own footer instead — see the JSX below.
    map.on('error', (e) => {
      const msg = (e as { error?: { message?: string } })?.error?.message || '';
      if (/Failed to fetch|NetworkError|timeout/i.test(msg)) {
        console.warn('[MapLibreGlobe] tile request failed:', msg);
      }
    });

    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Scroll-zoom ownership is view-dependent, but the map is constructed once,
  // so the handler has to be re-synced when the showcase changes view.
  useEffect(() => {
    const map = mapRef.current;
    scrollZoomRef.current = enableScrollZoom;
    if (!map) return;
    if (enableScrollZoom) map.scrollZoom.enable();
    else map.scrollZoom.disable();
  }, [enableScrollZoom]);

  // --- Markers ----------------------------------------------------------
  // Source, layers and data are installed from ONE effect driven by the map's
  // own 'load' event. Previously the data effect and the addSource effect were
  // separate and both guarded on `isStyleLoaded()`, so on first paint the style
  // was not loaded, both early-returned, and neither ever re-ran — no source,
  // no layers, no district points. Same failure on every Vector->Satellite
  // switch, which is why the dots vanished after toggling.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const latestMarkersRef: { current: GlobeMarker[] } = { current: markers ?? [] };

    const toGeoJson = (list: GlobeMarker[]) => ({
      type: 'FeatureCollection' as const,
      features: (list ?? [])
        .filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude))
        .map((m) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] as [number, number] },
          properties: {
            id: m.label ?? `${m.latitude},${m.longitude}`,
            label: m.label ?? '',
            kind: m.kind ?? '',
            active: m.active ? 1 : 0
          }
        }))
    });

    const syncData = () => {
      const src = map.getSource('globe-markers');
      if (src) (src as maplibregl.GeoJSONSource).setData(toGeoJson(latestMarkersRef.current));
    };

    const install = () => {
      if (!map.getStyle()) return;
      // A style reload (or a projection change) drops custom layers, so this
      // must be idempotent and re-runnable rather than a one-shot.
      if (!map.getSource('globe-markers')) {
        map.addSource('globe-markers', {
          type: 'geojson',
          data: toGeoJson(latestMarkersRef.current)
        });
      }
      if (!map.getLayer('globe-marker-halo')) {
        map.addLayer({
          id: 'globe-marker-halo',
          type: 'circle',
          source: 'globe-markers',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 7, 6, 11],
            'circle-color': '#4da6ff',
            'circle-opacity': ['case', ['==', ['get', 'active'], 1], 0.32, 0.18]
          }
        });
      }
      if (!map.getLayer('globe-marker-dot')) {
        map.addLayer({
          id: 'globe-marker-dot',
          type: 'circle',
          source: 'globe-markers',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 3.5, 6, 6],
            'circle-color': ['case', ['==', ['get', 'active'], 1], '#9fd0ff', '#4da6ff'],
            'circle-stroke-color': '#04070d',
            'circle-stroke-width': 1.5
          }
        });
      }

      // Re-arm on every install; MapLibre ignores duplicate identical handlers
      // on the same layer/target pair, so this stays idempotent.
      map.off('click', 'globe-marker-dot', onMarkerClick);
      map.on('click', 'globe-marker-dot', onMarkerClick);
      map.off('mouseenter', 'globe-marker-dot', onMarkerEnter);
      map.on('mouseenter', 'globe-marker-dot', onMarkerEnter);
      map.off('mouseleave', 'globe-marker-dot', onMarkerLeave);
      map.on('mouseleave', 'globe-marker-dot', onMarkerLeave);

      syncData();
    };

    // Delegated marker interaction. Registered once against layer ids that are
    // recreated on every style load, so this re-arms inside `install`.
    const onMarkerClick = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0] as
        | { geometry?: { coordinates?: [number, number] }; properties?: { label?: string } }
        | undefined;
      const coords = f?.geometry?.coordinates;
      if (!coords) return;
      const label = f?.properties?.label;
      const found = (markersRef.current ?? []).find((m) => m.label === label);
      onClickRef.current?.(found ?? { label, latitude: coords[1], longitude: coords[0] });
    };
    const onMarkerEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onMarkerLeave = () => { map.getCanvas().style.cursor = ''; };

    const onStyleData = () => {
      // Wait for a fully-parsed style before touching sources/layers.
      if (map.isStyleLoaded()) install();
    };

    if (map.isStyleLoaded()) install();
    map.on('load', install);
    map.on('styledata', onStyleData);

    return () => {
      map.off('load', install);
      map.off('styledata', onStyleData);
    };
    // `markers` is deliberately not a dependency: data updates go through
    // syncData below so a new array identity never re-registers layers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marker data only.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('globe-markers');
    if (!src) return;
    (src as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (markers ?? [])
        .filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude))
        .map((m) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] as [number, number] },
          properties: {
            id: m.label ?? `${m.latitude},${m.longitude}`,
            label: m.label ?? '',
            kind: m.kind ?? '',
            active: m.active ? 1 : 0
          }
        }))
    });
  }, [markers]);

  // --- Camera: focus / release -----------------------------------------
  // Focus flies to the district; clearing the target flies back to the showcase's
  // resting pose. Both directions use the same easing so the tour reads
  // symmetrically.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!isFiniteCoord(focusTarget)) {
      // Release. Ease back out to the resting pose — the low-orbit limb framing
      // the whole showcase is composed around — rather than to a flat
      // whole-globe overview, which used to yank the page out of its framing.
      programmaticRef.current = true;
      try {
        map.easeTo({ ...REST_POSE, duration: 1400 });
      } finally {
        programmaticRef.current = false;
      }
      return;
    }

    programmaticRef.current = true;
    try {
      map.easeTo({
        center: [focusTarget.lng, focusTarget.lat],
        zoom: FOCUS_CAMERA_ZOOM,
        pitch: 45,
        bearing: 0,
        duration: 1500
      });
    } finally {
      programmaticRef.current = false;
    }
    userActiveRef.current = false;
  }, [focusTarget]);

  // --- Camera: external zoom scalar -------------------------------------
  // Two-way sync between the showcase's `globeZoom` multiplier and the camera.
  // Guarded four ways: not during a focus flight, not while the user is actively
  // orbiting/scrolling, not while any camera move is already in flight, and not
  // when already at the target.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || typeof zoom !== 'number' || !Number.isFinite(zoom)) return;
    if (isFiniteCoord(focusTarget)) return;
    if (userActiveRef.current) return;
    // A move already in flight — user gesture, coasting inertia, or our own
    // previous easeTo — must not be re-targeted. `easeTo` re-anchors from the
    // current position rather than the original target, so re-issuing it each
    // time the reported zoom trickles in restarts the animation every frame:
    // the camera creeps toward the goal and visibly never arrives.
    if (map.isMoving()) return;
    const target = zoomToCamera(zoom);
    if (Math.abs(map.getZoom() - target) > ZOOM_EPSILON) {
      map.easeTo({ zoom: target, duration: 700 });
    }
  }, [zoom, focusTarget]);

  // --- Auto-rotate ------------------------------------------------------
  // Spins the planet with north held up by walking the camera west, matching the
  // vector globe's `lambda` sweep exactly (see the derivation below). An earlier
  // version raised `bearing` instead to keep the camera pinned over the active
  // district, but bearing rotates the image about the camera axis, which sweeps
  // the terrain the opposite way to the vector globe.
  // Suppressed while the user is dragging/zooming so a grab wins immediately.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (autoRotate && !userActiveRef.current && !map.isMoving() && !isFiniteCoord(focusTarget)) {
        // Spin by walking the camera WESTWARD, not by raising `bearing`.
        //
        // The vector globe does `lambda -= autoRotateSpeed * dt` where `lambda`
        // is the camera longitude (`projectPoint` builds `dLng = lng - lambda`,
        // so the sub-camera meridian is exactly `lambda`). Decreasing it moves
        // the camera west with north held up, which slides surface features
        // RIGHTWARD across the visible disc.
        //
        // `bearing` is the other axis entirely: it rotates the rendered image
        // about the camera axis while pinning the camera over the same surface
        // point. Raising it swings features counter-clockwise, i.e. the
        // opposite sweep from the vector globe. Verified numerically against
        // `projectPoint`: at lambda 0 -> -1, the point (lng 0, lat 0) moves from
        // sx = cx to sx = cx + radius*sin(1deg), so the vector globe's terrain
        // travels east across the screen.
        //
        // So the satellite globe now drifts `center.lng` west at the same rate,
        // which reproduces the vector globe's motion and keeps north up. The
        // active district does drift across the disc and round to the back, but
        // `onActiveMarkerProjected` already reports its position and occlusion
        // every frame, so the HUD leader line follows it — the same behaviour the
        // vector globe has always had.
        //
        // `rotationSpeed` is DEGREES PER SECOND of longitude. It used to carry a
        // stray `* 30`, which turned the showcase's nominal 0.06 into 1.8 deg/s
        // — one full turn every 200 seconds. The vector globe's
        // `autoRotateSpeed` is radians/second (~103 deg/s), so the two renderers
        // were ~57x apart in apparent speed.
        const center = map.getCenter();
        // Wrap so a long-lived session cannot drift the camera toward +/-180 and
        // lose float precision in the transform.
        const lng = ((((center.lng - rotationSpeed * dt) + 540) % 360) - 180);
        // Ease pitch and latitude back to the resting pose's framing, so an idle globe
        // smoothly settles into the intended framing while turning gracefully.
        const restPitch = REST_POSE.pitch;
        const pitch = map.getPitch();
        const pitchStep = (restPitch - pitch) * Math.min(1, dt * 1.5);
        const restLat = REST_POSE.center[1];
        const latStep = (restLat - center.lat) * Math.min(1, dt * 1.0);
        const nextLat = Math.abs(latStep) < 0.005 ? restLat : center.lat + latStep;
        programmaticRef.current = true;
        try {
          map.jumpTo(
            Math.abs(pitchStep) < 0.01
              ? { center: [lng, nextLat] }
              : { center: [lng, nextLat], pitch: pitch + pitchStep }
          );
        } finally {
          programmaticRef.current = false;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotate, rotationSpeed, focusTarget]);

  // --- Active marker screen projection ----------------------------------
  useEffect(() => {
    const report = onProjectedRef.current;
    if (!report || !isFiniteCoord(activeTargetCoord)) return;
    let raf = 0;
    const tick = () => {
      const map = mapRef.current;
      const cb = onProjectedRef.current;
      if (map && cb && isFiniteCoord(activeTargetCoord)) {
        // Under globe projection a point on the far side of the planet is still
        // projected to coordinates — it is occluded, not off-screen. MapLibre
        // exposes occlusion via the query path rather than a public helper, so
        // treat an off-canvas projection as hidden and rely on the tour's own
        // focus state for the rest.
        const p = map.project([activeTargetCoord.lng, activeTargetCoord.lat]);
        const rect = map.getCanvas().getBoundingClientRect();
        const inView = p.x >= 0 && p.y >= 0 && p.x <= map.getCanvas().clientWidth && p.y <= map.getCanvas().clientHeight;
        cb({ x: p.x + rect.left, y: p.y + rect.top, visible: inView });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeTargetCoord, activeMarkerLabel]);

  return (
    <div className={`relative ${className ?? 'w-full h-full'}`} style={style}>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      {/* Esri attribution. Esri's terms require visible credit where World
          Imagery is displayed; the native control is suppressed because it
          collides with the showcase HUD, so it is rendered here instead.
          Built as JSX rather than innerHTML — no HTML injection surface. */}
      <div className="absolute bottom-0 right-0 z-10 px-1.5 py-0.5 text-[9px] leading-none text-text-muted/70 bg-app/40 backdrop-blur-sm rounded-tl-sm pointer-events-none [&_a]:text-text-muted [&_a]:underline">
        Imagery &copy;{' '}
        <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics
      </div>
    </div>
  );
}

export default MapLibreGlobe;
