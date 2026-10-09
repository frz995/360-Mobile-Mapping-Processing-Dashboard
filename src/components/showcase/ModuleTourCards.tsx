import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { HERO_SECTION } from './showcaseMotion';
import type { SystemModule } from './types';

interface ModuleTourCardsProps {
    modules: SystemModule[];
    activeSection: number;
    isMobile: boolean;
    /** Fires with the hovered card id (or null) so the host can restack. */
    onHoverChange?: (id: string | null) => void;
    /** Optional callback when a card in the dock is clicked to navigate to that module. */
    onSelectModule?: (index: number) => void;
}

/** Single white identity for every tour card. */
const CARD_WHITE = '#FFFFFF';

/**
 * The Atomic globe assembles from its particle cloud in ~2.2s
 * (SystemShowcase passes introDuration=2.2) plus a short mount settle — the
 * cards wait for that full transform before revealing one by one.
 */
const REVEAL_DELAY_S = 2.4;
/** Shorter hold when replaying, since the globe is already assembled. */
const REVEAL_REPLAY_DELAY_S = 0.5;
const REVEAL_STAGGER_S = 0.28;

/** The centered preview box for a hovered card. */
const previewSize = (vw: number) => {
    const w = Math.min(680, Math.max(340, Math.round(vw * 0.44)));
    return { w, h: Math.round((w * 9) / 16) + 52 };
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
    const [isLoaded, setIsLoaded] = useState(false);
    const poster = `/videos/tour-${moduleId}-poster.png`;

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        el.muted = true;
        el.defaultMuted = true;
        el.setAttribute('muted', '');
        el.playsInline = true;

        if (el.readyState >= 2) {
            setIsLoaded(true);
        }

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
        const onReady = () => {
            setIsLoaded(true);
            tryPlay();
        };
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
        <div className="absolute inset-0 w-full h-full overflow-hidden bg-[#070b12]">
            {/* Fallback poster with smooth fade-out */}
            <img
                src={poster}
                alt=""
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-out ${
                    isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
                onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                }}
                loading="lazy"
            />
            {/* Video with smooth fade-in once loaded */}
            <video
                ref={ref}
                autoPlay={active}
                loop
                muted
                playsInline
                preload={isMobile ? 'metadata' : 'auto'}
                onLoadedData={() => setIsLoaded(true)}
                onPlaying={() => setIsLoaded(true)}
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-out ${
                    isLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                data-tour-id={moduleId}
                data-testid="module-tour-video"
                aria-hidden="true"
            >
                <source src={`/videos/tour-${moduleId}.mp4`} type="video/mp4" />
            </video>
        </div>
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
    onSelectModule,
}) => {
    const [hovered, setHovered] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [revealDone, setRevealDone] = useState(false);
    const [viewport, setViewport] = useState<{ w: number; h: number }>(() => ({
        w: typeof window !== 'undefined' ? window.innerWidth : 1280,
        h: typeof window !== 'undefined' ? window.innerHeight : 800,
    }));
    const [dockAnchorY, setDockAnchorY] = useState<number | null>(null);

    useEffect(() => {
        const updateAnchor = () => {
            if (typeof document === 'undefined') return;
            const hint = document.getElementById('hero-scroll-hint');
            if (hint) {
                const rect = hint.getBoundingClientRect();
                if (rect.top > 0) {
                    setDockAnchorY(Math.round(rect.top));
                    return;
                }
            }
            setDockAnchorY(null);
        };
        updateAnchor();
        const t1 = window.setTimeout(updateAnchor, 150);
        const t2 = window.setTimeout(updateAnchor, 500);
        window.addEventListener('resize', updateAnchor);
        return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
            window.removeEventListener('resize', updateAnchor);
        };
    }, [activeSection]);
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
            (REVEAL_STAGGER_S * modules.length + 0.6) * 1000,
        );
        return () => window.clearTimeout(t);
    }, [revealed, revealDone, modules.length]);

    const layout = useMemo(() => {
        const { w: vw, h: vh } = viewport;
        const topMargin = 96;

        // Mini-card glassmorphic bottom strip above "Scroll to explore".
        const n = modules.length;
        const gap = Math.min(10, Math.max(6, Math.round(vw * 0.005)));
        // Much smaller card style: ~92px - 98px wide, ~62px - 66px high
        const desktopCardW = Math.min(96, Math.max(76, Math.floor((vw - 48 - (n - 1) * gap) / n)));
        const desktopCardH = Math.round(desktopCardW * (9 / 16) + 12);
        const dhw = desktopCardW / 2;
        const dhh = desktopCardH / 2;

        const totalDockW = n * desktopCardW + (n - 1) * gap;
        const startX = Math.round((vw - totalDockW) / 2);
        // Position directly above the "Scroll to explore" hint (with 10px breathing room)
        const dockTop = dockAnchorY != null && dockAnchorY > 0
            ? Math.max(topMargin, dockAnchorY - desktopCardH - 10)
            : Math.max(topMargin, Math.round(vh - desktopCardH - 74));

        const cards = modules.map((mod, i) => {
            const left = startX + i * (desktopCardW + gap);
            const top = dockTop;
            return {
                id: mod.id,
                left,
                top,
                cx: left + dhw,
                cy: top + dhh,
            };
        });

        return { cardW: desktopCardW, cardH: desktopCardH, cards };
    }, [viewport, modules, dockAnchorY]);

    // Hover and clicks are resolved from the document: the scrolling showcase sits ABOVE
    // this layer in z-order, so per-card pointer events would never fire.
    useEffect(() => {
        if (isMobile) return;
        const onMove = (e: MouseEvent) => {
            setHovered(cardAtPoint(layout.cards, layout.cardW, layout.cardH, e.clientX, e.clientY));
        };
        const onClick = (e: MouseEvent) => {
            const hit = cardAtPoint(layout.cards, layout.cardW, layout.cardH, e.clientX, e.clientY);
            if (hit) {
                const idx = modules.findIndex((m) => m.id === hit);
                if (idx >= 0) onSelectModule?.(idx);
            }
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('click', onClick);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('click', onClick);
        };
    }, [isMobile, layout, modules, onSelectModule]);

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

    // The preview above the scroll story has to escape BOTH the fixed backdrop's
    // stacking context and the scrollport that overlays it, so it is portaled onto
    // <body> and painted above the whole landing.
    const overlay =
        typeof document !== 'undefined'
            ? createPortal(
                <AnimatePresence>
                        {visible && hoveredMod && (
                            <motion.div
                                key={`module-tour-preview-${hoveredMod.id}`}
                                initial={{ opacity: 0, scale: 0.93, y: 12 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 6 }}
                                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                                className="fixed inset-0 z-[60] flex items-center justify-center pointer-events-none select-none"
                                aria-hidden="true"
                                data-testid="module-tour-preview"
                            >
                                <div
                                    className="relative rounded-2xl overflow-hidden border pointer-events-none"
                                    style={{
                                        width: preview.w,
                                        height: preview.h,
                                        borderColor: '#38bdf8',
                                        boxShadow: '0 30px 90px -20px rgba(0,0,0,0.95), 0 0 60px -10px rgba(56,189,248,0.3)',
                                        background: '#070b12',
                                    }}
                                >
                                    <TourVideo moduleId={hoveredMod.tourVideoId ?? hoveredMod.id} active isMobile={false} />

                                    {/* Readability scrim */}
                                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/95 via-black/50 to-transparent pointer-events-none" />

                                    {/* Identity pill */}
                                    <div className="absolute left-3 top-3 flex items-center gap-2 bg-black/70 backdrop-blur-md rounded-lg px-2.5 py-1 border border-white/15 shadow-md">
                                        {hoveredMod.iconImage ? (
                                            <img
                                                src={hoveredMod.iconImage}
                                                alt=""
                                                className="icon-white w-4 h-4 object-contain opacity-95"
                                                loading="lazy"
                                            />
                                        ) : (
                                            <span className="w-2 h-2 rounded-full bg-sky-400" />
                                        )}
                                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-sky-300">
                                            {String(hoveredIndex + 1).padStart(2, '0')}
                                        </span>
                                        <span className="text-[10px] font-medium text-white/90 uppercase tracking-wide">
                                            {hoveredMod.title.split('&')[0].trim()}
                                        </span>
                                    </div>

                                    {/* Bottom details */}
                                    <div className="absolute inset-x-0 bottom-0 px-4 pb-3 flex items-end justify-between gap-4">
                                        <div className="min-w-0">
                                            <span className="block text-sm sm:text-base font-bold text-white tracking-tight leading-snug truncate">
                                                {hoveredMod.title}
                                            </span>
                                            {hoveredMod.description && (
                                                <p className="text-[11px] text-neutral-300/85 line-clamp-1 mt-0.5">
                                                    {hoveredMod.description}
                                                </p>
                                            )}
                                        </div>
                                        <div className="shrink-0 flex items-center gap-1 text-[11px] font-medium text-sky-300 bg-sky-500/10 border border-sky-400/30 px-2.5 py-1 rounded-lg">
                                            <span>Click card to launch</span>
                                            <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>,
                document.body,
            )
            : null;

    return (
        <>
            <AnimatePresence>
            {visible && (
                <motion.div
                    key="module-tour-layer"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="absolute inset-0 pointer-events-none select-none"
                    aria-label="Module tour highlights"
                    data-testid="module-tour-layer"
                >

                    {layout.cards.map((card, i) => {
                        const mod = modules[i];
                        const shortTitle = mod.title.split('&')[0].trim();
                        const isHovered = hovered === mod.id;
                        const dimmed = hovered !== null && !isHovered;
                        // Reduced opacity at rest (0.55), dimming siblings to 0.28, full 1.0 on hover
                        const restOpacity = isHovered ? 1 : dimmed ? 0.28 : 0.55;
                        return (
                            <motion.div
                                key={mod.id}
                                onClick={() => onSelectModule?.(i)}
                                initial={{ opacity: 0, scale: 0.9, y: 14, left: card.left, top: card.top }}
                                animate={{
                                    opacity: revealed ? restOpacity : 0,
                                    scale: revealed ? (isHovered ? 1.08 : 1) : 0.9,
                                    y: revealed ? (isHovered ? -6 : 0) : 14,
                                    left: card.left,
                                    top: card.top,
                                }}
                                transition={{
                                    duration: 0.35,
                                    ease: [0.16, 1, 0.3, 1],
                                    delay: introDelayFor(i),
                                }}
                                className={`absolute rounded-lg overflow-hidden border backdrop-blur-md transition-shadow cursor-pointer ${
                                    isHovered ? 'ring-1 ring-sky-400/50' : ''
                                }`}
                                style={{
                                    width: layout.cardW,
                                    height: layout.cardH,
                                    borderColor: isHovered ? '#38bdf8' : 'rgba(255,255,255,0.12)',
                                    boxShadow: isHovered
                                        ? '0 16px 36px -8px rgba(0,0,0,0.9), 0 0 24px -4px rgba(56,189,248,0.45)'
                                        : '0 8px 20px -10px rgba(0,0,0,0.85), 0 0 12px -6px rgba(255,255,255,0.05)',
                                    zIndex: isHovered ? 35 : 15,
                                    pointerEvents: 'auto',
                                    background: '#0b1018',
                                }}
                                data-testid="module-tour-card"
                            >
                                <TourVideo moduleId={mod.tourVideoId ?? mod.id} active isMobile={isMobile} />

                                {/* Readability scrim */}
                                <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />

                                {/* Identity chip: top left */}
                                <div className="absolute left-1 top-1 flex items-center gap-0.5 bg-black/70 backdrop-blur-sm rounded px-1 py-0.5 border border-white/10">
                                    {mod.iconImage ? (
                                        <img src={mod.iconImage} alt="" className="icon-white w-2 h-2 object-contain opacity-90" loading="lazy" />
                                    ) : (
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: isHovered ? '#38bdf8' : CARD_WHITE }} />
                                    )}
                                    <span className="text-[7px] font-mono font-bold uppercase tracking-wider text-white/90">
                                        {String(i + 1).padStart(2, '0')}
                                    </span>
                                </div>

                                {/* Caption: bottom */}
                                <div className="absolute inset-x-0 bottom-0 px-1.5 pb-1">
                                    <span className="block text-[8px] sm:text-[9px] font-medium leading-tight text-white/95 truncate">
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
