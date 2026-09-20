import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { globePoseFor, HERO_SECTION } from './showcaseMotion';
import type { SystemModule } from './types';

interface ModuleTourCardsProps {
    modules: SystemModule[];
    activeSection: number;
    isMobile: boolean;
    /** Fires with the hovered card id (or null) so the host can restack. */
    onHoverChange?: (id: string | null) => void;
}

/** Single white identity for every tour card. */
const CARD_WHITE = '#FFFFFF';

/** Minimum screen-space gap between a card rectangle and the globe rim. */
const GLOBE_GAP = 20;

/**
 */

/**
 * Mobile variant: the two centred cards park at the BOTTOM of the globe,
 * overlapping the lower rim (the layer sits behind the sphere, so they peek
 * out from beneath it); the rest keep the top ring.
 */
const MOBILE_SLOT_DIRS: Array<[number, number]> = [
    [-1.02, 0.0],
    [-0.8, -0.3],
    [-0.52, 0.6],
    [0.52, 0.6],
    [0.8, -0.3],
    [1.02, 0.0],
];

const slotDir = (i: number, table: Array<[number, number]>, n: number): [number, number] => {
    if (i < table.length) return table[i];
    const ux = -1.02 + (2.04 * (i + 0.5)) / n;
    return [ux, -0.57 * Math.sqrt(Math.max(0, 1 - (ux / 1.02) ** 2))];
};

/**
 * The Atomic globe assembles from its particle cloud in ~2.2s
 * (SystemShowcase passes introDuration=2.2) plus a short mount settle — the
 * cards wait for that full transform before revealing one by one.
 */
const REVEAL_DELAY_S = 2.4;
/** Shorter hold when replaying, since the globe is already assembled. */
const REVEAL_REPLAY_DELAY_S = 0.5;
const REVEAL_STAGGER_S = 0.28;

/** Tag lines: long, eased draw so the leader reads as a relaxed gesture. */
const LINE_DURATION_S = 1.25;
const LINE_EASE: [number, number, number, number] = [0.42, 0, 0.58, 1];
const LINE_DOT_DURATION_S = 0.7;

/** Clamp helper. */
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** How long a touch must be held on a card before it counts as a hover.
 *  Deliberately short — a mere press, not a "long press". */
const LONG_PRESS_MS = 200;
/** Finger drift that cancels the pending press (it was a scroll). */
const LONG_PRESS_SLOP_PX = 12;
/** Mobile hint pill: when it appears after the reveal and how long it stays. */
const TIP_DELAY_MS = 900;
const TIP_VISIBLE_MS = 7000;

/** The centred mobile preview box for a held card. */
const previewSize = (vw: number) => {
    const w = Math.min(vw - 28, 440);
    return { w, h: Math.round((w * 9) / 16) + 40 };
};

/** Id of the card under a viewport point, or null. */
const cardAtPoint = (
    cards: ReadonlyArray<{ id: string; left: number; top: number }>,
    cardW: number,
    cardH: number,
    x: number,
    y: number,
): string | null =>
    cards.find(
        (c) => x >= c.left && x <= c.left + cardW && y >= c.top && y <= c.top + cardH,
    )?.id ?? null;

/** Backoff schedule for the autoplay retries (ms). */
const PLAY_RETRY_DELAYS = [120, 300, 700, 1500, 3000];
/** Media events after which a stalled `play()` is worth re-attempting. */
const PLAY_RETRY_EVENTS = ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'stalled', 'suspend'];

/**
 * One tour video. Browsers are unreliable about honoring the `autoPlay`
 * attribute alone (especially for `<source>` children mounted lazily inside an
 * animated layer), and a `play()` that lands before the media is decodable
 * rejects and leaves the card frozen on its poster forever. So we force
 * `muted`/`playsInline`, kick playback manually, re-attempt on every media
 * readiness event, back off a few times, and finally wait for the first user
 * gesture — which is what unblocks a document-level autoplay denial.
 *
 * Playback is also `active`-driven: the web plays every card at rest, while
 * touch devices only decode the card the user is actually holding (a long
 * press), which keeps fast scrolls smooth instead of decoding six streams.
 */
