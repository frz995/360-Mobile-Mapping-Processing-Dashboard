import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// Track a CSS media query from JS (fallback for jsdom test env without matchMedia).
const useMediaQuery = (query: string): boolean => {
    const [matches, setMatches] = useState<boolean>(() =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(query).matches
            : false
    );
    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(mql.matches);
        onChange();
        mql.addEventListener?.('change', onChange);
        return () => mql.removeEventListener?.('change', onChange);
    }, [query]);
    return matches;
};
import {
    Compass,
    Database,
    ArrowRight,
    Cpu,
    Shield,
    FolderKanban,
    MapPin,
    Loader2,
} from 'lucide-react';
import { LayoutGroup, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import Lenis from 'lenis';
import Snap from 'lenis/snap';
import { usePanoramaViewer } from '../hooks/usePanoramaViewer';
import { StarsBackground } from './common/StarsBackground';
import { GeoSphereFullLogo } from './common/GeoSphereLogo';
import { EarthGlobe } from './common/EarthGlobe';
import { MapLibreGlobe, SATELLITE_FOCUS_ZOOM, INTRO_ZOOM, FULL_GLOBE_ZOOM } from './common/MapLibreGlobe';
import type { GlobeMarker } from './common/EarthGlobe';
import { ProjectBoundaryMap } from './common/ProjectBoundaryMap';
import { DISTRICT_METADATA } from './boundary/districtMetadata';
import { MALAYSIA_REGIONS } from './boundary/malaysiaRegions';
import { MALAYSIA_DISTRICTS, districtsToGeoJSON, ensureDistrictGeometriesLoaded } from './boundary/malaysiaDistricts';
import { extractPanotrackPoints, filterPanotrackByBBoxes } from '../utils/panotrackExtractor';
import { getImagesProcessedCount, getPOICount } from '../utils/dashboardData';
import { DistrictProjectPopup, type PanotrackPopupData } from './common/DistrictProjectPopup';
import { AmbienceLayer } from './showcase/AmbienceLayer';
import { HeroSection } from './showcase/HeroSection';
import { ModuleSection } from './showcase/ModuleSection';
import { InterModuleConnectors } from './showcase/InterModuleConnectors';
import { WorkflowSection } from './showcase/WorkflowSection';
import { OutroSection } from './showcase/OutroSection';
import { SectionRail } from './showcase/SectionRail';
import { ModuleTourCards } from './showcase/ModuleTourCards';
import { LaunchPortal } from './showcase/LaunchPortal';
import type { SectionHotspot, SystemModule, WorkflowStep } from './showcase/types';
import { HERO_SECTION, globePoseFor, globeFitScale, springGlide } from './showcase/showcaseMotion';

// Shared showcase types live in ./showcase/types — re-exported for compatibility.
export type { SectionHotspot, SystemModule, WorkflowStep };

const VECTOR_DEFAULT_ZOOM = 1.05;

/** Fallback so a WebGL/tile/runtime hiccup inside the MapLibre globe can never
 *  leave the showcase blank — errors degrade back to the vector SVG EarthGlobe.
 *  A satellite globe is also network-dependent, so this covers a failed tile
 *  fetch as well as a renderer exception. */
class GlobeRenderBoundary extends React.Component<
    { markers: GlobeMarker[]; children: React.ReactNode },
    { failed: boolean }
> {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error: unknown) {
        console.error('[MapLibreGlobe] runtime error — falling back to vector globe:', error);
    }
    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <EarthGlobe
                autoRotate
                autoRotateSpeed={1.8}
                markers={this.props.markers}
                oceanColor="#0f1318"
                landFill="#262c34"
                landStroke="#4a5868"
                strokeWidth={0.85}
                glowColor="rgba(255, 255, 255, 0.18)"
                glowIntensity={0.65}
            />
        );
    }
}

/** Load the district (and its state) that a survey coordinate falls in, so the
 *  geodetic card & HUD always have a real district to show even without a committed
 *  boundary. Smallest containing district wins; nearest centre as last resort. */
function findDistrictAt(lat: number, lng: number): { id: string; name: string; state: string; lat: number; lng: number } | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    let best: { meta: typeof DISTRICT_METADATA[number]; area: number } | null = null;
    for (const m of DISTRICT_METADATA) {
        const b = m.bbox;
        if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
        const area = (b[2] - b[0]) * (b[3] - b[1]);
        if (!best || area < best.area) best = { meta: m, area };
    }
    if (best) {
        return { id: best.meta.id, name: best.meta.name, state: best.meta.stateName, lat: best.meta.center[0], lng: best.meta.center[1] };
    }
    let nearest: { meta: typeof DISTRICT_METADATA[number]; d2: number } | null = null;
    for (const m of DISTRICT_METADATA) {
        const dx = lng - m.center[1];
        const dy = lat - m.center[0];
        const d2 = dx * dx + dy * dy;
        if (!nearest || d2 < nearest.d2) nearest = { meta: m, d2 };
    }
    if (!nearest) return null;
    return { id: nearest.meta.id, name: nearest.meta.name, state: nearest.meta.stateName, lat: nearest.meta.center[0], lng: nearest.meta.center[1] };
}

/**
 * Module screenshot assets catalog.
 * Points to public/screenshots/modules/<id>-NN.png
 */
const MODULE_MEDIA: Record<string, string[]> = {
    project: [
        '/screenshots/modules/project-01.png',
        '/screenshots/modules/project-02.png',
        '/screenshots/modules/project-03.png',
        '/screenshots/modules/project-04.png',
        '/screenshots/modules/project-05.png',
    ],
    dashboard: [
        '/screenshots/modules/dashboard-01.png',
        '/screenshots/modules/dashboard-02.png',
        '/screenshots/modules/dashboard-03.png',
        '/screenshots/modules/dashboard-04.png',
        '/screenshots/modules/dashboard-05.png',
        '/screenshots/modules/dashboard-06.png',
    ],
    roadAnalysis: [
        '/screenshots/modules/roadAnalysis-01.png',
        '/screenshots/modules/roadAnalysis-02.png',
        '/screenshots/modules/roadAnalysis-03.png',
        '/screenshots/modules/roadAnalysis-04.png',
        '/screenshots/modules/roadAnalysis-05.png',
        '/screenshots/modules/roadAnalysis-06.png',
        '/screenshots/modules/roadAnalysis-07.png',
        '/screenshots/modules/roadAnalysis-08.png',
    ],
    production: [
        '/screenshots/modules/production-01.png',
        '/screenshots/modules/production-02.png',
        '/screenshots/modules/production-03.png',
        '/screenshots/modules/production-04.png',
        '/screenshots/modules/production-05.png',
    ],
    pcmon: [
        '/screenshots/modules/pcmon-01.png',
        '/screenshots/modules/pcmon-02.png',
        '/screenshots/modules/pcmon-03.png',
    ],
    insights: [
        '/screenshots/modules/insights-01.png',
        '/screenshots/modules/insights-02.png',
        '/screenshots/modules/insights-03.png',
        '/screenshots/modules/insights-04.png',
        '/screenshots/modules/insights-05.png',
    ],
};

export interface SystemShowcaseProps {
    onEnterDashboard?: (targetView?: string, options?: { isDirectEnter?: boolean }) => void;
    dailyData?: any[];
    batchLogs?: any[];
    projectSettings?: any;
    activeProject?: any;
}

