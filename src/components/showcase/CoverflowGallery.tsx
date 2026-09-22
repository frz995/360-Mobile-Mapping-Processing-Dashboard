import React, { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { SectionHotspot } from './types';
import { TiltFrame } from './TiltFrame';
import { EASE_SOFT } from './showcaseMotion';

interface CoverflowGalleryProps {
    index?: number;
    moduleId: string;
    images: string[];
    hotspots: SectionHotspot[];
}

export const CoverflowGallery: React.FC<CoverflowGalleryProps> = ({ index, moduleId, images, hotspots }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [direction, setDirection] = useState<1 | -1>(1);
    // Hidden by default: only active when user explicitly clicks a hotspot tab
    const [hotspotId, setHotspotId] = useState<string | null>(null);
    const [ratios, setRatios] = useState<Record<number, string>>({});
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

    return (
        <div
            ref={galleryWrapperRef}
            data-lenis-prevent="true"
            data-lenis-prevent-wheel="true"
            className="w-full"
        >
            {/* 1 Single Content Space */}
            <TiltFrame className="relative w-full" maxTilt={3}>
                <div
                    id={typeof index === 'number' ? `module-gallery-card-${index}` : undefined}
                    onClick={nextImage}
                    className="relative w-full rounded-xl overflow-hidden border border-white/15 bg-[#0a0e14] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.85)] cursor-pointer select-none"
                    title="Click or scroll to view next image"
                >
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={currentSrc + currentIndex}
                            initial={{ opacity: 0, y: direction * 45 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -direction * 45 }}
                            transition={{ duration: 0.32, ease: EASE_SOFT }}
                            className="relative w-full"
                        >
                            <div
                                className={`relative w-full bg-[#0a0e14] ${ratios[currentIndex] ? '' : 'aspect-video'}`}
                                style={ratios[currentIndex] ? { aspectRatio: ratios[currentIndex] } : undefined}
                            >
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
                                    className="w-full h-full object-contain object-top select-none"
                                />
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </div>
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
                                    {h.title.split(':')[0].replace(/Station \d+: /, '')}
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
        </div>
    );
};