const TourVideo: React.FC<{ moduleId: string; active: boolean; isMobile: boolean }> = ({
    moduleId,
    active,
    isMobile,
}) => {
    const ref = useRef<HTMLVideoElement | null>(null);
    const poster = `/videos/tour-${moduleId}-poster.png`;

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        el.muted = true;
        el.defaultMuted = true;
        el.setAttribute('muted', '');
        el.playsInline = true;

        if (!active) {
            try { el.pause(); } catch { /* jsdom / unsupported */ }
            return;
        }

        let disposed = false;
        let attempt = 0;
        let timer: number | undefined;

        const tryPlay = () => {
            if (disposed || !el.paused) return;
            let p: Promise<void> | undefined;
            try { p = el.play(); } catch { p = undefined; }
            if (!p || typeof p.catch !== 'function') return;
            p.catch(() => {
                if (disposed) return;
                if (attempt < PLAY_RETRY_DELAYS.length) {
                    timer = window.setTimeout(tryPlay, PLAY_RETRY_DELAYS[attempt++]);
                }
            });
        };

        tryPlay();
        const onReady = () => tryPlay();
        PLAY_RETRY_EVENTS.forEach((ev) => el.addEventListener(ev, onReady));
        // A policy-blocked autoplay clears on the first real interaction.
        window.addEventListener('pointerdown', onReady, { passive: true });
        window.addEventListener('touchstart', onReady, { passive: true });
        window.addEventListener('keydown', onReady);
        document.addEventListener('visibilitychange', onReady);

        return () => {
            disposed = true;
            if (timer) window.clearTimeout(timer);
            PLAY_RETRY_EVENTS.forEach((ev) => el.removeEventListener(ev, onReady));
            window.removeEventListener('pointerdown', onReady);
            window.removeEventListener('touchstart', onReady);
            window.removeEventListener('keydown', onReady);
            document.removeEventListener('visibilitychange', onReady);
        };
    }, [moduleId, active]);

    return (
        <video
            ref={ref}
            autoPlay={active}
            loop
            muted
            playsInline
            preload={isMobile ? 'metadata' : 'auto'}
            poster={poster}
            className="absolute inset-0 w-full h-full object-cover"
            data-tour-id={moduleId}
            data-testid="module-tour-video"
            aria-hidden="true"
        >
            <source src={`/videos/tour-${moduleId}.mp4`} type="video/mp4" />
        </video>
    );
};
/**
 * Six module tour videos tagged AROUND the OUTSIDE of the backdrop globe,
 * top half only (side-centre → top pair, never below the centre line). Each
 * card pops in one-by-one after the Atomic globe finishes assembling, with a
 * tag line drawing out from the globe rim to the card.
 *
 * Layering: this layer is mounted in the FIXED backdrop (z-5), i.e. behind the
 * globe (z-10) and behind the scrolling showcase content (z-20), so cards read
 * as parked behind the sphere. Because the scrollport overlays this layer,
 * hover is tracked from the document rather than per-card pointer events. A
 * geometric gap keeps every card clear of the rim; hovering lifts one card to
 * full opacity while siblings fade back.
 */
