import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { SectionHotspot } from './types';
import { TiltFrame } from './TiltFrame';
import { EASE_SOFT } from './showcaseMotion';

interface CoverflowGalleryProps {
    moduleId: string;
    images: string[];
    hotspots: SectionHotspot[];
}

/**
 * Vertical card gallery of module screenshots. Slides stack top-to-bottom in
 * a vertical scroll strip (the counterpart to the old horizontal coverflow),
 * and the Hotspot chips below the frames reveal the detail cards.
 */
export const CoverflowGallery: React.FC<CoverflowGalleryProps> = ({ moduleId, images, hotspots }) => {
    const [hotspotId, setHotspotId] = useState<string | null>(null);
    const [ratios, setRatios] = useState<Record<number, string>>({});
    const activeHotspot = hotspots.find((h) => h.id === hotspotId) || null;

    const captureRatio = (i: number, w: number, h: number) => {
        if (w > 0 && h > 0) {
            setRatios((prev) => (prev[i] === `${w}/${h}` ? prev : { ...prev, [i]: `${w}/${h}` }));
        }
    };

    if (images.length === 0) return null;

    return (
        <div className="w-full">
            <TiltFrame className="relative w-full" maxTilt={3}>
                <div className="flex flex-col gap-4 h-[340px] sm:h-[440px] xl:h-[520px] overflow-y-auto snap-y snap-mandatory showcase-scrollport pr-1">
                    {images.map((src, i) => (
                        <div
                            key={src + i}
                            className={`snap-start shrink-0 w-full rounded-xl overflow-hidden border bg-[#0a0e14] shadow-[0_18px_40px_-20px_rgba(0,0,0,0.8)] transition-colors duration-500 ${i === 0 ? 'border-white/20' : 'border-white/[0.07] hover:border-white/20'
                                }`}
                        >
<div
                            className={`relative w-full bg-[#0a0e14] ${ratios[i] ? '' : 'aspect-video'}`}
                            style={ratios[i] ? { aspectRatio: ratios[i] } : undefined}
                        >
                            <img
                                src={src}
                                alt={`${moduleId} screenshot ${i + 1}`}
                                loading="eager"
                                decoding="async"
                                draggable={false}
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    captureRatio(i, img.naturalWidth, img.naturalHeight);
                                }}
                                className="w-full h-full object-contain object-top select-none"
                            />
                        </div>
                        </div>
                    ))}
                </div>
            </TiltFrame>

            {/* Hotspot chips */}
            <div className="flex flex-wrap items-center gap-1 mt-3 px-1">
                <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-neutral-600 shrink-0 mr-1">
                    Hotspots
                </span>
                {hotspots.map((h) => {
                    const selected = hotspotId === h.id;
                    return (
                        <button
                            key={h.id}
                            onClick={() => setHotspotId(selected ? null : h.id)}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap transition-all cursor-pointer ${selected
                                    ? 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-300/30'
                                    : 'text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.05]'
                                }`}
                        >
                            {h.title.split(':')[0].replace(/Station \d+: /, '')}
                        </button>
                    );
                })}
            </div>

            {/* Hotspot detail card */}
            <AnimatePresence initial={false}>
                {activeHotspot && (
                    <motion.div
                        initial={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                        transition={{ duration: 0.3, ease: EASE_SOFT }}
                        className="mt-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] backdrop-blur-sm text-left"
                    >
                        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-white/[0.06]">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                                <span className="text-[11px] font-semibold text-neutral-200 truncate">
                                    {activeHotspot.title}
                                </span>
                                <span className="hidden sm:inline text-[9px] text-neutral-500 uppercase tracking-wider shrink-0">
                                    {activeHotspot.tag}
                                </span>
                            </div>
                            <button
                                onClick={() => setHotspotId(null)}
                                className="text-[10px] text-neutral-600 hover:text-neutral-300 cursor-pointer transition-colors shrink-0"
                            >
                                Dismiss
                            </button>
                        </div>
                        <p className="text-[11px] text-neutral-400 mt-1.5 leading-relaxed">
                            {activeHotspot.description}
                        </p>
                        <div className="mt-1.5 text-[10px] text-neutral-400">
                            <span className="text-neutral-500">Tip: </span>
                            {activeHotspot.tip}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};