export const SystemShowcase: React.FC<SystemShowcaseProps> = ({
    onEnterDashboard,
    dailyData = [],
    batchLogs = [],
    projectSettings,
    activeProject
}) => {
    const [activeIndex, setActiveIndex] = useState(0);
    // Which scroll-story panel owns the viewport mid-band (-1 hero, 0..5 modules, 6 outro)
    const [activeSection, setActiveSection] = useState(HERO_SECTION);
    // Cinematic launch portal request (covers the swap into a workspace)
    const [launch, setLaunch] = useState<{ view: string; title: string; image?: string; isDirectEnter?: boolean } | null>(null);
    const reducedMotion = useReducedMotion();

    // Scroll story plumbing — the scroll port drives section tracking, the
    // header progress hairline, and the backdrop globe choreography.
    const scrollRef = useRef<HTMLDivElement>(null);
    const modulesContainerRef = useRef<HTMLDivElement>(null);
    const { scrollY, scrollYProgress } = useScroll({ container: scrollRef });
    // Live Lenis instance (see creation effect below) — shared by the smooth
    // wheel glide and programmatic section navigation.
    const lenisRef = useRef<Lenis | null>(null);
    // Section-landing snap instance (see creation effect below).
    const snapRef = useRef<Snap | null>(null);

    // ─── Lenis breathable smooth-scroll + section landing snap ───────────
    // Lenis (darkroom.engineering) turns the scroll port's wheel/trackpad
    // input into a silky lerped glide, but drives the native scrollTop so
    // framer's scroll tracking, IntersectionObserver, keyboard nav and
    // accessibility all keep working untouched. Nested scrollables (the module
    // gallery) keep their native scrolling via allowNestedScroll. The Snap
    // plugin watches the debounced virtual-scroll and, when the user reaches
    // the "benchmark" of a section boundary (within half a viewport), glides
    // the section flush to its anchor so the story always comes to rest
    // centered. Reduced-motion is deliberately overridden (see the option
    // below) so the story reads the same on every machine.
    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;
        // Touch screens keep their NATIVE scrolling. Lenis only smooths
        // wheel/trackpad input (touch is passed straight through), yet the Snap
        // plugin would still fire `scrollTo` against the finger's momentum —
        // the two fight, and the result is the shake/vibration seen during fast
        // flick scrolling. CSS `snap-start` on the sections still gives touch
        // users landing points, handled by the compositor instead of JS.
        const coarsePointer =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(pointer: coarse)').matches;
        if (coarsePointer) return;
        const lenis = new Lenis({
            wrapper: container,
            autoRaf: true,
            lerp: 0.07,
            allowNestedScroll: true,
            // This scroll story is deliberately a motion-first experience.
            // Lenis defaults to honoring prefers-reduced-motion by snapping
            // instantly, so opt out to keep the glide on machines that report
            // OS-level animation reduction.
            respectReducedMotion: false,
        });
        lenisRef.current = lenis;
        const snap = new Snap(lenis, {
            type: 'proximity',
            distanceThreshold: '50%',
            debounce: 400,
        });
        snap.addElements(
            Array.from(container.querySelectorAll<HTMLElement>('[data-section-idx]')),
            { align: 'start' },
        );
        snapRef.current = snap;
        return () => {
            lenisRef.current = null;
            snapRef.current = null;
            snap.destroy();
            lenis.destroy();
        };
    }, []);

    // Backdrop globe pose springs (stationary parallax with per-section targets)
    const poseX = useMotionValue(0);
    const poseY = useMotionValue(0);
    const poseScale = useMotionValue(1);
    const poseOpacity = useMotionValue(0.9);
    const globeX = useSpring(poseX, springGlide);
    const globeY = useSpring(poseY, springGlide);
    const globeScale = useSpring(poseScale, springGlide);
    const globeOpacity = useSpring(poseOpacity, springGlide);
    // Scroll-velocity lean — fast flicks tilt the globe like it has mass.
    const tiltTarget = useMotionValue(0);
    const globeTilt = useSpring(tiltTarget, { stiffness: 140, damping: 18, mass: 0.6 });
    const tiltDecayRef = useRef<number | null>(null);
    const isMobile = useMediaQuery('(max-width: 640px)');
    const [viewMode, setViewMode] = useState<'globe' | 'modules'>('modules');
    // Pause snapping while the globe mode hides the scroll port (a round-trip
    // through zeroed rects would otherwise drag the story back to the hero
    // unseen), then re-measure the anchors when returning to modules.
    useEffect(() => {
        if (viewMode === 'modules') {
            snapRef.current?.resize();
            snapRef.current?.start();
        } else {
            snapRef.current?.stop();
        }
    }, [viewMode]);
    const [viewTransitioning, setViewTransitioning] = useState(false);
    const [titleSparklesReady, setTitleSparklesReady] = useState(false);
    const [autoRotate, setAutoRotate] = useState(true);
    const [customCenter, setCustomCenter] = useState<{ lat: number; lng: number } | null>(null);
    const [flyTarget, setFlyTarget] = useState<{
        latitude: number;
        longitude: number;
        zoom?: number;
        timestamp: number;
    } | null>(null);
    const [atomicGlobeFocus, setAtomicGlobeFocus] = useState<{ lat: number; lng: number } | null>(null);
    const [isZoomedToDistrict, setIsZoomedToDistrict] = useState(false);
    const [isFlyingIn, setIsFlyingIn] = useState(false);
    const [showDistrictPopup, setShowDistrictPopup] = useState(false);
    // Seeded from the satellite globe's hero pose so the HUD percentage, the
    // atmospheric glow and the camera all agree on what "at rest" means before
    // the intro dive reports its first zoom.
    const [globeZoom, setGlobeZoom] = useState(INTRO_ZOOM);
    const [globePan, setGlobePan] = useState({ x: 0, y: 0 });
    const [showAtomicGlobe, setShowAtomicGlobe] = useState(true);
    // Card currently held/pointed in the tour layer — lets the layer restack
    // above the globe so a long-pressed card is actually readable.
    const [tourHovered, setTourHovered] = useState<string | null>(null);

    // While the globe container animates between the corner park and full-screen (700ms),
    // hold the globe's rotation off so the two animations don't fight and stall.
    const prevViewModeRef = useRef(viewMode);
    useEffect(() => {
        if (prevViewModeRef.current !== viewMode) {
            const prev = prevViewModeRef.current;
            prevViewModeRef.current = viewMode;
            if (viewMode === 'globe') {
                setViewTransitioning(true);
                // Switching to 3D Earth:
                const targetZoom = showAtomicGlobe ? FULL_GLOBE_ZOOM : VECTOR_DEFAULT_ZOOM;
                setGlobePan({ x: 0, y: 0 });
                // Only reset camera to overview if no district is currently focused
                if (!showDistrictPopup && !atomicGlobeFocus) {
                    setGlobeZoom(targetZoom);
                    setFlyTarget({
                        latitude: 3.8,
                        longitude: 109.5,
                        zoom: targetZoom,
                        timestamp: Date.now(),
                    });
                }
                const t = window.setTimeout(() => setViewTransitioning(false), 1600);
                return () => window.clearTimeout(t);
            } else if (prev === 'globe') {
                // Clicking back to modules:
                setViewTransitioning(true);
                const returnZoom = showAtomicGlobe ? INTRO_ZOOM : VECTOR_DEFAULT_ZOOM;
                setGlobeZoom(returnZoom);
                setGlobePan({ x: 0, y: 0 });
                setAtomicGlobeFocus(null);
                setShowDistrictPopup(false);
                setFlyTarget({
                    latitude: showAtomicGlobe ? 12.0 : -26.0,
                    longitude: 105.0,
                    zoom: returnZoom,
                    timestamp: Date.now(),
                });
                const t = window.setTimeout(() => setViewTransitioning(false), 1600);
                return () => window.clearTimeout(t);
            }
        }
    }, [viewMode, showAtomicGlobe, showDistrictPopup, atomicGlobeFocus]);

    // Defer mounting the title tsParticles canvas until the view-switch transition has
    // settled, so its one-time engine load + particle spawn doesn't stall the crossfade.
    useEffect(() => {
        if (viewMode !== 'modules') {
            setTitleSparklesReady(false);
            return;
        }
        const t = window.setTimeout(() => setTitleSparklesReady(true), 400);
        return () => window.clearTimeout(t);
    }, [viewMode]);

    // Dynamic Viewer Selection
    const { viewerDisplayName } = usePanoramaViewer(projectSettings);

    // Glide the scroll story to a section (-1 hero, 0..5 modules, 6 outro).
    const scrollToSection = useCallback((idx: number) => {
        const root = scrollRef.current;
        if (!root) return;
        const el = root.querySelector<HTMLElement>(`[data-section-idx="${idx}"]`);
        if (!el) return;
        const lenis = lenisRef.current;
        if (lenis) {
            // Lenis glides with the same lerp as wheel input and respects the
            // scroll port's scroll-padding-top so the sticky header stays clear.
            lenis.scrollTo(el);
            return;
        }
        try {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch {
            try { root.scrollTop = el.offsetTop; } catch { /* test env */ }
        }
    }, []);

    // Smooth navigation helper — module nav clicks glide the scroll story
    const handleModuleChange = useCallback((newIndex: number) => {
        setViewMode('modules');
        setActiveIndex(newIndex);
        setActiveSection(newIndex);
        window.setTimeout(() => scrollToSection(newIndex), 40);
    }, [scrollToSection]);

    // Keyboard arrow navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight') {
                handleModuleChange((activeIndex + 1) % SYSTEM_MODULES.length);
            } else if (e.key === 'ArrowLeft') {
                handleModuleChange((activeIndex - 1 + SYSTEM_MODULES.length) % SYSTEM_MODULES.length);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeIndex]);

    // Track which scroll-story section owns the viewport mid-band.
    useEffect(() => {
        const root = scrollRef.current;
        if (!root || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const idx = Number((entry.target as HTMLElement).dataset.sectionIdx);
                    if (!Number.isFinite(idx)) continue;
                    setActiveSection(idx);
                    if (idx >= 0 && idx < SYSTEM_MODULES.length) setActiveIndex(idx);
                }
            },
            { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 }
        );
        root.querySelectorAll<HTMLElement>('[data-section-idx]').forEach((el) => io.observe(el));
        return () => io.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode]);

    // Backdrop globe choreography — spring to the pose of the active section.
    useEffect(() => {
        const apply = () => {
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
            const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
            const isGlobeMode = viewMode === 'globe';
            const pose = globePoseFor(activeSection, isMobile, vw, vh, isGlobeMode);
            poseX.set(pose.x);
            poseY.set(pose.y);
            // In 3D Earth (globe mode), both satellite and vector globes stand back at scale 1.0.
            // In modules mode, both satellite and vector use full-bleed fit scaling.
            const scale = isGlobeMode ? 1.0 : globeFitScale(vw, vh);
            poseScale.set(scale);
            poseOpacity.set(pose.opacity);
        };
        apply();
        window.addEventListener('resize', apply);
        return () => window.removeEventListener('resize', apply);
    }, [activeSection, isMobile, viewMode, showAtomicGlobe, poseX, poseY, poseScale, poseOpacity]);

    // Scroll-velocity lean: quick flicks tilt the globe, then it settles back.
    const lastScrollYRef = useRef<number | null>(null);
    useMotionValueEvent(scrollY, 'change', (latest: number) => {
        const prev = lastScrollYRef.current;
        lastScrollYRef.current = latest;
        if (prev === null || viewMode !== 'modules' || reducedMotion) return;
        const delta = latest - prev;
        const lean = Math.max(-5, Math.min(5, delta * 0.05));
        tiltTarget.set(lean);
        if (tiltDecayRef.current !== null) window.clearTimeout(tiltDecayRef.current);
        tiltDecayRef.current = window.setTimeout(() => {
            tiltDecayRef.current = null;
            tiltTarget.set(0);
        }, 140);
    });

    // Cinematic launch: the portal overlay covers the hard swap into a workspace.
    const handleLaunchModule = useCallback((view: string, isDirectEnter = false) => {
        if (!onEnterDashboard) return;
        if (reducedMotion) {
            if (isDirectEnter) onEnterDashboard(view, { isDirectEnter: true });
            else onEnterDashboard(view);
            return;
        }
        const mod = SYSTEM_MODULES.find((m) => m.id === view);
        setLaunch({
            view,
            title: mod ? mod.title.split('&')[0].trim() : 'Dashboard',
            image: mod?.images[0],
            isDirectEnter,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onEnterDashboard, reducedMotion]);

    useEffect(() => {
        if (!launch) return;
        const t = window.setTimeout(() => {
            const view = launch.view;
            setLaunch(null);
            if (onEnterDashboard) {
                if (launch.isDirectEnter) onEnterDashboard(view, { isDirectEnter: true });
                else onEnterDashboard(view);
            }
        }, 700);
        return () => window.clearTimeout(t);
    }, [launch, onEnterDashboard]);

    // Telemetry calculations
    const computedDistance = dailyData.reduce((acc, item) => acc + (Number(item.distance || item.kmProcessed) || 0), 0);
    const computedFrames = dailyData.reduce((acc, item) => acc + getImagesProcessedCount(item), 0);
    const computedDefects = dailyData.reduce((acc, item) => acc + (Number(item.imagesDefected || item.defectCount) || 0), 0);
    const computedPoi = dailyData.reduce((acc, item) => acc + getPOICount(item), 0);
    const activeJobs = batchLogs.filter((b: any) => b.status === 'In Progress' || b.status === 'Ongoing').length;
    const targetDistance = Number(projectSettings?.targetKm) || Number(projectSettings?.targetDistanceKm) || (computedDistance > 0 ? computedDistance : 0);
    const pctTarget = targetDistance > 0 ? Math.min(100, (computedDistance / targetDistance) * 100).toFixed(1) : '0.0';
    const slaPercent = computedFrames > 0
        ? Math.max(0, ((computedFrames - computedDefects) / computedFrames) * 100).toFixed(1)
        : '100.0';

    const projectCreatedLabel = activeProject?.createdAt && !isNaN(new Date(activeProject.createdAt).getTime())
        ? new Date(activeProject.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';

    const SYSTEM_MODULES: SystemModule[] = [
        // MODULE 1: PROJECT MANAGEMENT  → workspace `project`
        {
            id: 'project',
            category: 'Projects & Survey Scope',
            title: 'Project Management',
            subtitle: 'Create delivery projects, define their geographic boundary and lock in the regional GIS scope',
            description: 'Every delivery starts as a project. Pick a region preset to auto-fill the CRS, bounding box, basemap and capture equipment, commit the districts the survey covers, and keep active and completed projects in one register. Each project carries its own records, road plans and share links, so switching projects swaps the entire workspace cleanly.',
            metricLabel: 'Active Project',
            metricValue: activeProject?.name || projectSettings?.projectName || '—',
            statusBadge: 'Project Register',
            images: MODULE_MEDIA.project,
            icon: FolderKanban,
            iconImage: '/icon module/data_management.png',
            tourVideoId: 'data',
            workflow: [
                { step: '01. Create', action: 'New project from a region preset' },
                { step: '02. Bound', action: 'Commit districts & project boundary' },
                { step: '03. Activate', action: 'Switch in to scope all data to the project' }
            ],
            specs: [
                { label: 'Region Presets', value: 'CRS · BBOX · Basemap · Equipment' },
                { label: 'Boundary', value: 'District & State Multi-Select' },
                { label: 'Isolation', value: 'Per-Project Data Scoping' }
            ],
            hotspots: [
                {
                    id: 'p1-register',
                    x: 25,
                    y: 16,
                    title: 'Project Register & Counts',
                    tag: 'Project Ledger',
                    description: 'All delivery projects as cards with contract reference, region, district chips and distance progress against target, plus total / active / completed counters.',
                    tip: 'Filter by All, Active or Archived to focus the register.'
                },
                {
                    id: 'p1-create',
                    x: 88,
                    y: 32,
                    title: 'Create Project & Region Preset',
                    tag: 'Project Setup',
                    description: 'Configure a new campaign with name, contract reference, region and target distance; the region preset auto-fills CRS, bounding box, basemap and equipment.',
                    tip: 'Target distance drives the progress bar on every project card.'
                },
                {
                    id: 'p1-boundary',
                    x: 25,
                    y: 75,
                    title: 'Project Geographic Boundary',
                    tag: 'District Boundary',
                    description: 'Pick a Malaysia region, multi-select its districts and preview the boundary live on the map before committing it to the project.',
                    tip: 'Click Apply to commit the selection as the project boundary.'
                },
                {
                    id: 'p1-switch',
                    x: 40,
                    y: 44,
                    title: 'Active Project Switcher',
                    tag: 'Data Isolation',
                    description: 'Load any project to make it current; maps, records, road plans and share links are all scoped to the active project.',
                    tip: 'The CURRENT badge marks the project the dashboard is scoped to.'
                }
            ]
        },

        // MODULE 2: WEBGIS DASHBOARD & DATA MANAGEMENT  → workspace `dashboard`
        {
            id: 'dashboard',
            category: 'WebGIS · Published View',
            title: 'WebGIS Dashboard & Data Management',
            subtitle: 'See published survey coverage on the map and keep the masterlist and daily records in order',
            description: 'The published face of the project. Survey trajectories, subgrid boundaries and frame points render on a MapLibre basemap with a 360° viewer HUD and the Operational Action Center. Behind it, Data Management holds the Subgrid Masterlist, Daily field records and Dataset Recovery. CSV imports map their columns automatically, records publish to WebGIS individually or in bulk, and deletions pass through approval and the recycle bin.',
            metricLabel: 'Total Distance Mapped',
            metricValue: `${computedDistance.toFixed(1)} km (${pctTarget}% of target)`,
            statusBadge: 'Published View',
            images: MODULE_MEDIA.dashboard,
            icon: Compass,
            iconImage: '/icon module/production_webgis.png',
            tourVideoId: 'webgis',
            workflow: [
                { step: '01. Import', action: 'Field CSV with automatic column mapping' },
                { step: '02. Reconcile', action: 'Masterlist & daily records per subgrid' },
                { step: '03. Publish', action: 'Push verified records to the WebGIS map' }
            ],
            specs: [
                { label: 'Map Engine', value: 'MapLibre GL + 360° HUD Viewer' },
                { label: 'Ledgers', value: 'Masterlist · Daily · Dataset Recovery' },
                { label: 'Safe Delete', value: 'Approval-Gated + Recycle Bin' }
            ],
            hotspots: [
                {
                    id: 'd2-kpi',
                    x: 25,
                    y: 12,
                    title: 'KPI Summary',
                    tag: 'Project Metrics',
                    description: 'Distance mapped against target, processed 360° panoramas, active processing runs and overall data quality health for the active project.',
                    tip: 'Figures come straight from the live daily and batch records.'
                },
                {
                    id: 'd2-map',
                    x: 40,
                    y: 55,
                    title: 'Interactive WebGIS Map',
                    tag: 'Spatial Trajectory',
                    description: 'MapLibre GL canvas rendering survey trajectories, subgrid boundaries and frame points on your choice of basemap.',
                    tip: 'Click any frame point to open it in the 360° viewer.'
                },
                {
                    id: 'd2-hud',
                    x: 82,
                    y: 80,
                    title: '360° HUD Viewer',
                    tag: 'Spherical Preview',
                    description: 'Embedded panorama viewer showing heading, coordinates and quality status for the selected frame, right on top of the map.',
                    tip: 'Maximise the HUD for full-screen panoramic review.'
                },
                {
                    id: 'd2-action',
                    x: 50,
                    y: 22,
                    title: 'Operational Action Center',
                    tag: 'Work Stream',
                    description: 'Surfaces ongoing batches, QA defect flags that need attention and subgrids waiting to be published.',
                    tip: 'Use the action buttons to jump straight to the record that needs work.'
                },
                {
                    id: 'd2-ledger',
                    x: 30,
                    y: 18,
                    title: 'Masterlist / Daily / Recovery',
                    tag: 'Data Management',
                    description: 'Switch between the Subgrid Masterlist, Daily field records and Dataset Recovery, with inline editing and bulk publish to WebGIS.',
                    tip: 'The masterlist aggregates every daily run into a single subgrid deliverable.'
                },
                {
                    id: 'd2-import',
                    x: 82,
                    y: 20,
                    title: 'CSV Importer & Column Mapping',
                    tag: 'Intake Tool',
                    description: 'Imports field CSVs and maps date, grid, subgrid, coordinates, heading, frame counts and equipment columns automatically by alias; duplicate images are skipped.',
                    tip: 'Deleting records is submitted for approval instead of removing data outright.'
                }
            ]
        },

        // MODULE 3: ROAD ANALYSIS & PROJECT EXPLORER  → workspace `roadAnalysis`
        {
            id: 'roadAnalysis',
            category: 'Spatial Analysis',
            title: 'Road Analysis & Project Explorer',
            subtitle: 'Compare surveyed coverage against the planned road network and share the results',
            description: 'Import a road plan from GeoJSON, CSV, KML/KMZ, GPX or zipped archives, decoded off the main thread and clipped to the project districts, then promote it as the baseline. Coverage is traced against the network to expose surveyed roads and gaps. The Project Explorer breaks the area down by Roads, Density, Complexity, Panotrack and Coverage with choropleth classes and operator-defined grids, and results leave as print layouts, 3D Map Studio scenes or password-protected share links.',
            metricLabel: 'Plan Coverage',
            metricValue: `${pctTarget}% of target`,
            statusBadge: 'Coverage Analysis',
            images: MODULE_MEDIA.roadAnalysis,
            icon: MapPin,
            iconImage: '/icon module/qaqc.png',
            tourVideoId: 'qaqc',
            workflow: [
                { step: '01. Import', action: 'Load road plan & GIS layers' },
                { step: '02. Trace', action: 'Compare surveyed coverage & gaps' },
                { step: '03. Share', action: 'Print, 3D Studio or share link' }
            ],
            specs: [
                { label: 'GIS Import', value: 'GeoJSON · CSV · KML/KMZ · GPX · ZIP' },
                { label: 'Explorer', value: 'Roads · Density · Complexity · Panotrack · Coverage' },
                { label: 'Outputs', value: 'Print · 3D Studio · Share Link' }
            ],
            hotspots: [
                {
                    id: 'r3-catalog',
                    x: 15,
                    y: 30,
                    title: 'Road Catalog & Plan Baseline',
                    tag: 'Data Catalog',
                    description: 'Every imported layer lives in the catalog; promote a road layer to become the active plan baseline the coverage is measured against.',
                    tip: 'Catalog geometry is backed up to storage, so large plans survive reloads.'
                },
                {
                    id: 'r3-import',
                    x: 15,
                    y: 55,
                    title: 'GIS Import Panel',
                    tag: 'Background Worker',
                    description: 'Decodes GeoJSON, CSV, KML/KMZ, GPX and zipped layers, reports warnings and clips features to the project districts without freezing the map.',
                    tip: 'Out-of-region features are clipped automatically on import.'
                },
                {
                    id: 'r3-coverage',
                    x: 55,
                    y: 50,
                    title: 'Coverage Gap Overlay',
                    tag: 'Topology Trace',
                    description: 'Surveyed trajectories are traced along the planned road network; unsurveyed segments are highlighted as coverage gaps.',
                    tip: 'Toggle the gap overlay to plan the next field run.'
                },
                {
                    id: 'r3-explorer',
                    x: 82,
                    y: 40,
                    title: 'Project Explorer & Choropleth',
                    tag: 'Area Breakdown',
                    description: 'Roads, Density, Complexity, Panotrack and Coverage tabs with charts, choropleth classes and operator-defined grids over the project area.',
                    tip: 'Edit the choropleth classes live in the settings editor.'
                },
                {
                    id: 'r3-studio',
                    x: 55,
                    y: 20,
                    title: '3D Map Studio',
                    tag: '3D Scene',
                    description: 'Tilted 3D scenes with basemap atmosphere and lighting for presentation-ready views of the survey area.',
                    tip: 'Pair 3D Studio with the Explorer for client walkthroughs.'
                },
                {
                    id: 'r3-share',
                    x: 82,
                    y: 85,
                    title: 'Print & Share',
                    tag: 'Outputs',
                    description: 'Print layouts preview exactly what the Explorer shows, and public share links can be protected with a password.',
                    tip: 'Shared maps open read-only with no account required.'
                }
            ]
        },

        // MODULE 4: PRODUCTION HUB  → workspace `production`
        {
            id: 'production',
            category: 'Production Pipeline',
            title: 'Production Hub',
            subtitle: 'Move every subgrid from stitched intake to WebGIS release through gated stations',
            description: 'One hub for the whole assembly line. The 4-PC Flight Board tracks each subgrid through PC 1 Privacy Blur, PC 2 PTGui stitching, PC 3 Lightroom enhancement and PC 4 Photoshop nadir patch. Stitched output is paired against its intake, accepted through 360° QA inspection, checked at the Cloud Bucket Gate and only then released to WebGIS, with every move recorded in the Stage History Ledger so any deliverable can be traced back.',
            metricLabel: 'Active Runs',
            metricValue: `${activeJobs} in progress`,
            statusBadge: 'Gated Pipeline',
            images: MODULE_MEDIA.production,
            icon: Cpu,
            iconImage: '/icon module/Production_pipeline.png',
            tourVideoId: 'production',
            workflow: [
                { step: '01. Pair', action: 'Match stitched output to intake' },
                { step: '02. Process', action: 'Blur → Stitch → Enhance → Nadir' },
                { step: '03. Release', action: 'QA, bucket gate & WebGIS release' }
            ],
            specs: [
                { label: 'Station Flow', value: 'PC1 Blur → PC2 Stitch → PC3 LR → PC4 PS' },
                { label: 'Gates', value: 'Acceptance QA · Bucket · WebGIS Release' },
                { label: 'Traceability', value: 'Stage History Event Ledger' }
            ],
            hotspots: [
                {
                    id: 'h4-stations',
                    x: 12,
                    y: 21,
                    title: '4-PC Multi-Station Flight Board',
                    tag: 'Station Board',
                    description: 'Live card per workstation with software, IN/OUT NAS folders, progress and the last agent pulse, plus the Daily Processing Registry underneath.',
                    tip: 'The board hydrates automatically once each station agent answers.'
                },
                {
                    id: 'h4-intake',
                    x: 23,
                    y: 21,
                    title: 'Stitched Intake & Pairing',
                    tag: 'Intake',
                    description: 'Pairs stitched panoramas with their survey runs and metadata CSVs, using real bucket manifests instead of guessed filenames.',
                    tip: 'Unpaired frames are listed so nothing slips into release unnoticed.'
                },
                {
                    id: 'h4-qa',
                    x: 33,
                    y: 21,
                    title: 'Acceptance QA & 360° Inspection',
                    tag: 'Quality Gate',
                    description: 'Frame-by-frame 360° inspection with optical quality checks; rejected frames are flagged before anything reaches the bucket.',
                    tip: 'Thresholds can be tuned in the QAQC Threshold Studio.'
                },
                {
                    id: 'h4-bucket',
                    x: 44,
                    y: 21,
                    title: 'Cloud Bucket Gate',
                    tag: 'Storage Gate',
                    description: 'Verifies accepted output against the cloud storage bucket so only complete, uploaded sets move on.',
                    tip: 'Missing objects block the gate with a clear reason.'
                },
                {
                    id: 'h4-release',
                    x: 53,
                    y: 21,
                    title: 'WebGIS Release Gate',
                    tag: 'Publication',
                    description: 'Pre-flight checks then publishes the verified subgrid to the WebGIS view.',
                    tip: 'Release only unlocks once QA and the bucket gate have passed.'
                },
                {
                    id: 'h4-history',
                    x: 62,
                    y: 21,
                    title: 'Stage History Ledger',
                    tag: 'Event Ledger',
                    description: 'Append-only record of every stage transition per subgrid, detailing who moved it, when, and from which station.',
                    tip: 'Use it to trace any deliverable back to its raw intake.'
                }
            ]
        },

        // MODULE 5: PC MONITORING & NAS STORAGE  → workspace `pcmon`
        {
            id: 'pcmon',
            category: 'Infrastructure & Storage',
            title: 'PC Monitoring & NAS Storage',
            subtitle: 'Watch every workstation and the NAS that feeds them, and step in remotely',
            description: 'Live CPU, GPU, RAM and storage metrics for each production PC, with a one-click RDP session or an in-browser remote console that can go full screen. When a station is down, the reason is spelled out: no address configured, or the agent is alive but cannot see its NAS mount. NAS & Daemon browses the working directories, reports capacity per volume and verifies file integrity against the records.',
            metricLabel: 'Workstations',
            metricValue: '4-PC + NAS',
            statusBadge: 'Live Infrastructure',
            images: MODULE_MEDIA.pcmon,
            icon: Database,
            iconImage: '/icon module/database_management.png',
            tourVideoId: 'postgis',
            workflow: [
                { step: '01. Monitor', action: 'Live per-PC CPU / GPU / RAM / disk' },
                { step: '02. Connect', action: 'One-click RDP or browser console' },
                { step: '03. Verify', action: 'NAS capacity & file integrity' }
            ],
            specs: [
                { label: 'Telemetry', value: 'CPU · GPU · RAM · Storage per PC' },
                { label: 'Remote Access', value: 'RDP Handoff + noVNC Console' },
                { label: 'Storage', value: 'Explorer · Volumes · Integrity Check' }
            ],
            hotspots: [
                {
                    id: 'm5-telemetry',
                    x: 30,
                    y: 35,
                    title: 'Station Telemetry Grid',
                    tag: 'PC Metrics',
                    description: 'Per-workstation CPU, GPU, RAM and storage gauges reported by the station agent on each PC.',
                    tip: 'Each station needs its agent running to report live figures.'
                },
                {
                    id: 'm5-remote',
                    x: 70,
                    y: 35,
                    title: 'Remote Desktop Console',
                    tag: 'Remote Access',
                    description: 'Download a ready-made .rdp file for a station, or open its desktop in the browser through a secure tunnel, full screen for floor monitoring.',
                    tip: 'HTTPS deployments need an HTTPS tunnel URL for the browser console.'
                },
                {
                    id: 'm5-offline',
                    x: 50,
                    y: 60,
                    title: 'Offline Reason Diagnostics',
                    tag: 'Health',
                    description: 'Distinguishes a station with no address configured from one whose agent is alive but cannot see its NAS mount.',
                    tip: 'Fix the reason shown, and the card recovers on the next pulse.'
                },
                {
                    id: 'm5-explorer',
                    x: 15,
                    y: 17,
                    title: 'NAS Directory Explorer',
                    tag: 'Folders',
                    description: 'Browse the NAS working folders for each stage and jump straight into the Production Hub for a subgrid.',
                    tip: 'Open a folder to see exactly what each station has written.'
                },
                {
                    id: 'm5-capacity',
                    x: 50,
                    y: 45,
                    title: 'Capacity & Volumes',
                    tag: 'Storage Telemetry',
                    description: 'NAS volume health, worker daemon connectivity, directory quotas and the RAW / Processed / Deliverable dataset catalog.',
                    tip: 'Use Check Connectivity to re-test the worker and NAS endpoints.'
                },
                {
                    id: 'm5-integrity',
                    x: 33,
                    y: 17,
                    title: 'Integrity Verification',
                    tag: 'Validation',
                    description: 'Cross-checks files on the NAS against the registered records to catch missing or orphaned images.',
                    tip: 'Run verification before handing a subgrid to the stations.'
                }
            ]
        },

        // MODULE 6: ANALYTICS, REPORTS & ADMINISTRATION  → workspace `reports`
        {
            id: 'insights',
            category: 'Insights & Governance',
            title: 'Analytics, Reports & Administration',
            subtitle: 'Measure progress and quality, export formal reports and control who can do what',
            description: 'Survey Analytics turns the live records into overview, ledger, coverage and quality panels. Reports export Executive, Daily, Subgrid, QA and Lineage reports as print-ready PDFs. Administration manages users and role permissions, approves deletion requests, keeps the audit log and reports system health, so every change to project data is accounted for.',
            metricLabel: 'Data Quality',
            metricValue: `${slaPercent}% SLA`,
            statusBadge: 'Governance',
            images: MODULE_MEDIA.insights,
            icon: Shield,
            iconImage: '/icon module/security-audit.png',
            tourVideoId: 'reports',
            workflow: [
                { step: '01. Analyse', action: 'Coverage, quality & ledger trends' },
                { step: '02. Report', action: 'Export executive & QA PDFs' },
                { step: '03. Govern', action: 'Users, approvals & audit trail' }
            ],
            specs: [
                { label: 'Analytics', value: 'Overview · Ledger · Coverage · Quality' },
                { label: 'Reports', value: 'Executive · Daily · Subgrid · QA · Lineage' },
                { label: 'Administration', value: 'Users · Roles · Approvals · Audit · Health' }
            ],
            hotspots: [
                {
                    id: 'i6-overview',
                    x: 30,
                    y: 30,
                    title: 'Analytics Overview',
                    tag: 'Survey Analytics',
                    description: 'Headline survey performance covering distance, frames, runs and publication status, computed from the live records.',
                    tip: 'Analytics never modify data; they only read the current records.'
                },
                {
                    id: 'i6-coverage',
                    x: 60,
                    y: 30,
                    title: 'Coverage & Quality Panels',
                    tag: 'Data Quality',
                    description: 'Road plan coverage against target and defect-rate quality metrics per subgrid, alongside the processing ledger.',
                    tip: 'Quality figures track defect rates against the agreed threshold.'
                },
                {
                    id: 'i6-reports',
                    x: 45,
                    y: 55,
                    title: 'Report PDF Export',
                    tag: 'Formal Export',
                    description: 'Executive, Daily, Subgrid, QA and Lineage reports rendered as print-ready, client-facing PDF documents.',
                    tip: 'Generate the executive report ahead of every progress meeting.'
                },
                {
                    id: 'i6-users',
                    x: 20,
                    y: 20,
                    title: 'User & Role Management',
                    tag: 'Access Control',
                    description: 'Invite users and assign roles; each role grants a precise set of capabilities across the workspaces.',
                    tip: 'Guests browse read-only without any risk to survey data.'
                },
                {
                    id: 'i6-approvals',
                    x: 40,
                    y: 20,
                    title: 'Deletion Approvals',
                    tag: 'Approvals',
                    description: 'Deletion requests raised in Data Management wait here for an approver before anything is removed.',
                    tip: 'Rejected requests leave the records untouched.'
                },
                {
                    id: 'i6-audit',
                    x: 60,
                    y: 20,
                    title: 'Audit Logs & System Health',
                    tag: 'Accountability',
                    description: 'Every upload, publish, edit and sign-in is logged, next to a live view of service and database health.',
                    tip: 'Filter the audit log by user or action type when investigating changes.'
                }
            ]
        }
    ];

    // Preload screenshot assets into memory
    useEffect(() => {
        SYSTEM_MODULES.forEach((mod) => {
            mod.images.forEach((src) => {
                const img = new Image();
                img.src = src;
            });
        });
    }, []);

    // Toggle html class so themes.css !important rules don't block the background image
    useEffect(() => {
        document.documentElement.classList.add('showcase-active');
        return () => {
            document.documentElement.classList.remove('showcase-active');
        };
    }, []);

    const current = SYSTEM_MODULES[activeIndex];

    // Derive overall current project location dynamically
    const projectLocation = useMemo(() => {
        let sumLat = 0;
        let sumLng = 0;
        let count = 0;

        if (Array.isArray(dailyData) && dailyData.length > 0) {
            for (const day of dailyData) {
                if (Array.isArray(day?.points)) {
                    for (const pt of day.points) {
                        const lat = Number(pt?.lat ?? pt?.latitude);
                        const lng = Number(pt?.lon ?? pt?.longitude ?? pt?.lng);
                        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
                            sumLat += lat;
                            sumLng += lng;
                            count++;
                            if (count >= 100) break;
                        }
                    }
                }
                if (count >= 100) break;
            }
        }

        if (count > 0) {
            const avgLat = sumLat / count;
            const avgLng = sumLng / count;
            return {
                latitude: avgLat,
                longitude: avgLng,
                name: projectSettings?.projectName || 'Active Survey Area',
                subtext: `${avgLat.toFixed(4)}° N, ${avgLng.toFixed(4)}° E • Peninsular Malaysia`
            };
        }

        // Default: center of the committed project boundary bbox, or global Malaysia center
        const bnd = projectSettings?.projectBoundary as any;
        if (bnd?.bbox && Array.isArray(bnd.bbox) && bnd.bbox.length === 4) {
            const cLat = (bnd.bbox[1] + bnd.bbox[3]) / 2;
            const cLng = (bnd.bbox[0] + bnd.bbox[2]) / 2;
            return {
                latitude: cLat,
                longitude: cLng,
                name: bnd.regionName || projectSettings?.projectName || 'Active Survey Area',
                subtext: `${cLat.toFixed(4)}° N, ${cLng.toFixed(4)}° E • ${bnd.regionName || 'Malaysia'}`
            };
        }
        return {
            latitude: 3.8,
            longitude: 109.5,
            name: projectSettings?.projectName || 'Active Survey Area',
            subtext: 'Peninsular Malaysia'
        };
    }, [dailyData, projectSettings]);
    // Available districts/projects for inspection — derived entirely from the
    // user's committed project boundary (never hardcoded). All THREE saved signals are
    // merged (ids, names, geojson features) so nothing the user saved is ever dropped:
    // e.g. a boundary saved with districtIds:['segamat'] but a geojson that also carries
    // Tangkak still exposes Tangkak in the HUD card.
    const inspectableDistricts = useMemo(() => {
        const boundary = projectSettings?.projectBoundary as any;
        const list: Array<{ id: string; name: string; state: string; lat: number; lng: number }> = [];

        // 1. districtIds array (written by both AdminSettingsView & ProjectOnboarding)
        if (Array.isArray(boundary?.districtIds) && boundary.districtIds.length > 0) {
            boundary.districtIds.forEach((id: string) => {
                const meta = DISTRICT_METADATA.find(d => d.id.toLowerCase() === String(id).toLowerCase());
                if (meta) {
                    list.push({ id: meta.id, name: meta.name, state: meta.stateName, lat: meta.center[0], lng: meta.center[1] });
                }
            });
        }

        // 2. districtNames (AdminSettings writes both, Onboarding may omit districtNames)
        if (Array.isArray(boundary?.districtNames) && boundary.districtNames.length > 0) {
            boundary.districtNames.forEach((name: string) => {
                const meta = DISTRICT_METADATA.find(d => d.name.toLowerCase() === String(name).toLowerCase());
                if (meta) {
                    list.push({ id: meta.id, name: meta.name, state: meta.stateName, lat: meta.center[0], lng: meta.center[1] });
                }
            });
        }

        // 3. Derive districts from the committed geojson FeatureCollection itself
        if (boundary?.geojson && Array.isArray(boundary.geojson.features)) {
            boundary.geojson.features.forEach((f: any) => {
                const name = f?.properties?.name || '';
                const id = String(f?.id || '');
                const meta = name
                    ? DISTRICT_METADATA.find(d => d.name.toLowerCase() === String(name).toLowerCase())
                    : DISTRICT_METADATA.find(d => d.id.toLowerCase() === id.toLowerCase());
                if (meta) {
                    list.push({ id: meta.id, name: meta.name, state: meta.stateName, lat: meta.center[0], lng: meta.center[1] });
                }
            });
        }

        // Keep the list free of duplicates (same district may appear via multiple writers)
        const seen = new Set<string>();
        const deduped = list.filter(d => {
            const key = d.id.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return deduped;
    }, [projectSettings]);

    // Districts the globe overview & HUD actually show. Bound to the project boundary:
    // a boundary committed with specific districts (e.g. Johor with Segamat + Tangkak)
    // exposes exactly those; a whole-state/region boundary (regionId/regionName set but
    // no per-district ids) expands to EVERY district in that state, so the overview
    // reflects the full data footprint committed for the project. Always dynamic per
    // project — nothing here is hardcoded. With no boundary at all, a single district
    // loads from the surveyed coords so the State / District rows still show real info.
    const resolvedDistricts = useMemo(() => {
        if (inspectableDistricts.length > 0) return inspectableDistricts;

        // Whole-state/region boundary (single region plan): list every district in that state
        const boundary = projectSettings?.projectBoundary as any;
        const regionName = boundary?.regionName as string | undefined;
        if (regionName) {
            const stateDists = DISTRICT_METADATA.filter(d => d.stateName.toLowerCase() === regionName.toLowerCase());
            if (stateDists.length > 0) {
                return stateDists.map(meta => ({ id: meta.id, name: meta.name, state: meta.stateName, lat: meta.center[0], lng: meta.center[1] }));
            }
        }

        // Last resort only: load the district under the surveyed location
        const loaded = findDistrictAt(projectLocation.latitude, projectLocation.longitude);
        return loaded ? [loaded] : [];
    }, [inspectableDistricts, projectSettings, projectLocation.latitude, projectLocation.longitude]);

    // Prefer the surveyed district as the default selected chip (when listing a whole state)
    const defaultDistrictIdx = useMemo(() => {
        if (resolvedDistricts.length <= 1) return 0;
        const loaded = findDistrictAt(projectLocation.latitude, projectLocation.longitude);
        if (!loaded) return 0;
        const i = resolvedDistricts.findIndex(d => d.id.toLowerCase() === loaded.id.toLowerCase());
        return i >= 0 ? i : 0;
    }, [resolvedDistricts, projectLocation.latitude, projectLocation.longitude]);

    const [selectedDistrictIdx, setSelectedDistrictIdx] = useState(0);
    const [showProjectPicker, setShowProjectPicker] = useState(false);
    // Real MultiPolygon district geometries load eagerly in the background; flip this
    // flag when they arrive so the committed boundary can be rebuilt with true shapes.
    const [districtGeomReady, setDistrictGeomReady] = useState(false);
    useEffect(() => {
        let alive = true;
        ensureDistrictGeometriesLoaded()
            .then(() => { if (alive) setDistrictGeomReady(true); })
            .catch(() => { if (alive) setDistrictGeomReady(true); });
        return () => { alive = false; };
    }, []);

    // The strict committed boundary for the HUD card: each committed district drawn as
    // its own polygon (real geometry once loaded, metadata bbox otherwise). Falls back to
    // the stored project-settings boundary when nothing is committed. Independent of POI.
    const committedBoundary = useMemo(() => {
        const ids = resolvedDistricts.map(d => d.id.toLowerCase());
        if (districtGeomReady && ids.length > 0) {
            const chosen = MALAYSIA_DISTRICTS.filter(d => ids.includes(d.id.toLowerCase()));
            const geo = districtsToGeoJSON(chosen);
            if (geo) return geo;
        }
        const stored = (projectSettings?.projectBoundary as any)?.geojson;
        const storedBbox = (projectSettings?.projectBoundary as any)?.bbox;
        if (stored) return { geojson: stored, bbox: storedBbox };
        return null;
    }, [resolvedDistricts, projectSettings, districtGeomReady]);

    // Stable identity for the committed boundary handed to ProjectBoundaryMap — the
    // inspect view must NOT receive a fresh object every render (that re-triggers its
    // layer rebuilds → boundary flashes while any other state updates).
    const activeProjectBoundary = useMemo(
        () => (committedBoundary ? { geojson: committedBoundary.geojson, bbox: committedBoundary.bbox } : undefined),
        [committedBoundary]
    );

    // When the district list was loaded from state metadata (no committed boundary),
    // default the selection to the district the survey actually sits in.
    useEffect(() => {
        if (selectedDistrictIdx === 0 && defaultDistrictIdx > 0) {
            setSelectedDistrictIdx(defaultDistrictIdx);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultDistrictIdx]);
    // Globe targeting marker — when no districts are committed, center on the project area itself.
    // (This fallback is used for globe focusing only; the card gallery stays boundary-driven.)
    const activeDistrict =
        resolvedDistricts[selectedDistrictIdx] ||
        resolvedDistricts[defaultDistrictIdx] || {
            id: 'project-area',
            name: projectLocation.name,
            state: (projectSettings?.projectBoundary as any)?.regionName || '—',
            lat: projectLocation.latitude,
            lng: projectLocation.longitude
        };

    // Extract panotrack survey telemetry
    const panotrackData = useMemo(() => {
        return extractPanotrackPoints(dailyData, batchLogs);
    }, [dailyData, batchLogs]);

    // Committed district metadata bboxes — the data-driven filter scope for the project's
    // available panotrack frames (dynamic per project, no hardcoding).
    const districtBBoxes = useMemo<Array<[number, number, number, number]>>(() => {
        const seen = new Set<string>();
        const boxes: Array<[number, number, number, number]> = [];
        resolvedDistricts.forEach((d) => {
            const meta = DISTRICT_METADATA.find((m) => m.id.toLowerCase() === d.id.toLowerCase());
            if (meta?.bbox && !seen.has(meta.id.toLowerCase())) {
                seen.add(meta.id.toLowerCase());
                boxes.push(meta.bbox);
            }
        });
        return boxes;
    }, [resolvedDistricts]);

    // Panotrack points that are actually available within the project's committed area.
    const panotrackInProject = useMemo(() => {
        const { filteredPoints } = filterPanotrackByBBoxes(panotrackData.points, panotrackData.tracks, districtBBoxes);
        return filteredPoints;
    }, [panotrackData, districtBBoxes]);

    // The single zoomed district's bbox (for the MapLibre inspect view) — defaults to the
    // whole committed area when the active district has no metadata entry.
    const activeDistrictBbox = useMemo<[number, number, number, number] | null>(() => {
        if (!activeDistrict) return null;
        const meta = DISTRICT_METADATA.find((m) => m.id.toLowerCase() === activeDistrict.id.toLowerCase());
        return meta?.bbox || null;
    }, [activeDistrict]);

    const activeDistrictPanotrack = useMemo(() => {
        if (!activeDistrictBbox) return panotrackInProject;
        const { filteredPoints } = filterPanotrackByBBoxes(panotrackData.points, panotrackData.tracks, [activeDistrictBbox]);
        return filteredPoints;
    }, [panotrackData, activeDistrictBbox, panotrackInProject]);

    const activePopupData = useMemo<PanotrackPopupData | null>(() => {
        if (!showDistrictPopup) return null;

        // Project region identity comes from the user's committed project boundary
        const boundary = projectSettings?.projectBoundary as any;
        const regionName = (boundary?.regionName) || activeDistrict?.state || 'Malaysia';
        const regionMeta = MALAYSIA_REGIONS.find((r) => r.id === boundary?.regionId);
        const zoneLabel =
            regionMeta?.group === 'Borneo'
                ? 'Borneo, Malaysia'
                : (regionMeta?.group === 'Peninsular' ? 'Peninsular Malaysia' : (boundary?.regionName || activeDistrict?.state || 'Malaysia'));

        // If no committed boundary (no districts configured), this popup shows simply the project area
        const relevantPoints = panotrackInProject.length > 0 ? panotrackInProject : panotrackData.points;
        const publishedCount = relevantPoints.filter(p => p.isPublished || p.status === 'published' || p.status === 'yes').length;
        const defectCount = relevantPoints.filter(p => p.status === 'defect' || p.color === '#ef4444' || p.qa_status === 'defect').length;
        const stagingCount = Math.max(0, relevantPoints.length - publishedCount - defectCount);

        const subgrids = Array.from(new Set(relevantPoints.map(p => p.subgrid).filter(Boolean)));
        const trackPoints: Array<[number, number]> = relevantPoints.slice(0, 60).map(p => [p.lng, p.lat]);

        // Frame & POI counts reported from REAL data only — frame count follows the app's
        // canonical getImagesProcessedCount logic (storage-verified frames), POI follows
        // getPOICount (survey track points). No location-point substitutions or estimates.
        const frames = computedFrames;
        const poi = computedPoi;

        return {
            regionName,
            stateName: activeDistrict?.state || zoneLabel,
            latitude: activeDistrict?.lat ?? 0,
            longitude: activeDistrict?.lng ?? 0,
            totalFrames: frames,
            totalPoi: poi,
            surveyMileage: computedDistance,
            pipelineSla: slaPercent,
            publishedCount,
            stagingCount,
            defectCount: defectCount > 0 ? defectCount : computedDefects,
            subgrids,
            trackPoints: trackPoints.length >= 2 ? trackPoints : undefined,
            boundaryGeojson: committedBoundary?.geojson,
            boundaryBbox: committedBoundary?.bbox,
            panotrackPoints: panotrackInProject,
        };
    }, [showDistrictPopup, activeDistrict, panotrackInProject, panotrackData, computedFrames, computedPoi, computedDistance, computedDefects, slaPercent, projectSettings, committedBoundary]);

    // Track active marker projected 2D position from EarthGlobe
    const [markerProjectedPos, setMarkerProjectedPos] = useState<{ x: number; y: number; visible: boolean } | null>(null);
    const lastProjectedPosRef = useRef<{ x: number; y: number } | null>(null);


    const handleActiveMarkerProjected = useCallback((pos: { x: number; y: number; visible: boolean }) => {
        const last = lastProjectedPosRef.current;
        if (!last || Math.abs(pos.x - last.x) > 2.5 || Math.abs(pos.y - last.y) > 2.5) {
            lastProjectedPosRef.current = { x: pos.x, y: pos.y };
            setMarkerProjectedPos(pos);
        }
    }, []);


    const globeMarkers = useMemo<GlobeMarker[]>(() => {
        // The globe shows ONLY the committed state — a single region pin. District-level
        // granularity (Segamat / Tangkak) lives in the HUD card, not on the globe.
        const stateName = activeDistrict?.state ||
            (projectSettings?.projectBoundary as any)?.regionName ||
            'Malaysia';
        const stateSlug = stateName.trim().toLowerCase();

        let lat = NaN;
        let lng = NaN;

        // 1. Always anchor to the full STATE boundary geometry — the area-weighted
        //    centroid of the real Malaysian state shape (MALAYSIA_REGIONS). This keeps
        //    the "Johor" label at the exact visual center of the state at every zoom
        //    level, instead of jumping to the committed-district corner (Segamat +
        //    Tangkak in Johor's northwest) that only matters when inspecting a district.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            const region = MALAYSIA_REGIONS.find((r) => r.name.trim().toLowerCase() === stateSlug);
            lat = region?.center ? region.center[0] : NaN;
            lng = region?.center ? region.center[1] : NaN;
        }

        // 2. Fall back to the average of the committed districts' centres — still
        //    guaranteed to sit inside the state.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            if (resolvedDistricts.length > 0) {
                lat = resolvedDistricts.reduce((acc, d) => acc + d.lat, 0) / resolvedDistricts.length;
                lng = resolvedDistricts.reduce((acc, d) => acc + d.lng, 0) / resolvedDistricts.length;
            }
        }

        // 3. Then to the fixed state metadata (guaranteed to sit inside the state),
        // so a label like "JOHOR" is never pinned to the project location outside it.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            const stateMetas = DISTRICT_METADATA.filter(
                (m) => (m.stateName || m.group || '').trim().toLowerCase() === stateSlug
            );
            if (stateMetas.length > 0) {
                lat = stateMetas.reduce((acc, m) => acc + m.center[0], 0) / stateMetas.length;
                lng = stateMetas.reduce((acc, m) => acc + m.center[1], 0) / stateMetas.length;
            }
        }

        // Last resort: the project location.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            lat = projectLocation.latitude;
            lng = projectLocation.longitude;
        }

        if (resolvedDistricts.length > 0) {
            return resolvedDistricts.map((d) => ({
                kind: 'district',
                label: d.name,
                description: `${d.name}, ${d.state}`,
                latitude: d.lat,
                longitude: d.lng,
                color: '#1d4ed8',
            }));
        }

        const n = resolvedDistricts.length;
        const description = `${stateName} • ${n} ${n === 1 ? 'district' : 'districts'} committed`;
        return [{
            kind: 'district',
            label: activeDistrict?.name || stateName,
            description,
            latitude: Number.isFinite(lat) ? lat : 3.8,
            longitude: Number.isFinite(lng) ? lng : 109.5,
            color: '#1d4ed8',
        }];
    }, [activeDistrict, resolvedDistricts, projectSettings, projectLocation.latitude, projectLocation.longitude]);

    // Anchor for the HUD leader line / beacon ring / globe centering. Never let a
    // degenerate fallback coordinate ((0,0) → Gulf of Guinea) drive it — if the active
    // district has no real location, point at the committed state pin instead.
    // While the globe is at OVERVIEW (not flying into / zoomed into a district) this
    // anchor follows the committed STATE pin (globeMarkers = area-weighted state
    // centroid), so the pulsing beacon + leader line sit at the exact state center
    // when zoomed out. Once the user dives into or wheels in on a district, it
    // switches to that district so the tagging stays on visible landmass.
    const districtAnchorLat =
        Number.isFinite(activeDistrict.lat) && (activeDistrict.lat !== 0 || activeDistrict.lng !== 0)
            ? activeDistrict.lat
            : (globeMarkers[0]?.latitude ?? activeDistrict.lat);
    const districtAnchorLng =
        Number.isFinite(activeDistrict.lng) && (activeDistrict.lat !== 0 || activeDistrict.lng !== 0)
            ? activeDistrict.lng
            : (globeMarkers[0]?.longitude ?? activeDistrict.lng);
    const inspectingDistrict = atomicGlobeFocus !== null || globeZoom >= 2.0;
    const activeLat = customCenter
        ? customCenter.lat
        : inspectingDistrict
            ? districtAnchorLat
            : (globeMarkers[0]?.latitude ?? districtAnchorLat);
    const activeLng = customCenter
        ? customCenter.lng
        : inspectingDistrict
            ? districtAnchorLng
            : (globeMarkers[0]?.longitude ?? districtAnchorLng);

    // The MapLibre globe consumes the same committed-state pins directly — the
    // marker shape is identical to EarthGlobe's, so no translation is needed.
    // The active district is emphasised so the tour's current pin is legible.
    const globeMarkersForMap = useMemo<GlobeMarker[]>(() => {
        return globeMarkers.map((m) => ({
            ...m,
            active: showDistrictPopup && m.label?.toLowerCase() === activeDistrict.name.toLowerCase()
        }));
    }, [globeMarkers, activeDistrict.name, showDistrictPopup]);

    // Focus camera directly onto active project location with smooth flight
    const handleFocusProject = useCallback((target?: { lat: number; lng: number } | React.MouseEvent | React.KeyboardEvent) => {
        const isCoord = target && typeof target === 'object' && 'lat' in target && 'lng' in target;
        const lat = isCoord ? (target as { lat: number; lng: number }).lat : activeDistrict.lat;
        const lng = isCoord ? (target as { lat: number; lng: number }).lng : activeDistrict.lng;
        setAutoRotate(false);
        setFlyTarget({
            latitude: lat,
            longitude: lng,
            zoom: 1.05,
            timestamp: Date.now(),
        });
        if (Number.isFinite(lat) && Number.isFinite(lng)) setAtomicGlobeFocus({ lat, lng });
    }, [activeDistrict]);

    // Cinematic planetary camera dive handler
    const handleInspectDistrict = useCallback((districtNameOverride?: string) => {
        if (isFlyingIn || isZoomedToDistrict) return;
        setAutoRotate(false);
        if (typeof districtNameOverride === 'string') {
            const idx = inspectableDistricts.findIndex(d => d.name.toLowerCase() === districtNameOverride.toLowerCase());
            if (idx >= 0) setSelectedDistrictIdx(idx);
        }
        setShowProjectPicker(false);
        // Align globe directly over target survey coordinates
        setCustomCenter({ lat: activeDistrict.lat, lng: activeDistrict.lng });
        setIsFlyingIn(true);

        // Planetary camera dive sequence
        setTimeout(() => {
            setIsZoomedToDistrict(true);
            setIsFlyingIn(false);
        }, 650);
    }, [isFlyingIn, isZoomedToDistrict, activeDistrict, inspectableDistricts]);

    const handleReturnToGlobe = useCallback(() => {
        setIsZoomedToDistrict(false);
        setAtomicGlobeFocus(null);
        setAutoRotate(true);
    }, []);

    // Select a district: deep-zoom the globe onto it (smooth 60 FPS fly) and open the details card
    const handleSelectDistrict = useCallback((idx: number) => {
        const d = inspectableDistricts[idx] || activeDistrict;
        if (!d) return;
        setSelectedDistrictIdx(idx);
        setShowProjectPicker(false);
        setAutoRotate(false);
        setCustomCenter({ lat: d.lat, lng: d.lng });
        // No zoom/pan snap here: the flight interpolates from the CURRENT camera
        // state to the target, avoiding any one-frame jump (stutter/shake).
        setFlyTarget({
            latitude: d.lat,
            longitude: d.lng,
            zoom: showDistrictPopup ? globeZoom : SATELLITE_FOCUS_ZOOM,
            timestamp: Date.now(),
        });
        if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) setAtomicGlobeFocus({ lat: d.lat, lng: d.lng });
        setShowDistrictPopup(true);
    }, [inspectableDistricts, activeDistrict, showDistrictPopup, globeZoom]);

    // Deselect: close the details card and glide the globe back out to the project overview
    const handleDeselectDistrict = useCallback(() => {
        setSelectedDistrictIdx(0);
        setShowDistrictPopup(false);
        setCustomCenter(null);
        setAutoRotate(false);
        setFlyTarget({
            latitude: projectLocation.latitude,
            longitude: projectLocation.longitude,
            zoom: 1.05,
            timestamp: Date.now(),
        });
        setAtomicGlobeFocus(null);
        window.setTimeout(() => setAutoRotate(true), 1500);
    }, [projectLocation]);

    return (
        <div className={`relative w-full showcase-landing text-white font-sans select-none bg-black overflow-hidden`}>

            {/* 1. Animate UI Stars Background, 3D Earth Globe & Clean Ambient Lighting */}
            <div className={`absolute inset-0 overflow-hidden ${viewMode === 'globe' ? 'pointer-events-auto' : 'pointer-events-none'}`}>
                <div className="absolute inset-0 bg-[#05070a]" />

                {/* Animate UI Stars Background (multi-depth starfield with slow, relaxed rotation) */}
                <div className={`absolute inset-0 z-0 pointer-events-none transition-transform duration-700 ease-out ${isFlyingIn ? 'scale-125' : 'scale-100'
                    }`}>
                    <div className="w-full h-full animate-spin-slow">
                        <StarsBackground
                            factor={0.035}
                            speed={55}
                            starColor="#ffffff"
                            className="w-full h-full opacity-80"
                        />
                    </div>
                </div>

                {/* The 3D Interactive Globe (vector SVG by default, switchable to the satellite WebGL globe).
                    Wrapped in a spring-driven motion layer: per-section parallax poses + scroll-velocity lean.

                    NOTE: the CSS 3D parts of this layer (rotateX + transformPerspective) only
                    apply to the VECTOR globe. A WebGL <canvas> cannot be CSS-transformed in 3D —
                    the browser warps the rendered pixels, which produced trapezoid streaks, and the
                    perspective layer swallowed pointer events so the satellite globe could not be
                    panned or rotated. The satellite globe therefore gets translation, scale and
                    opacity only; its own pitch/rotation is driven by the MapLibre camera. */}
                <motion.div
                    className={`absolute inset-0 flex items-center justify-center z-10 will-change-transform ${viewMode === 'globe' || showAtomicGlobe ? 'pointer-events-auto' : 'pointer-events-none'
                        }`}
                    style={{
                        x: globeX,
                        y: globeY,
                        scale: globeScale,
                        opacity: globeOpacity,
                        ...(showAtomicGlobe || viewMode === 'globe'
                            ? {}
                            : { rotateX: globeTilt, transformPerspective: 1600 })
                    }}
                >
                    {/* Soft atmospheric glow light behind the globe */}
                    <div
                        className="absolute pointer-events-none -z-10 select-none flex items-center justify-center transition-transform duration-300 ease-out"
                        style={{
                            transform: showAtomicGlobe
                                ? viewMode === 'modules'
                                    ? `translateY(36%) scale(${globeZoom * 1.45})`
                                    : `scale(${globeZoom})`
                                : viewMode === 'modules'
                                    ? `translateY(57%) scale(${globeZoom * 1.75})`
                                    : `scale(${globeZoom})`,
                            opacity: Math.min(1, Math.max(0.4, globeZoom / 1.05)),
                        }}
                        aria-hidden="true"
                    >
                        {/* Outer ambient aura */}
                        <div
                            className={`w-[min(115vw,880px)] h-[min(115vw,880px)] rounded-full blur-[100px] transition-all duration-700 ${showDistrictPopup ? 'opacity-15' : showAtomicGlobe ? 'opacity-25' : 'opacity-45'
                                }`}
                            style={{
                                background: showAtomicGlobe
                                    ? 'radial-gradient(circle, rgba(14, 165, 233, 0.12) 0%, rgba(30, 64, 175, 0.06) 40%, transparent 70%)'
                                    : 'radial-gradient(circle, rgba(56, 189, 248, 0.18) 0%, rgba(30, 64, 175, 0.12) 38%, rgba(15, 23, 42, 0) 70%)',
                            }}
                        />
                        {/* Core ethereal rim glow */}
                        <div
                            className={`absolute w-[min(85vw,640px)] h-[min(85vw,640px)] rounded-full blur-[65px] transition-all duration-700 ${showDistrictPopup ? 'opacity-20' : showAtomicGlobe ? 'opacity-35' : 'opacity-65'
                                }`}
                            style={{
                                background: showAtomicGlobe
                                    ? 'radial-gradient(circle, rgba(56, 189, 248, 0.20) 0%, rgba(14, 165, 233, 0.10) 36%, rgba(30, 64, 175, 0.04) 60%, transparent 70%)'
                                    : 'radial-gradient(circle, rgba(147, 197, 253, 0.24) 0%, rgba(56, 189, 248, 0.14) 35%, rgba(14, 165, 233, 0) 65%)',
                            }}
                        />
                        {/* Subtle inner highlight center bloom */}
                        <div
                            className={`absolute w-[min(50vw,400px)] h-[min(50vw,400px)] rounded-full blur-[45px] transition-all duration-700 ${showDistrictPopup ? 'opacity-10' : showAtomicGlobe ? 'opacity-28' : 'opacity-40'
                                }`}
                            style={{
                                background: showAtomicGlobe
                                    ? 'radial-gradient(circle, rgba(56, 189, 248, 0.28) 0%, rgba(14, 165, 233, 0.14) 45%, rgba(30, 64, 175, 0.04) 70%, transparent 80%)'
                                    : 'radial-gradient(circle, rgba(224, 242, 254, 0.20) 0%, rgba(56, 189, 248, 0.06) 50%, transparent 70%)',
                            }}
                        />
                    </div>

                    {showAtomicGlobe ? (
                        <div className={`w-full h-full flex items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${isFlyingIn
                            ? 'scale-[1.7] opacity-0 blur-[2px]'
                            : 'scale-100 opacity-100'
                            }`}>
                            <GlobeRenderBoundary markers={globeMarkers}>
                                <MapLibreGlobe
                                    markers={globeMarkersForMap}
                                    className="w-full h-full"
                                    viewMode={viewMode}
                                    focusTarget={atomicGlobeFocus}
                                    activeTargetCoord={{ lat: activeLat, lng: activeLng }}
                                    zoom={globeZoom}
                                    onZoomChange={setGlobeZoom}
                                    onDragStart={() => {
                                        // User grabbed the globe — only clear focus if district card is not open,
                                        // so panning while inspecting a project keeps the camera at the current zoom
                                        if (!showDistrictPopup) {
                                            setAtomicGlobeFocus(null);
                                        }
                                    }}
                                    autoRotate={!viewTransitioning && !showDistrictPopup && (viewMode === 'modules' || autoRotate)}
                                    // Degrees per second — MapLibre's own bearing unit. The
                                    // previous 0.06 was multiplied by a stray 30 inside the
                                    // globe, giving 1.8 deg/s (a 200-second turn) that read as
                                    // a frozen planet next to the vector globe's 103 deg/s.
                                    // 6 was then judged too busy for a backdrop, so this is the
                                    // calm hero drift: one full turn every ~2.4 minutes (360° / 2.5°/s = 144s).
                                    rotationSpeed={2.5}
                                    enableScrollZoom={viewMode === 'globe'}
                                    showActiveMarkerPin={showDistrictPopup}
                                    activeMarkerPinUrl="/Icon%20road%20analysis/pin.png"
                                    activeMarkerLabel={activeDistrict.name}
                                    onActiveMarkerProjected={handleActiveMarkerProjected}
                                    onMarkerClick={(marker) => {
                                        const idx = inspectableDistricts.findIndex(d => d.name.toLowerCase() === marker.label?.toLowerCase());
                                        if (idx >= 0) {
                                            if (showDistrictPopup && idx === selectedDistrictIdx) {
                                                handleDeselectDistrict();
                                            } else {
                                                handleSelectDistrict(idx);
                                            }
                                        } else if (Number.isFinite(marker.latitude) && Number.isFinite(marker.longitude)) {
                                            handleFocusProject({ lat: marker.latitude, lng: marker.longitude });
                                        }
                                    }}
                                />
                            </GlobeRenderBoundary>
                        </div>
                    ) : (
                        <div
                            className={`w-full h-full flex items-center justify-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${isFlyingIn
                                ? 'scale-[2.5] opacity-0 blur-[2px]'
                                : 'scale-100 opacity-100'
                                }`}
                            style={
                                viewMode === 'modules'
                                    ? {
                                        transform: 'translateY(66%) scale(2.15)',
                                        transformOrigin: 'center center',
                                    }
                                    : undefined
                            }
                        >
                            <EarthGlobe
                                autoRotate={viewMode === 'modules' || (autoRotate && !viewTransitioning && !showDistrictPopup)}
                                autoRotateSpeed={0.8}
                                centerLatitude={viewMode === 'modules' && !inspectingDistrict ? -26.0 : activeLat}
                                centerLongitude={viewMode === 'modules' && !inspectingDistrict ? 105.0 : activeLng}
                                flyTo={flyTarget || undefined}
                                enableDrag={true}
                                enableZoom={true}
                                enablePan={true}
                                zoom={globeZoom}
                                onZoomChange={setGlobeZoom}
                                panOffset={globePan}
                                onPanChange={setGlobePan}
                                oceanColor="#0f1318"
                                landFill="#262c34"
                                landStroke="#4a5868"
                                strokeWidth={0.85}
                                glowColor="rgba(255, 255, 255, 0.18)"
                                glowIntensity={0.65}
                                markers={globeMarkersForMap}
                                activeTargetCoord={{ lat: activeLat, lng: activeLng }}
                                onActiveMarkerProjected={handleActiveMarkerProjected}
                                onZoomIn={() => handleInspectDistrict()}
                                onMarkerClick={(marker) => {
                                    const idx = inspectableDistricts.findIndex(d => d.name.toLowerCase() === marker.label?.toLowerCase());
                                    if (idx >= 0) {
                                        // Toggle: clicking the already-selected district again → deselect + zoom out
                                        if (showDistrictPopup && idx === selectedDistrictIdx) {
                                            handleDeselectDistrict();
                                        } else {
                                            handleSelectDistrict(idx);
                                        }
                                    } else {
                                        // Available survey data marker → fly the camera to that cluster
                                        handleFocusProject({ lat: marker.latitude, lng: marker.longitude });
                                    }
                                }}
                            />
                            {/* Project Location Pin marker for vector globe when card is active */}
                            {showDistrictPopup && markerProjectedPos && markerProjectedPos.visible && !isFlyingIn && (
                                <div
                                    className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full transition-opacity duration-300"
                                    style={{
                                        left: `${markerProjectedPos.x}px`,
                                        top: `${markerProjectedPos.y}px`,
                                    }}
                                >
                                    <div className="relative flex flex-col items-center">
                                        <img
                                            src="/Icon%20road%20analysis/pin.png"
                                            alt="Project Location"
                                            className="w-9 h-9 object-contain drop-shadow-[0_4px_10px_rgba(220,38,38,0.5)] animate-in fade-in zoom-in-75 duration-300"
                                        />
                                        <div className="w-2.5 h-1 bg-black/60 rounded-full blur-[0.8px] -mt-0.5" />
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </motion.div>

                {/* Module tour videos — layered at z-15: ABOVE the globe (z-10) and still
                    behind the scrolling story (z-20), so the globe sits back behind the
                    video gallery instead of covering it. (This was z-5, which parked the
                    cards behind the sphere.)
                    Rendered on desktop only so mobile screens remain clean and unobstructed.

                    Safe to overlay a `pointer-events-auto` globe: the cards hit-test from a
                    window-level mousemove listener rather than DOM pointer events, so the
                    globe stays draggable through the gaps between cards. */}
                {viewMode === 'modules' && !isMobile && (
                    <div className={`absolute inset-0 pointer-events-none ${tourHovered ? 'z-50' : 'z-[15]'}`}>
                        <ModuleTourCards
                            modules={SYSTEM_MODULES}
                            activeSection={activeSection}
                            isMobile={isMobile}
                            onHoverChange={setTourHovered}
                            onSelectModule={handleModuleChange}
                        />
                    </div>
                )}

                {/* Atmospheric Entry HUD Badge during planetary camera dive — text only, no box or dot */}
                {isFlyingIn && (
                    <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center animate-in fade-in duration-200">
                        <div className="flex items-center gap-3 text-center select-none">
                            <Loader2 size={16} className="text-white/70 animate-spin shrink-0" />
                            <div>
                                <div className="text-xs font-bold text-white uppercase tracking-widest">
                                    Atmospheric Descent Vector
                                </div>
                                <div className="text-[10px] text-white/60 font-mono tracking-wide mt-0.5">
                                    Approaching to {activeDistrict.name} area
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Subtle vignette only in modules mode to maintain high readability */}
                {viewMode === 'modules' && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent pointer-events-none" />
                )}
            </div>

            {/* Global ambience — film grain, vignette & cursor spotlight */}
            <AmbienceLayer />

            {/* Soft upper-corner edge light — a brighter white halo bleeding
                off the far top-left corner behind the frosted header, with a
                slower secondary bloom breathing out of phase. Purely
                decorative. */}
            <div aria-hidden className="absolute inset-0 z-[1] pointer-events-none overflow-hidden">
                <div
                    className="animate-corner-flare-soft absolute -top-72 -left-72 w-[52rem] h-[52rem] rounded-full"
                    style={{
                        background:
                            'radial-gradient(closest-side, rgba(255,255,255,0.07), rgba(186,215,255,0.03) 48%, transparent 74%)',
                        filter: 'blur(48px)',
                    }}
                />
                <div
                    className="animate-corner-flare absolute -top-64 -left-64 w-[42rem] h-[42rem] rounded-full"
                    style={{
                        background:
                            'radial-gradient(closest-side, rgba(255,255,255,0.13), rgba(255,255,255,0.04) 45%, transparent 72%)',
                        filter: 'blur(38px)',
                    }}
                />
                <div
                    className="animate-corner-flare absolute -top-44 -left-44 w-[18rem] h-[18rem] rounded-full"
                    style={{
                        background:
                            'radial-gradient(closest-side, rgba(255,255,255,0.2), rgba(255,255,255,0.06) 50%, transparent 76%)',
                        filter: 'blur(30px)',
                        animationDuration: '7s',
                    }}
                />
            </div>

            {/* 2. Top Header Navbar (Module navigation centered, balanced left & right) */}
            <header className="absolute top-0 left-0 right-0 z-40 px-3 sm:px-8 py-2 sm:py-3 pt-[max(0.5rem,env(safe-area-inset-top))] sm:pt-3 flex items-center justify-between gap-2 sm:gap-4 bg-[#05070a]/60 backdrop-blur-sm sm:bg-[#05070a]/40 sm:backdrop-blur-xl border-b border-white/[0.06]">
                <motion.div
                    aria-hidden
                    style={{ scaleX: scrollYProgress }}
                    className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-sky-400/70 via-white/70 to-transparent origin-left pointer-events-none"
                />
                {/* Left: System Title */}
                <div className="flex items-center gap-2.5 xs:gap-3.5 min-w-0 z-10">
                    <GeoSphereFullLogo size={26} colorful className="shrink-0 h-4 xs:h-6 sm:h-7 w-auto pr-1" />
                    <div className="hidden sm:block h-5 w-px bg-white/20 shrink-0" />
                    <div className="min-w-0 pr-1 sm:pr-2">
                        <span className="hidden sm:block text-[11px] sm:text-xs md:text-[13px] font-medium tracking-tight text-white/90 leading-tight truncate">
                            Mobile Mapping Data Management System
                        </span>
                    </div>
                </div>

                {/* Center: Module Navigation (Strictly Centered horizontally & vertically) */}
                <nav
                    aria-label="System Modules"
                    className="hidden xl:flex items-center gap-3 2xl:gap-5 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-10"
                >
                    <LayoutGroup id="showcase-header-modules-nav">
                        {SYSTEM_MODULES.map((mod, idx) => (
                            <button
                                key={mod.id}
                                onClick={() => handleModuleChange(idx)}
                                className={`relative text-[11px] 2xl:text-xs font-medium transition-colors cursor-pointer py-1 whitespace-nowrap ${activeIndex === idx && viewMode === 'modules'
                                    ? 'text-white font-semibold'
                                    : 'text-neutral-400 hover:text-white'
                                    }`}
                            >
                                {mod.title.split('&')[0].trim()}
                                {activeIndex === idx && viewMode === 'modules' && (
                                    <motion.span
                                        layoutId="showcase-module-nav-indicator"
                                        className="absolute bottom-0 inset-x-0 h-0.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.6)] pointer-events-none"
                                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                                    />
                                )}
                            </button>
                        ))}
                    </LayoutGroup>
                </nav>

                {/* Right: View Mode Switcher + Action Buttons */}
                <div className="flex items-center gap-2 xs:gap-2.5 sm:gap-4 shrink-0 z-10">
                    {/* Vertical divider separating module navigation / system links from the 3D Earth view mode switcher */}
                    <div className="h-4 w-px bg-white/10 hidden xl:block" />

                    {/* View Mode Switcher: Clean monochromatic text tabs with Google font icons, no box button */}
                    <LayoutGroup id="showcase-view-mode-tabs">
                        <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs">
                            <button
                                onClick={() => setViewMode('globe')}
                                className={`relative py-1 transition-colors cursor-pointer flex items-center gap-1 sm:gap-1.5 ${viewMode === 'globe'
                                    ? 'text-white font-semibold'
                                    : 'text-neutral-400 hover:text-white'
                                    }`}
                            >
                                <span className="material-symbols-outlined text-[13px] sm:text-[15px] leading-none">public</span>
                                <span className="hidden xs:inline">3D Earth</span>
                                <span className="xs:hidden">Earth</span>
                                {viewMode === 'globe' && (
                                    <motion.span
                                        layoutId="showcase-view-mode-indicator"
                                        className="absolute bottom-0 inset-x-0 h-0.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.7)] pointer-events-none"
                                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                                    />
                                )}
                            </button>
                            <button
                                onClick={() => setViewMode('modules')}
                                className={`relative py-1 transition-colors cursor-pointer flex items-center gap-1 sm:gap-1.5 ${viewMode === 'modules'
                                    ? 'text-white font-semibold'
                                    : 'text-neutral-400 hover:text-white'
                                    }`}
                            >
                                <span className="material-symbols-outlined text-[13px] sm:text-[15px] leading-none">grid_view</span>
                                <span>Modules</span>
                                {viewMode === 'modules' && (
                                    <motion.span
                                        layoutId="showcase-view-mode-indicator"
                                        className="absolute bottom-0 inset-x-0 h-0.5 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.7)] pointer-events-none"
                                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                                    />
                                )}
                            </button>
                        </div>
                    </LayoutGroup>

                    <div className="h-4 w-px bg-white/10 hidden sm:block" />

                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard('auth')}
                        className="hidden sm:block text-[10px] sm:text-xs font-medium text-neutral-400 hover:text-white transition-colors cursor-pointer py-1"
                    >
                        Sign In
                    </button>
                    <button
                        onClick={() => onEnterDashboard && onEnterDashboard(current.id)}
                        className="text-[10px] sm:text-xs font-medium text-white hover:text-neutral-300 transition-colors cursor-pointer flex items-center gap-1 sm:gap-1.5 py-1 pl-0.5"
                    >
                        <span className="hidden sm:inline">Launch Workspace</span>
                        <span className="sm:hidden text-[10px] font-semibold">Launch</span>
                        <ArrowRight className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5 text-neutral-400" />
                    </button>
                </div>
            </header>

            {/* 3. Globe Mode — Telemetry HUD & Interactive Controls (internals unchanged) */}
            {viewMode === 'globe' && (
                <main className="absolute inset-x-0 top-14 sm:top-16 bottom-0 z-20 pointer-events-none">
                    <div className={`absolute inset-0 pointer-events-none p-2 sm:p-8 flex flex-col justify-between z-20 transition-opacity duration-300 ${isFlyingIn || isZoomedToDistrict ? 'opacity-0 pointer-events-none' : 'opacity-100'
                        }`}>
                        {/* Top Center Minimal Orientation Badge */}
                        <div className="w-full flex flex-col items-center pt-1 gap-1">
                            <div className="px-2 sm:px-3.5 py-1 sm:py-1.5 rounded-full bg-neutral-900/80 backdrop-blur-md border border-white/10 shadow-xl flex items-center gap-1.5 sm:gap-2">
                                <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full transition-colors duration-300 ${showDistrictPopup ? 'bg-red-500' : 'bg-white/40'
                                    }`} />
                                <span className="text-[9px] sm:text-[11px] font-mono uppercase tracking-wider text-neutral-200 font-semibold">
                                    EXPLORE AVAILABLE PROJECT AREA
                                </span>
                            </div>
                            <span className="text-[11px] text-neutral-400 font-mono tracking-wide hidden sm:block">
                                {/* MapLibre's own bindings, which are the opposite of what this
                                    label used to claim: left-drag pans, right-drag (or Ctrl-drag)
                                    rotates, shift is not a modifier. Kept in sync with the
                                    dragPan/dragRotate options in MapLibreGlobe. */}
                                {showAtomicGlobe
                                    ? 'Left-drag: Pan \u2022 Right-drag / Ctrl-drag: Rotate \u2022 Scroll: Zoom \u2022 Double-click: Reset'
                                    : 'Left-drag: Rotate \u2022 Right-drag / Shift: Pan \u2022 Scroll: Zoom \u2022 Double-click: Reset'}
                            </span>
                        </div>

                        {/* Bottom Row: Geodetic HUD (Left) & Controls (Right) */}
                        <div className="w-full flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 pb-2">
                            {/* Left Column Stack: District Popup (above) + Geodetic Telemetry Card (below) */}
                            <div className="flex flex-col items-start gap-2 max-w-[290px] sm:max-w-[340px] w-full pointer-events-auto">
                                {/* District / Project Area Card (placed directly above Project Card) */}
                                {showDistrictPopup && activePopupData && !isFlyingIn && !isZoomedToDistrict && (
                                    <div className="w-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <DistrictProjectPopup
                                            data={activePopupData}
                                            districts={resolvedDistricts.map(d => ({
                                                id: d.id,
                                                name: d.name,
                                                state: d.state,
                                                lat: d.lat,
                                                lng: d.lng,
                                                totalFrames: computedFrames,
                                                totalPoi: computedPoi,
                                                surveyMileage: computedDistance,
                                                pipelineSla: slaPercent,
                                                subgrids: activePopupData.subgrids,
                                                trackPoints: activePopupData.trackPoints,
                                            }))}
                                            activeDistrictIndex={selectedDistrictIdx}
                                            onSelectDistrict={(idx) => {
                                                handleSelectDistrict(idx);
                                            }}
                                            onClose={() => handleDeselectDistrict()}
                                            className="w-full max-h-[min(84vh,700px)]"
                                        />
                                    </div>
                                )}

                                {/* Geodetic Telemetry Card - Click to focus and display location on 3D globe */}
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                        if (showDistrictPopup) {
                                            handleDeselectDistrict();
                                        } else {
                                            setViewMode('globe');
                                            if (activeDistrict) {
                                                handleSelectDistrict(selectedDistrictIdx);
                                            }
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            if (showDistrictPopup) {
                                                handleDeselectDistrict();
                                            } else {
                                                setViewMode('globe');
                                                if (activeDistrict) {
                                                    handleSelectDistrict(selectedDistrictIdx);
                                                }
                                            }
                                        }
                                    }}
                                    className={`p-2.5 sm:p-4 rounded-2xl bg-black/75 hover:bg-black/90 backdrop-blur-xl border text-left w-full max-w-[260px] sm:max-w-[320px] pointer-events-auto shadow-2xl space-y-1 sm:space-y-1.5 cursor-pointer transition-all duration-200 group active:scale-[0.98] outline-none hover:-translate-y-0.5 ${showDistrictPopup
                                        ? 'border-red-500/70 ring-1 ring-red-500/30 shadow-[0_0_24px_rgba(239,68,68,0.25)]'
                                        : 'border-white/10 hover:border-red-500/50'
                                        }`}
                                    title="Click to rotate globe and center on project location (Toggle Panotrack Popup)"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-1.5 sm:gap-2 truncate">
                                            <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 transition-colors duration-300 ${showDistrictPopup ? 'bg-red-500' : 'bg-white/40'
                                                }`} />
                                            <span className="text-[11px] sm:text-xs font-semibold text-white tracking-wide truncate group-hover:text-red-400 transition-colors">
                                                {projectLocation.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                                            {showDistrictPopup && (
                                                <span className="text-[9px] sm:text-[10px] font-semibold text-emerald-400/90 uppercase tracking-wider shrink-0">
                                                    Active
                                                </span>
                                            )}
                                            <span className={`material-symbols-outlined text-[13px] sm:text-[15px] leading-none transition-colors shrink-0 ${showDistrictPopup ? 'text-red-400' : 'text-neutral-400 group-hover:text-white'
                                                }`} title="Toggle Panotrack District Popup">
                                                location_on
                                            </span>
                                        </div>
                                    </div>
                                    <p className="text-[10px] sm:text-[11px] text-neutral-400 font-mono">
                                        {projectLocation.subtext}
                                    </p>
                                    <div className="pt-1.5 sm:pt-2 border-t border-white/10 flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                                        <span>Target Distance</span>
                                        <span className="text-white font-mono font-semibold">{targetDistance.toLocaleString()} km</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                                        <span>Survey Mileage</span>
                                        <span className="text-white font-mono font-semibold">{computedDistance.toFixed(1)} km</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                                        <span>State</span>
                                        <span className="text-white font-mono font-semibold">{activeDistrict?.state || '—'}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] sm:text-[11px] text-neutral-400">
                                        <span>District</span>
                                        <span className="text-white font-mono font-semibold">{activeDistrict?.name || '—'}</span>
                                    </div>
                                    <div className="hidden sm:flex items-center justify-between text-[11px] text-neutral-400">
                                        <span>Project Created</span>
                                        <span className="text-white font-mono font-semibold">{projectCreatedLabel}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Quick Action Navigation Buttons */}
                            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pointer-events-auto">
                                {/* Globe Renderer Choice: Classic Vector Globe ↔ Atomic Point-Cloud Globe */}
                                <div className="flex items-center bg-neutral-900/80 backdrop-blur-md px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-lg sm:rounded-xl border border-white/10 shadow-md">
                                    <button
                                        onClick={() => {
                                            setShowAtomicGlobe(false);
                                            if (showDistrictPopup) {
                                                setFlyTarget({
                                                    latitude: activeLat,
                                                    longitude: activeLng,
                                                    zoom: globeZoom,
                                                    timestamp: Date.now(),
                                                });
                                            } else {
                                                setGlobeZoom(VECTOR_DEFAULT_ZOOM);
                                                setFlyTarget(null);
                                            }
                                        }}
                                        title="Switch to the classic vector globe"
                                        className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[9px] sm:text-[10px] font-semibold transition-colors cursor-pointer ${showAtomicGlobe ? 'text-neutral-400 hover:text-white' : 'bg-white/10 text-white'
                                            }`}
                                    >
                                        Vector
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowAtomicGlobe(true);
                                            if (!showDistrictPopup) {
                                                setGlobeZoom(viewMode === 'globe' ? FULL_GLOBE_ZOOM : INTRO_ZOOM);
                                                setFlyTarget(null);
                                            }
                                        }}
                                        title="Switch to the satellite globe"
                                        className={`px-1.5 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg text-[9px] sm:text-[10px] font-semibold transition-colors cursor-pointer ${showAtomicGlobe ? 'bg-sky-500/80 text-white' : 'text-neutral-400 hover:text-white'
                                            }`}
                                    >
                                        Satellite
                                    </button>
                                </div>

                                {/* Interactive 3D Zoom Controls */}
                                <div className="flex items-center bg-neutral-900/80 backdrop-blur-md px-1 sm:px-1.5 py-0.5 sm:py-1 rounded-lg sm:rounded-xl border border-white/10 shadow-md">
                                    <button
                                        onClick={() => setGlobeZoom(z => Math.max(0.5, +(z / 1.25).toFixed(2)))}
                                        title="Zoom Out (Scroll Down)"
                                        className="w-5 h-5 sm:w-6 sm:h-6 rounded-md sm:rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white flex items-center justify-center font-bold text-xs sm:text-sm cursor-pointer transition-colors"
                                    >
                                        -
                                    </button>
                                    <span className="text-[10px] sm:text-[11px] font-mono px-1 sm:px-2 text-neutral-300 select-none min-w-[30px] sm:min-w-[38px] text-center">
                                        {Math.round(globeZoom * 100)}%
                                    </span>
                                    <button
                                        onClick={() => setGlobeZoom(z => Math.min(8.0, +(z * 1.25).toFixed(2)))}
                                        title="Zoom In (Scroll Up)"
                                        className="w-5 h-5 sm:w-6 sm:h-6 rounded-md sm:rounded-lg hover:bg-neutral-800 text-neutral-300 hover:text-white flex items-center justify-center font-bold text-xs sm:text-sm cursor-pointer transition-colors"
                                    >
                                        +
                                    </button>
                                    {(Math.abs(globeZoom - (showAtomicGlobe ? (viewMode === 'globe' ? FULL_GLOBE_ZOOM : INTRO_ZOOM) : VECTOR_DEFAULT_ZOOM)) > 0.05 || globePan.x !== 0 || globePan.y !== 0) && (
                                        <button
                                            onClick={() => {
                                                const defaultZ = showAtomicGlobe ? (viewMode === 'globe' ? FULL_GLOBE_ZOOM : INTRO_ZOOM) : VECTOR_DEFAULT_ZOOM;
                                                setGlobeZoom(defaultZ);
                                                setGlobePan({ x: 0, y: 0 });
                                                setAtomicGlobeFocus(null);
                                                setFlyTarget(null);
                                            }}
                                            title="Reset View (Double-click)"
                                            className="ml-1 px-1 sm:px-1.5 py-0.5 text-[9px] sm:text-[10px] rounded-md bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white transition-colors cursor-pointer"
                                        >
                                            Reset
                                        </button>
                                    )}
                                </div>

                                <div className="relative">
                                    <div className="flex items-center rounded-lg sm:rounded-xl bg-red-600/90 hover:bg-red-500 shadow-lg text-white font-medium text-[11px] sm:text-xs transition-all active:scale-95">
                                        <button
                                            onClick={() => handleInspectDistrict()}
                                            className="px-2.5 sm:px-3.5 py-1 sm:py-1.5 flex items-center gap-1 sm:gap-1.5 cursor-pointer"
                                            title={`Inspect ${activeDistrict ? activeDistrict.name : 'District'} Boundary`}
                                        >
                                            <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                            <span className="hidden min-[420px]:inline">Inspect {inspectableDistricts.length > 1 ? activeDistrict.name : (resolvedDistricts.length > 0 ? (activeDistrict?.name || 'District') : 'District')}</span>
                                            <span className="min-[420px]:hidden">Inspect</span>
                                        </button>
                                        {inspectableDistricts.length > 1 && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowProjectPicker(prev => !prev);
                                                }}
                                                className="pr-2 pl-1.5 sm:pr-2.5 sm:pl-1.5 py-1 sm:py-1.5 border-l border-white/10 hover:bg-white/10 rounded-r-lg sm:rounded-r-xl cursor-pointer flex items-center"
                                                title="Choose project district to inspect"
                                            >
                                                <span className="material-symbols-outlined text-[13px] sm:text-[14px] leading-none">
                                                    {showProjectPicker ? 'arrow_drop_up' : 'arrow_drop_down'}
                                                </span>
                                            </button>
                                        )}
                                    </div>

                                    {/* Multi-Project District Popover */}
                                    {showProjectPicker && inspectableDistricts.length > 1 && (
                                        <div className="absolute bottom-full mb-2 right-0 w-60 rounded-2xl bg-black/90 backdrop-blur-xl border border-white/15 shadow-2xl p-1.5 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                                            <div className="px-2.5 py-1 text-[10px] font-mono text-neutral-400 uppercase tracking-wider border-b border-white/10 mb-1 flex items-center justify-between">
                                                <span>Select Project</span>
                                                <span className="text-white/60">{inspectableDistricts.length} Districts</span>
                                            </div>
                                            {inspectableDistricts.map((d, idx) => (
                                                <button
                                                    key={d.id}
                                                    onClick={() => {
                                                        setSelectedDistrictIdx(idx);
                                                        setShowProjectPicker(false);
                                                        handleFocusProject({ lat: d.lat, lng: d.lng });
                                                    }}
                                                    className={`w-full px-2.5 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${idx === selectedDistrictIdx
                                                        ? 'bg-red-500/20 text-white font-semibold'
                                                        : 'text-neutral-300 hover:bg-white/10 hover:text-white'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2 truncate">
                                                        <MapPin className={`w-3.5 h-3.5 shrink-0 ${idx === selectedDistrictIdx ? 'text-red-400' : 'text-neutral-400'}`} />
                                                        <span className="truncate">{d.name}</span>
                                                    </div>
                                                    <span className="text-[10px] text-neutral-400 font-mono shrink-0">{d.state}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => setAutoRotate(!autoRotate)}
                                    className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-neutral-900/80 hover:bg-neutral-800 text-[11px] sm:text-xs font-medium text-white border border-white/10 transition-colors cursor-pointer shadow-md active:scale-95 flex items-center gap-1 sm:gap-1.5"
                                >
                                    <span className="material-symbols-outlined text-[13px] sm:text-[14px] leading-none">{autoRotate ? 'pause' : 'play_arrow'}</span>
                                    <span>{autoRotate ? 'Pause' : 'Rotate'}</span>
                                </button>
                                <button
                                    onClick={() => setViewMode('modules')}
                                    className="px-3 sm:px-4 py-1 sm:py-1.5 rounded-lg sm:rounded-xl bg-white text-black font-semibold text-[11px] sm:text-xs transition-all hover:bg-neutral-200 cursor-pointer shadow-lg flex items-center gap-1 sm:gap-1.5 active:scale-95"
                                >
                                    <span className="material-symbols-outlined text-[13px] sm:text-[14px] leading-none">grid_view</span>
                                    <span>Modules</span>
                                    <ArrowRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </main>
            )}

            {/* 4. Modules Mode — premium scroll story (hero → 6 module panels → outro) */}
            <div
                ref={scrollRef}
                className={`absolute inset-0 z-20 overflow-y-auto overflow-x-hidden showcase-scrollport ${viewMode === 'modules' ? '' : 'hidden'
                    }`}
            >
                <HeroSection
                    distanceKm={computedDistance}
                    frames={computedFrames}
                    activeJobs={activeJobs}
                    sparklesReady={titleSparklesReady}
                    viewerName={viewerDisplayName}
                    onExplorePlatform={() => handleModuleChange(0)}
                    onExploreEarth={() => setViewMode('globe')}
                />

                <div ref={modulesContainerRef} className="relative w-full">
                    <InterModuleConnectors
                        totalModules={SYSTEM_MODULES.length}
                        containerRef={modulesContainerRef}
                    />
                    {SYSTEM_MODULES.map((mod, i) => (
                        <ModuleSection
                            key={mod.id}
                            mod={mod}
                            index={i}
                            total={SYSTEM_MODULES.length}
                            onEnter={(id) => handleLaunchModule(id, true)}
                        />
                    ))}
                </div>

                <WorkflowSection onJumpTo={handleModuleChange} />

                <OutroSection
                    modules={SYSTEM_MODULES}
                    onLaunch={() => handleLaunchModule(current.id)}
                    onSignIn={() => onEnterDashboard && onEnterDashboard('auth')}
                    onJumpTo={handleModuleChange}
                />
            </div>

            {/* 5. Sticky Section Rail (replaces the old footer pager) */}
            {viewMode === 'modules' && (
                <SectionRail
                    modules={SYSTEM_MODULES}
                    activeSection={activeSection}
                    progress={scrollYProgress}
                    onHome={() => scrollToSection(HERO_SECTION)}
                    onSelect={handleModuleChange}
                    onLaunch={() => handleLaunchModule(current.id)}
                />
            )}



            {/* 5. MapLibre GL District Boundary View (Active when zoomed into project district) */}
            {isZoomedToDistrict && activeDistrict && (
                <div className="absolute inset-0 z-50 animate-in fade-in zoom-in-95 duration-500">
                    <ProjectBoundaryMap
                        projectLocation={{
                            latitude: activeDistrict.lat,
                            longitude: activeDistrict.lng,
                            name: activeDistrict.name,
                            subtext: `${activeDistrict.state} • ${activeDistrict.lat.toFixed(4)}° N, ${activeDistrict.lng.toFixed(4)}° E`
                        }}
                        districtName={activeDistrict.name}
                        stateName={activeDistrict.state}
                        dailyData={dailyData}
                        panotrackPoints={activeDistrictPanotrack}
                        projectBoundary={activeProjectBoundary}
                        onReturnToGlobe={handleReturnToGlobe}
                        onEnterWorkspace={() => onEnterDashboard && onEnterDashboard(current.id)}
                    />
                </div>
            )}

            {/* 8. Cinematic Launch Portal — zoom-through transition into a workspace */}
            <LaunchPortal launch={launch} />

        </div>
    );
};