export const ModuleTourCards: React.FC<ModuleTourCardsProps> = ({
    modules,
    activeSection,
    isMobile,
    onHoverChange,
}) => {
    const [hovered, setHovered] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [revealDone, setRevealDone] = useState(false);
    const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
        w: typeof window !== 'undefined' ? window.innerWidth : 1280,
        h: typeof window !== 'undefined' ? window.innerHeight : 800,
    }));
    useEffect(() => {
        const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const visible = activeSection === HERO_SECTION;

    // Replay the whole one-by-one reveal every time the user scrolls back to
    // the hero: reset while away, then re-arm the timer on return. The first
    // pass waits for the Atomic globe to assemble; replays start promptly.
    const hasRevealedRef = useRef(false);
    const layerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!visible) {
            setRevealed(false);
            setRevealDone(false);
            setHovered(null);
            return;
        }
        const delay = hasRevealedRef.current ? REVEAL_REPLAY_DELAY_S : REVEAL_DELAY_S;
        const t = window.setTimeout(() => {
            hasRevealedRef.current = true;
            setRevealed(true);
        }, delay * 1000);
        return () => window.clearTimeout(t);
    }, [visible]);

    // Unlock hover/return animations once the one-by-one intro is over.
    useEffect(() => {
        if (!revealed || revealDone) return;
        const t = window.setTimeout(
            () => setRevealDone(true),
            (REVEAL_STAGGER_S * modules.length + LINE_DURATION_S + 0.6) * 1000,
        );
        return () => window.clearTimeout(t);
    }, [revealed, revealDone, modules.length]);

    const layout = useMemo(() => {
        const { w: vw, h: vh } = viewport;
        const pose = globePoseFor(activeSection, isMobile, vw, vh, false);
        const globeCX = vw / 2 + pose.x;
        const globeCY = vh / 2 + pose.y;
        // Match EarthGlobe's own disk radius — (min(w, h, 800) / 2 - 20) * zoom
        // (hero zoom is 1.05) — then the backdrop pose scale.
        const baseR = Math.max(20, Math.min(vw, vh, 800) / 2 - 20);
        const globeR = baseR * 1.05 * pose.scale * (isMobile ? 1.1 : 1.02);

        const cardW = isMobile ? Math.max(96, vw * 0.28) : Math.min(176, Math.max(150, vw * 0.115));
        const cardH = cardW * (9 / 16) + 18;
        const hw = cardW / 2;
        const hh = cardH / 2;

        const margin = 12;
        const topMargin = isMobile ? 72 : 96;
        const bottomMargin = 16;
        const clearance = globeR + (isMobile ? GLOBE_GAP + 8 : GLOBE_GAP + 6);
        const ringR = clearance + Math.hypot(hw, hh);

        if (!isMobile) {
            // DESKTOP: 2 Flanking Mid-Height Cards + 4 Lower-Curve Cards strictly matching user's sketch!
            // Slot 0: 01 Project Management (Mid-Left with horizontal ──o line)
            // Slot 1: 02 360° Imagery (Lower-Left Box 1 with ┌── line from globe rim)
            // Slot 2: 03 Processing Pipeline (Lower-Center-Left Box 2 with │ straight line under Johor)
            // Slot 3: 04 QA / QC (Lower-Center-Right Box 3 with │ straight line under Indonesia)
            // Slot 4: 05 GIS Workspace (Lower-Right Box 4 with ──┐ line pointing LEFT to globe)
            // Slot 5: 06 Data Management (Mid-Right with horizontal o── line)
            const getSlotType = (modId: string, idx: number): number => {
                switch (modId) {
                    case 'data':       return 0; // 01 Project Management
                    case 'qaqc':       return 1; // 02 360° Imagery (Box 1)
                    case 'production': return 2; // 03 Processing Pipeline (Box 2)
                    case 'reports':    return 3; // 04 QA / QC (Box 3)
                    case 'webgis':     return 4; // 05 GIS Workspace (Box 4)
                    case 'postgis':    return 5; // 06 Data Management
                    // Backward-compat aliases
                    case 'image':      return 1;
                    case 'pipeline':   return 2;
                    case 'gis':        return 4;
                    case 'analytics':  return 5;
                    default:           return idx % 6;
                }
            };

            // Card dimensions scaled cleanly for desktop
            const desktopCardW = Math.min(160, Math.max(126, vw * 0.10));
            const desktopCardH = desktopCardW * (9 / 16) + 18;
            const dhw = desktopCardW / 2;
            const dhh = desktopCardH / 2;

            // Slot 0 (01 Project Management): Mid-Left, outside globe rim
            const card0_right = Math.min(globeCX - globeR - 20, vw * 0.28);
            const card0_left = Math.max(margin, card0_right - desktopCardW);
            const card0_cx = card0_left + dhw;
            const card0_cy = globeCY - 0.08 * globeR;

            // Slot 5 (06 Data Management): Mid-Right, outside globe rim
            const card5_left = Math.max(globeCX + globeR + 20, vw * 0.72);
            const card5_cx = Math.min(vw - margin - dhw, card5_left + dhw);
            const card5_cy = globeCY - 0.08 * globeR;

            // Center gap between Slot 2 (Box 2) and Slot 3 (Box 3) leaves room for "Scroll to explore"
            const centerHalfGap = Math.max(28, vw * 0.024);
            const card2_cx = globeCX - centerHalfGap - dhw;
            const card2_cy = Math.min(vh - dhh - 24, globeCY + globeR * 0.62);

            const card3_cx = globeCX + centerHalfGap + dhw;
            const card3_cy = Math.min(vh - dhh - 24, globeCY + globeR * 0.62);

            // Slot 1 (02 360° Imagery - Box 1): Lower-Left, between Card 01 and Box 2
            const card1_left = Math.max(card0_left + 36, (card2_cx - dhw) - desktopCardW - Math.max(16, vw * 0.015));
            const card1_cx = card1_left + dhw;
            const card1_cy = Math.min(vh - dhh - 30, globeCY + globeR * 0.38);

            // Slot 4 (05 GIS Workspace - Box 4): Lower-Right, between Box 3 and Card 06
            const card4_right = Math.min((card5_cx + dhw) - 36, (card3_cx + dhw) + desktopCardW + Math.max(16, vw * 0.015));
            const card4_left = card4_right - desktopCardW;
            const card4_cx = card4_left + dhw;
            const card4_cy = Math.min(vh - dhh - 30, globeCY + globeR * 0.38);

            const slotCoords: Record<number, { cx: number; cy: number; left: number; top: number }> = {
                0: { cx: card0_cx, cy: card0_cy, left: card0_left, top: card0_cy - dhh },
                1: { cx: card1_cx, cy: card1_cy, left: card1_left, top: card1_cy - dhh },
                2: { cx: card2_cx, cy: card2_cy, left: card2_cx - dhw, top: card2_cy - dhh },
                3: { cx: card3_cx, cy: card3_cy, left: card3_cx - dhw, top: card3_cy - dhh },
                4: { cx: card4_cx, cy: card4_cy, left: card4_left, top: card4_cy - dhh },
                5: { cx: card5_cx, cy: card5_cy, left: card5_cx - dhw, top: card5_cy - dhh },
            };

            const cards = modules.map((mod, i) => {
                const s = getSlotType(mod.id, i);
                const pos = slotCoords[s] ?? slotCoords[i % 6];
                const left = clamp(pos.left, margin, vw - desktopCardW - margin);
                const top = clamp(pos.top, topMargin, vh - desktopCardH - bottomMargin);
                return {
                    id: mod.id,
                    left,
                    top,
                    cx: left + dhw,
                    cy: top + dhh,
                };
            });

            // Orthogonal leader lines matching user's sketch with geometric precision
            const lineAnchors = cards.map((card, i) => {
                const s = getSlotType(modules[i].id, i);
                let gx = globeCX;
                let gy = globeCY;
                let pathD = '';
                let bracketD = '';

                if (s === 0) {
                    // Slot 0 (01 Project Management): Horizontal line from globe left rim to card right edge
                    gx = globeCX - globeR;
                    gy = card.cy;
                    const cardRight = card.left + desktopCardW;
                    pathD = `M ${gx} ${gy} H ${cardRight}`;
                    bracketD = `M ${cardRight} ${card.cy - 6} L ${cardRight} ${card.cy + 6}`;
                } else if (s === 1) {
                    // Slot 1 (02 360° Imagery - Box 1): line from card top turning RIGHT towards globe
                    gy = card.top - 20;
                    const dogleg = Math.max(46, vw * 0.036);
                    gx = card.cx + dogleg;
                    pathD = `M ${gx} ${gy} H ${card.cx} V ${card.top}`;
                    bracketD = `M ${card.cx - 6} ${card.top} L ${card.cx + 6} ${card.top}`;
                } else if (s === 2) {
                    // Slot 2 (03 Processing Pipeline - Box 2): │ vertical drop under Johor to card top
                    gx = card.cx;
                    gy = card.top - 34;
                    pathD = `M ${gx} ${gy} V ${card.top}`;
                    bracketD = `M ${card.cx - 6} ${card.top} L ${card.cx + 6} ${card.top}`;
                } else if (s === 3) {
                    // Slot 3 (04 QA / QC - Box 3): │ vertical drop under Indonesia to card top
                    gx = card.cx;
                    gy = card.top - 34;
                    pathD = `M ${gx} ${gy} V ${card.top}`;
                    bracketD = `M ${card.cx - 6} ${card.top} L ${card.cx + 6} ${card.top}`;
                } else if (s === 4) {
                    // Slot 4 (05 GIS Workspace - Box 4): line from card top turning LEFT towards globe
                    gy = card.top - 20;
                    const dogleg = Math.max(46, vw * 0.036);
                    gx = card.cx - dogleg;
                    pathD = `M ${gx} ${gy} H ${card.cx} V ${card.top}`;
                    bracketD = `M ${card.cx - 6} ${card.top} L ${card.cx + 6} ${card.top}`;
                } else {
                    // Slot 5 (06 Data Management): Horizontal line from globe right rim to card left edge
                    gx = globeCX + globeR;
                    gy = card.cy;
                    const cardLeft = card.left;
                    pathD = `M ${gx} ${gy} H ${cardLeft}`;
                    bracketD = `M ${cardLeft} ${card.cy - 6} L ${cardLeft} ${card.cy + 6}`;
                }

                return { gx, gy, ax: card.cx, ay: card.cy, pathD, bracketD };
            });

            return { cardW: desktopCardW, cardH: desktopCardH, cards, globeCX, globeCY, globeR, lineAnchors };
        }

        // MOBILE FALLBACK
        const minX = margin + hw;
        const maxX = vw - margin - hw;
        const minY = topMargin + hh;
        const maxY = Math.max(globeCY, vh - bottomMargin - hh);
        const isBottomPair = (i: number) => i >= 2 && i <= 3;
        const pos = modules.map((_, i) => {
            const [ux, uy] = slotDir(i, MOBILE_SLOT_DIRS, modules.length);
            if (isBottomPair(i)) {
                return {
                    x: clamp(globeCX + ux * globeR, minX, Math.max(minX, maxX)),
                    y: clamp(globeCY + uy * globeR, minY, maxY),
                };
            }
            let x = globeCX + ux * ringR;
            let y = clamp(globeCY + uy * ringR, minY, maxY);
            return { x: clamp(x, minX, Math.max(minX, maxX)), y: clamp(y, minY, maxY) };
        });

        const cards = modules.map((mod, i) => {
            const left = clamp(pos[i].x - hw, margin, Math.max(margin, vw - cardW - margin));
            const top = clamp(pos[i].y - hh, topMargin, Math.max(topMargin, vh - cardH - bottomMargin));
            return { id: mod.id, left, top, cx: left + hw, cy: top + hh };
        });

        const lineAnchors = cards.map((card) => ({
            gx: globeCX,
            gy: globeCY,
            ax: card.cx,
            ay: card.cy,
            pathD: '',
            bracketD: '',
        }));

        return { cardW, cardH, cards, globeCX, globeCY, globeR, lineAnchors };
    }, [viewport, modules, activeSection, isMobile]);

    // Hover is resolved from the document: the scrolling showcase sits ABOVE
    // this layer in z-order, so per-card pointer events would never fire.
    useEffect(() => {
        if (isMobile) return;
        const onMove = (e: MouseEvent) => {
            setHovered(cardAtPoint(layout.cards, layout.cardW, layout.cardH, e.clientX, e.clientY));
        };
        window.addEventListener('mousemove', onMove);
        return () => window.removeEventListener('mousemove', onMove);
    }, [isMobile, layout]);

    // Touch screens have no hover at all, so a short press stands in for it:
    // hold a card for ~200ms and its preview opens, centred, with the tour
    // playing. The preview then STAYS until the user touches outside it (or
    // scrolls the story on), which is handled by the dismissal effect below.
    // Drifting past the slop counts as a scroll and cancels, so fast flicks
    // never snag a card.
    useEffect(() => {
        if (!isMobile) return;
        let pressTimer: number | undefined;
        let origin: { x: number; y: number } | null = null;

        const clearPress = () => {
            if (pressTimer) window.clearTimeout(pressTimer);
            pressTimer = undefined;
            origin = null;
        };

        const onTouchStart = (e: TouchEvent) => {
            clearPress();
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            origin = { x: t.clientX, y: t.clientY };
            pressTimer = window.setTimeout(() => {
                if (!origin) return;
                const hit = cardAtPoint(layout.cards, layout.cardW, layout.cardH, origin.x, origin.y);
                if (hit) setHovered(hit);
            }, LONG_PRESS_MS);
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!origin || e.touches.length !== 1) return;
            const t = e.touches[0];
            if (Math.hypot(t.clientX - origin.x, t.clientY - origin.y) > LONG_PRESS_SLOP_PX) clearPress();
        };

        window.addEventListener('touchstart', onTouchStart, { passive: true });
        window.addEventListener('touchmove', onTouchMove, { passive: true });
        window.addEventListener('touchend', clearPress, { passive: true });
        window.addEventListener('touchcancel', clearPress, { passive: true });
        return () => {
            clearPress();
            window.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', clearPress);
            window.removeEventListener('touchcancel', clearPress);
        };
    }, [isMobile, layout]);

    // Closing the mobile preview: a touch anywhere that is neither inside the
    // preview nor on the card that opened it dismisses it, and so does
    // scrolling the story on (the preview is fixed, so it would otherwise hang
    // over the rest of the page).
    useEffect(() => {
        if (!isMobile || !hovered) return;
        const close = () => setHovered(null);
        const onTouch = (e: TouchEvent) => {
            const t = e.touches[0];
            if (!t) return;
            const { w: pw, h: ph } = previewSize(viewport.w);
            const left = (viewport.w - pw) / 2;
            const top = (viewport.h - ph) / 2;
            const inPreview =
                t.clientX >= left && t.clientX <= left + pw && t.clientY >= top && t.clientY <= top + ph;
            const card = layout.cards.find((c) => c.id === hovered);
            const inCard =
                !!card &&
                t.clientX >= card.left && t.clientX <= card.left + layout.cardW &&
                t.clientY >= card.top && t.clientY <= card.top + layout.cardH;
            if (!inPreview && !inCard) close();
        };
        window.addEventListener('scroll', close, true);
        window.addEventListener('touchstart', onTouch, { passive: true });
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('touchstart', onTouch);
        };
    }, [isMobile, hovered, viewport, layout]);

    // Discoverability: phones have no cursor, so nothing suggests the cards are
    // pressable. Show a brief pill after the reveal; it steps aside the moment
    // the user tries a card, and never comes back this session.
    const tipDismissedRef = useRef(false);
    const [showTip, setShowTip] = useState(false);
    useEffect(() => {
        if (!isMobile || !visible || tipDismissedRef.current) {
            setShowTip(false);
            return;
        }
        const show = window.setTimeout(() => setShowTip(true), TIP_DELAY_MS);
        const hide = window.setTimeout(() => setShowTip(false), TIP_DELAY_MS + TIP_VISIBLE_MS);
        return () => {
            window.clearTimeout(show);
            window.clearTimeout(hide);
        };
    }, [isMobile, visible]);
    useEffect(() => {
        if (isMobile && hovered) {
            tipDismissedRef.current = true;
            setShowTip(false);
        }
    }, [isMobile, hovered]);

    // iOS only allows playback whose first `play()` happened inside a real
    // user gesture. The long press fires from a timer, so on the first touch we
    // "unlock" every tour video with a play→pause — after that the timed play()
    // from the long press is legal, without leaving six videos decoding.
    useEffect(() => {
        if (!isMobile) return;
        let unlocked = false;
        const unlock = () => {
            if (unlocked) return;
            unlocked = true;
            layerRef.current?.querySelectorAll('video').forEach((el) => {
                let p: Promise<void> | undefined;
                try { p = el.play(); } catch { p = undefined; }
                if (p && typeof p.then === 'function') {
                    p.then(() => { try { el.pause(); } catch { /* noop */ } }).catch(() => { /* blocked */ });
                }
            });
            window.removeEventListener('touchstart', unlock);
            window.removeEventListener('pointerdown', unlock);
        };
        window.addEventListener('touchstart', unlock, { passive: true });
        window.addEventListener('pointerdown', unlock, { passive: true });
        return () => {
            window.removeEventListener('touchstart', unlock);
            window.removeEventListener('pointerdown', unlock);
        };
    }, [isMobile]);

    // Let the parent lift this layer above the globe while a card is held.
    useEffect(() => {
        onHoverChange?.(hovered);
    }, [hovered, onHoverChange]);

    const introDelayFor = (i: number) => (revealed && !revealDone ? i * REVEAL_STAGGER_S : 0);

    const hoveredIndex = hovered ? modules.findIndex((m) => m.id === hovered) : -1;
    const hoveredMod = hoveredIndex >= 0 ? modules[hoveredIndex] : null;
    const preview = previewSize(viewport.w);

    // On mobile devices, hide floating orbit cards so the 3D globe and Hero text remain completely clean and unobstructed.
    if (isMobile) {
        return null;
    }

    // The scene above the scroll story (preview + tip) has to escape BOTH the
    // fixed backdrop's stacking context and the scrollport that overlays it, so
    // it is portaled onto <body> and painted above the whole landing.
    const overlay =
        typeof document !== 'undefined'
            ? createPortal(
                <>
                    <AnimatePresence>
                        {isMobile && visible && showTip && !hoveredMod && (
                            <motion.div
                                key="module-tour-tip"
                                initial={{ opacity: 0, x: '-50%', y: '-50%' }}
                                animate={{ opacity: 1, x: '-50%', y: '-50%' }}
                                exit={{ opacity: 0, x: '-50%', y: '-50%' }}
                                transition={{ duration: 0.45, ease: 'easeOut' }}
                                className="fixed left-1/2 top-1/2 z-[59] flex items-center gap-1.5 rounded-full border border-white/15 bg-black/70 backdrop-blur-md px-2.5 py-1 shadow-lg pointer-events-none"
                                data-testid="module-tour-tip"
                            >
                                <span className="material-symbols-outlined text-[12px] leading-none text-white/70">
                                    touch_app
                                </span>
                                <span className="text-[9px] uppercase tracking-[0.14em] text-white/80 whitespace-nowrap">
                                    Long press card to preview
                                </span>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <AnimatePresence>
                        {isMobile && visible && hoveredMod && (
                            <motion.div
                                key="module-tour-preview"
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.94 }}
                                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                                className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none"
                                aria-hidden="true"
                                data-testid="module-tour-preview"
                            >
                                <div
                                    className="relative rounded-2xl overflow-hidden border"
                                    style={{
                                        width: preview.w,
                                        height: preview.h,
                                        borderColor: CARD_WHITE,
                                        boxShadow: `0 30px 80px -30px rgba(0,0,0,0.95), 0 0 70px -18px ${CARD_WHITE}`,
                                        background: '#0b1018',
                                    }}
                                >
                                    <TourVideo moduleId={hoveredMod.id} active isMobile={isMobile} />

                                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />

                                    <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
                                        {hoveredMod.iconImage ? (
                                            <img
                                                src={hoveredMod.iconImage}
                                                alt=""
                                                className="icon-white w-4 h-4 object-contain opacity-90"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <span className="w-2 h-2 rounded-full" style={{ background: CARD_WHITE }} />
                                        )}
                                        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/85">
                                            {String(hoveredIndex + 1).padStart(2, '0')}
                                        </span>
                                    </div>

                                    <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5">
                                        <span className="block text-sm font-medium leading-tight text-white/95">
                                            {hoveredMod.title.split('&')[0].trim()}
                                        </span>
                                        <span className="mt-0.5 block text-[9px] uppercase tracking-[0.18em] text-white/55">
                                            Tap outside to close
                                        </span>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </>,
                document.body,
            )
            : null;

    return (
        <>
            <AnimatePresence>
            {visible && (
                <motion.div
                    key="module-tour-layer"
                    ref={layerRef}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="absolute inset-0 pointer-events-none select-none"
                    aria-label="Module tour highlights"
                    data-testid="module-tour-layer"
                >
                    {/* Tag lines drawing out from the globe rim to each card
                        (web only — the clutter is not welcome on small screens) */}
                    {!isMobile && (
                    <svg
                        className="absolute inset-0"
                        width={viewport.w}
                        height={viewport.h}
                        fill="none"
                        style={{ overflow: 'visible' }}
                        aria-hidden="true"
                    >
                        {layout.cards.map((_, i) => {
                            const mod = modules[i];
                            const { gx, gy, pathD, bracketD } = layout.lineAnchors[i];
                            const isHovered = hovered === mod.id;
                            const lineDim = hovered !== null && !isHovered;
                            const tagDelay = introDelayFor(i) + 0.15;
                            return (
                                <g key={`tag-${mod.id}`}>
                                    {/* Architectural dogleg elbow leader line */}
                                    <motion.path
                                        d={pathD}
                                        stroke={isHovered ? '#38bdf8' : 'rgba(255,255,255,0.45)'}
                                        strokeWidth={isHovered ? 1.5 : 1}
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        initial={{ pathLength: 0, opacity: 0 }}
                                        animate={{
                                            pathLength: revealed ? 1 : 0,
                                            opacity: revealed ? (lineDim ? 0.12 : isHovered ? 1 : 0.72) : 0,
                                        }}
                                        transition={{
                                            pathLength: {
                                                duration: LINE_DURATION_S,
                                                ease: LINE_EASE,
                                                delay: tagDelay,
                                            },
                                            opacity: {
                                                duration: revealDone ? 0.35 : LINE_DOT_DURATION_S,
                                                ease: 'easeOut',
                                                delay: revealDone ? 0 : tagDelay,
                                            },
                                        }}
                                    />

                                    {/* Card docking connector bracket */}
                                    <motion.path
                                        d={bracketD}
                                        stroke={isHovered ? '#38bdf8' : 'rgba(255,255,255,0.65)'}
                                        strokeWidth={isHovered ? 2 : 1.2}
                                        strokeLinecap="round"
                                        initial={{ opacity: 0 }}
                                        animate={{
                                            opacity: revealed ? (lineDim ? 0.12 : isHovered ? 1 : 0.75) : 0,
                                        }}
                                        transition={{
                                            duration: 0.3,
                                            delay: tagDelay + LINE_DURATION_S * 0.7,
                                        }}
                                    />

                                    {/* Outer targeting halo ring on the globe rim */}
                                    <motion.circle
                                        cx={gx}
                                        cy={gy}
                                        r={isHovered ? 6.5 : 4.5}
                                        stroke={isHovered ? '#38bdf8' : 'rgba(255,255,255,0.35)'}
                                        strokeWidth={1}
                                        fill={isHovered ? 'rgba(56,189,248,0.18)' : 'none'}
                                        initial={{ opacity: 0, scale: 0.4 }}
                                        animate={{
                                            opacity: revealed ? (lineDim ? 0.15 : isHovered ? 1 : 0.85) : 0,
                                            scale: revealed ? 1 : 0.4,
                                        }}
                                        transition={{
                                            duration: revealDone ? 0.3 : LINE_DOT_DURATION_S,
                                            ease: 'easeOut',
                                            delay: revealDone ? 0 : tagDelay,
                                        }}
                                    />

                                    {/* Inner anchor dot on the globe rim */}
                                    <motion.circle
                                        cx={gx}
                                        cy={gy}
                                        r={isHovered ? 2.8 : 2.2}
                                        fill={isHovered ? '#38bdf8' : CARD_WHITE}
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: revealed ? (lineDim ? 0.15 : 0.95) : 0 }}
                                        transition={{
                                            duration: revealDone ? 0.3 : LINE_DOT_DURATION_S,
                                            ease: 'easeOut',
                                            delay: revealDone ? 0 : tagDelay,
                                        }}
                                    />
                                </g>
                            );
                        })}
                    </svg>
                    )}

                    {layout.cards.map((card, i) => {
                        const mod = modules[i];
                        const shortTitle = mod.title.split('&')[0].trim();
                        const isHovered = hovered === mod.id;
                        const dimmed = hovered !== null && !isHovered;
                        // Translucent at rest, fully opaque on hover, faded
                        // back while a sibling is hovered.
                        const restOpacity = isHovered ? 1 : dimmed ? 0.25 : 0.62;
                        return (
                            <motion.div
                                key={mod.id}
                                initial={{ opacity: 0, scale: 0.82, y: 18, left: card.left, top: card.top }}
                                animate={{
                                    opacity: revealed ? restOpacity : 0,
                                    scale: revealed ? (isHovered && !isMobile ? 2.2 : 1) : 0.82,
                                    y: revealed ? 0 : 18,
                                    left: card.left,
                                    top: card.top,
                                }}
                                transition={{
                                    duration: 0.72,
                                    ease: [0.16, 1, 0.3, 1],
                                    delay: introDelayFor(i),
                                }}
                                className="absolute rounded-xl overflow-hidden border"
                                style={{
                                    width: layout.cardW,
                                    height: layout.cardH,
                                    borderColor: isHovered ? CARD_WHITE : `${CARD_WHITE}66`,
                                    boxShadow: `0 18px 50px -22px rgba(0,0,0,0.95), 0 0 46px -14px ${CARD_WHITE}`,
                                    zIndex: isHovered ? 25 : 1,
                                    pointerEvents: 'none',
                                    background: '#0b1018',
                                }}
                                data-testid="module-tour-card"
                            >
                                {/* Phones decode nothing in the ring itself —
                                    the centred preview owns playback there. */}
                                <TourVideo moduleId={mod.id} active={!isMobile} isMobile={isMobile} />

                                {/* Readability scrim only — card body stays opaque */}
                                <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 to-transparent pointer-events-none" />

                                {/* Identity chip */}
                                <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
                                    {mod.iconImage ? (
                                        <img src={mod.iconImage} alt="" className="icon-white w-3 h-3 object-contain opacity-90" loading="lazy" />
                                    ) : (
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: CARD_WHITE }} />
                                    )}
                                    <span className="text-[7px] font-mono uppercase tracking-[0.2em] text-white/85">
                                        {String(i + 1).padStart(2, '0')}
                                    </span>
                                </div>

                                {/* Caption */}
                                <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1">
                                    <span className="block text-[8px] font-medium leading-tight text-white/90 truncate">
                                        {shortTitle}
                                    </span>
                                </div>
                            </motion.div>
                        );
                    })}
                </motion.div>
            )}
        </AnimatePresence>
            {overlay}
        </>
    );
};
