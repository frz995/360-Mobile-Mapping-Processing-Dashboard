import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, LayoutGroup } from 'framer-motion';
import { X, ZoomIn, ChevronLeft, ChevronRight } from 'lucide-react';
import type { SectionHotspot } from './types';
import { TiltFrame } from './TiltFrame';
import { EASE_SOFT } from './showcaseMotion';

interface CoverflowGalleryProps {
    index?: number;
    moduleId: string;
    moduleTitle?: string;
    moduleSubtitle?: string;
    moduleDescription?: string;
    images: string[];
    hotspots: SectionHotspot[];
}

export const CoverflowGallery: React.FC<CoverflowGalleryProps> = ({
    index,
    moduleId,
    moduleTitle,
    moduleSubtitle: _moduleSubtitle,
    moduleDescription: _moduleDescription,
    images,
    hotspots
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [direction, setDirection] = useState<1 | -1>(1);
    const isTest = (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') || 
        ((globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } })?.process?.env?.NODE_ENV === 'test');
    const [expanded, setExpanded] = useState(false);
    // Hidden by default: only active when user explicitly clicks a hotspot tab
    const [hotspotId, setHotspotId] = useState<string | null>(null);
    const [ratios, setRatios] = useState<Record<number, string>>({});
    // Screenshots that failed to load (missing asset) render a pending slot.
    const [failed, setFailed] = useState<Record<number, boolean>>({});
    const activeHotspot = hotspotId ? (hotspots.find((h) => h.id === hotspotId) || null) : null;
    const lastWheelTimeRef = useRef(0);
    const galleryWrapperRef = useRef<HTMLDivElement | null>(null);

    const captureRatio = (i: number, w: number, h: number) => {
        if (w > 0 && h > 0) {
            setRatios((prev) => (prev[i] === `${w}/${h}` ? prev : { ...prev, [i]: `${w}/${h}` }));
        }
    };

    const prevImage = () => {
        setDirection(-1);
        setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    };

    const nextImage = () => {
        setDirection(1);
        setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    };

    // Keyboard navigation when expanded lightbox is open
    useEffect(() => {
        if (!expanded) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setExpanded(false);
            } else if (e.key === 'ArrowRight' && images.length > 1) {
                nextImage();
            } else if (e.key === 'ArrowLeft' && images.length > 1) {
                prevImage();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [expanded, images.length]);

    // The showcase binds ArrowLeft/ArrowRight to its own section navigation on
    // window. Flag the open lightbox so that handler stands down while this one
    // has the keys; a press must not both page the screenshot and jump a section.
    useEffect(() => {
        if (!expanded) return;
        document.body.classList.add('gallery-lightbox-open');
        return () => document.body.classList.remove('gallery-lightbox-open');
    }, [expanded]);

    // Non-passive native wheel listener: isolates gallery scrolling and prevents outer page scroll
    useEffect(() => {
        const el = galleryWrapperRef.current;
        if (!el) return;

        const onWheelNative = (e: WheelEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (images.length <= 1) return;
            const now = Date.now();
            if (now - lastWheelTimeRef.current < 400) return;

            if (Math.abs(e.deltaY) > 10 || Math.abs(e.deltaX) > 10) {
                lastWheelTimeRef.current = now;
                if (e.deltaY > 0 || e.deltaX > 0) {
                    nextImage();
                } else {
                    prevImage();
                }
            }
        };

        el.addEventListener('wheel', onWheelNative, { passive: false });
        return () => {
            el.removeEventListener('wheel', onWheelNative);
        };
    }, [images.length]);

    if (images.length === 0) return null;

    const currentSrc = images[currentIndex] || images[0];


    // Smooth expandable card popup overlay portaled to document.body (Shadix UI layoutId pattern)
    const expandedModal = typeof document !== 'undefined' && createPortal(
        <AnimatePresence initial={false} mode="sync">
            {expanded && (
                <motion.div
                    key="gallery-expand-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 md:p-8 select-none overflow-y-auto"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${moduleTitle || moduleId} expandable card`}
                    data-testid="gallery-image-popup"
                >
                    {/* Background Dimming Overlay - Tones down light without blacking out content */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22, ease: 'easeOut' }}
                        onClick={() => setExpanded(false)}
                        className="fixed inset-0 bg-black/20 cursor-zoom-out"
                        data-testid="gallery-popup-backdrop"
                    />

                    {/* Centered Expandable Card sharing layoutId for seamless physical expansion */}
                    <motion.div
                        layoutId={isTest ? undefined : `module-expandable-card-${moduleId}`}
                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-fit max-w-[92vw] 2xl:max-w-[1400px] max-h-[85vh] rounded-2xl sm:rounded-3xl overflow-hidden border border-white/20 bg-[#090d14] shadow-[0_30px_90px_-15px_rgba(0,0,0,0.95),0_15px_35px_-10px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.14)] my-auto z-10 select-none"
                        style={{ willChange: 'transform, opacity', transform: 'translateZ(0)' }}
                    >
                        {/* Upper Section: Expanded Image Canvas (zero-gap flush fit, instant snapshot switch) */}
                        <div className="relative w-fit h-fit overflow-hidden">
                            {/* Image Display - Instant switch on Prev/Next with Zero Gap (No slide animation) */}
                            {failed[currentIndex] ? (
                                <div className="w-[80vw] max-w-[1000px] aspect-video flex flex-col items-center justify-center gap-3 text-neutral-400 select-none p-12">
                                    <span className="material-symbols-outlined text-4xl text-neutral-500">add_photo_alternate</span>
                                    <span className="text-xs uppercase tracking-widest text-neutral-400">Screenshot pending</span>
                                    <span className="text-[11px] font-mono text-neutral-500">{currentSrc}</span>
                                </div>
                            ) : (
                                <img
                                    src={currentSrc}
                                    alt={`${moduleTitle || moduleId} screenshot ${currentIndex + 1}`}
                                    className="block w-auto h-auto max-w-[92vw] 2xl:max-w-[1400px] max-h-[85vh] object-contain select-none"
                                    draggable={false}
                                />
                            )}

                            {/* Left Navigation Chevron */}
                            {images.length > 1 && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        prevImage();
                                    }}
                                    className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/60 hover:bg-black/85 border border-white/20 text-white flex items-center justify-center backdrop-blur-md shadow-xl transition-all hover:scale-110 active:scale-95 cursor-pointer z-20"
                                    title="Previous screenshot (Left arrow)"
                                    aria-label="Previous screenshot"
                                >
                                    <ChevronLeft size={22} />
                                </button>
                            )}

                            {/* Right Navigation Chevron */}
                            {images.length > 1 && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        nextImage();
                                    }}
                                    className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/60 hover:bg-black/85 border border-white/20 text-white flex items-center justify-center backdrop-blur-md shadow-xl transition-all hover:scale-110 active:scale-95 cursor-pointer z-20"
                                    title="Next screenshot (Right arrow)"
                                    aria-label="Next screenshot"
                                >
                                    <ChevronRight size={22} />
                                </button>
                            )}

                            {/* Floating Unified Snapshot Counter & Dot Indicators */}
                            <div className="absolute bottom-3.5 inset-x-0 flex items-center justify-center pointer-events-none z-20">
                                <div className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 border border-white/15 backdrop-blur-md shadow-lg">
                                    <span className="text-[10px] font-mono text-neutral-300">
                                        Snapshot {currentIndex + 1} of {images.length}
                                    </span>
                                    {images.length > 1 && (
                                        <div className="flex items-center gap-1.5 pl-2 border-l border-white/20">
                                            {images.map((_, dotIdx) => (
                                                <button
                                                    key={dotIdx}
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDirection(dotIdx > currentIndex ? 1 : -1);
                                                        setCurrentIndex(dotIdx);
                                                    }}
                                                    className={`transition-all rounded-full cursor-pointer ${
                                                        dotIdx === currentIndex
                                                            ? 'w-4 h-1.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]'
                                                            : 'w-1.5 h-1.5 bg-white/40 hover:bg-white/70'
                                                    }`}
                                                    title={`Go to screenshot ${dotIdx + 1}`}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body
    );

    return (
        <LayoutGroup id={`expandable-card-group-${moduleId}`}>
            <div
                ref={galleryWrapperRef}
                data-lenis-prevent="true"
                data-lenis-prevent-wheel="true"
                className="w-full"
            >
                {/* 1 Single Content Space */}
                <TiltFrame className="relative w-full" maxTilt={expanded ? 0 : 3}>
                    <motion.div
                        layoutId={isTest ? undefined : `module-expandable-card-${moduleId}`}
                        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
                        id={typeof index === 'number' ? `module-gallery-card-${index}` : undefined}
                        onClick={() => setExpanded(true)}
                        className="group relative w-full rounded-2xl overflow-hidden border border-white/15 bg-[#0a0e14] shadow-[0_16px_36px_-10px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)] hover:shadow-[0_24px_55px_-12px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.18)] transition-shadow duration-300 cursor-zoom-in select-none"
                        title="Click to expand card (or scroll to cycle)"
                        style={{ willChange: 'transform, opacity', transform: 'translateZ(0)' }}
                    >
                        {/* Expand badge visible on hover */}
                        <div className="absolute top-2.5 right-2.5 z-20 px-2.5 py-1 rounded-full bg-black/65 backdrop-blur-md border border-white/20 text-[10px] text-white/90 opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center gap-1.5 shadow-lg pointer-events-none transform -translate-y-1 group-hover:translate-y-0">
                            <ZoomIn size={12} className="text-sky-400" />
                            <span className="font-medium tracking-wide">Click to expand</span>
                        </div>

                        <AnimatePresence mode="wait" initial={false}>
                            <motion.div
                                key={expanded ? 'thumbnail-frozen' : (currentSrc + currentIndex)}
                                initial={expanded ? false : { opacity: 0, y: direction * 45 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={expanded ? undefined : { opacity: 0, y: -direction * 45 }}
                                transition={{ duration: 0.32, ease: EASE_SOFT }}
                                className="relative w-full"
                            >
                                <div
                                    className={`relative w-full bg-[#0a0e14] ${ratios[currentIndex] ? '' : 'aspect-video'}`}
                                    style={ratios[currentIndex] ? { aspectRatio: ratios[currentIndex] } : undefined}
                                >
                                    {failed[currentIndex] ? (
                                        <div
                                            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-500 select-none"
                                            data-testid="screenshot-pending"
                                        >
                                            <span className="material-symbols-outlined text-3xl leading-none">add_photo_alternate</span>
                                            <span className="text-[10px] uppercase tracking-[0.2em]">Screenshot pending</span>
                                            <span className="text-[10px] font-mono text-neutral-600 px-4 truncate max-w-full">{currentSrc}</span>
                                        </div>
                                    ) : (
                                        <img
                                            src={currentSrc}
                                            alt={`${moduleId} screenshot ${currentIndex + 1}`}
                                            loading="eager"
                                            decoding="async"
                                            draggable={false}
                                            onLoad={(e) => {
                                                const img = e.currentTarget;
                                                captureRatio(currentIndex, img.naturalWidth, img.naturalHeight);
                                            }}
                                            onError={() => setFailed((prev) => ({ ...prev, [currentIndex]: true }))}
                                            className="w-full h-full object-contain object-top select-none"
                                        />
                                    )}
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </motion.div>
                </TiltFrame>

            {/* Hotspot Detail Card (hidden by default; shown only when a tab is clicked, zero bounce) */}
            {activeHotspot && (
                <div
                    key={activeHotspot.id}
                    className="mt-3.5 p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-md shadow-xl text-left"
                >
                    <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-white/[0.06]">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0 shadow-sm shadow-sky-400/50" />
                            <span className="text-[11.5px] font-semibold text-neutral-200 truncate">
                                {activeHotspot.title}
                            </span>
                            <span className="hidden sm:inline text-[9px] text-neutral-500 uppercase tracking-wider shrink-0">
                                {activeHotspot.tag}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setHotspotId(null)}
                            className="p-1 -mr-1 rounded hover:bg-white/10 text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
                            title="Close details"
                        >
                            <X size={12} />
                        </button>
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-1.5 leading-relaxed">
                        {activeHotspot.description}
                    </p>
                    {activeHotspot.tip && (
                        <div className="mt-1.5 text-[10px] text-neutral-400">
                            <span className="text-neutral-500">Tip: </span>
                            {activeHotspot.tip}
                        </div>
                    )}
                </div>
            )}

            {/* Hotspot tabs with divider (no HOTSPOTS text) */}
            {hotspots.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-y-1.5 mt-3 px-1 text-center">
                    {hotspots.map((h, idx) => {
                        const selected = activeHotspot?.id === h.id;
                        return (
                            <React.Fragment key={h.id}>
                                {idx > 0 && (
                                    <span aria-hidden className="w-px h-3 bg-white/15 mx-1.5 shrink-0" />
                                )}
                                <button
                                    type="button"
                                    onClick={() => setHotspotId((prev) => (prev === h.id ? null : h.id))}
                                    className={`px-2 py-0.5 rounded-md text-[10.5px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                                        selected
                                            ? 'bg-sky-400/20 text-sky-200 ring-1 ring-sky-300/40 shadow-sm shadow-sky-400/20'
                                            : 'text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.05]'
                                    }`}
                                >
                                    {h.title.split(':')[0]}
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}

            {/* "Scroll to view gallery" Navigation Hint */}
            {images.length > 1 && (
                <div className="flex flex-col items-center justify-center mt-3 text-white">
                    <button
                        type="button"
                        onClick={nextImage}
                        className="group flex flex-col items-center gap-1 cursor-pointer select-none transition-transform hover:scale-105 active:scale-95 focus:outline-none"
                        title="Scroll or click to view next image"
                    >
                        <span className="text-[9px] tracking-[0.3em] uppercase text-white/70 group-hover:text-sky-300 transition-colors">
                            Scroll to view gallery
                        </span>
                        <img
                            src="/icon animation/Arrow.svg"
                            alt=""
                            className="w-7 h-7 drop-shadow-[0_0_12px_rgba(255,255,255,0.25)] group-hover:brightness-125 transition-all"
                        />
                    </button>
                </div>
            )}

            {/* Lightbox Modal */}
            {expandedModal}
        </div>
    </LayoutGroup>
    );
};