import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { HoverBorderGradient } from '../common/HoverBorderGradient';
import { GeoSphereFullLogo } from '../common/GeoSphereLogo';
import { MagneticWrap } from './MagneticWrap';
import { ScrambleText } from './ScrambleText';
import { OUTRO_SECTION, VIEWPORT_REVEAL, revealGroup, revealItem, wordVariant } from './showcaseMotion';
import type { SystemModule } from './types';

interface OutroSectionProps {
    modules: SystemModule[];
    onLaunch: () => void;
    onSignIn: () => void;
    onJumpTo: (index: number) => void;
}

/** Closing panel: final launch CTA + quick-jump tiles for all six modules. */
export const OutroSection: React.FC<OutroSectionProps> = ({ modules, onLaunch, onSignIn, onJumpTo }) => {
    return (
        <section
            data-section-idx={OUTRO_SECTION}
            className="relative min-h-85dvh-safe snap-start flex flex-col items-center justify-center text-center px-4 sm:px-8 py-20"
        >
            <motion.div
                variants={revealGroup}
                initial="hidden"
                whileInView="show"
                viewport={VIEWPORT_REVEAL}
                className="w-full max-w-4xl flex flex-col items-center"
            >
                <motion.span
                    variants={revealItem}
                    className="text-xs sm:text-sm font-mono font-semibold tracking-[0.25em] uppercase text-sky-300/85"
                >
                    <ScrambleText text="BUILT AROUND THE MOBILE MAPPING WORKFLOW" />
                </motion.span>

                <h2
                    aria-label="From Survey Capture to Verified Data"
                    className="mt-4 text-3xl sm:text-5xl xl:text-6xl font-semibold tracking-tight leading-[1.12]"
                >
                    <span className="block">
                        {['From', 'Survey', 'Capture', 'to', 'Verified'].map((w, i) => (
                            <span key={w} className="inline-block overflow-hidden align-bottom pb-[0.06em] mr-[0.24em] last:mr-0">
                                <motion.span
                                    className="inline-block bg-gradient-to-b from-white via-white to-neutral-400 bg-clip-text text-transparent"
                                    custom={i}
                                    variants={wordVariant}
                                >
                                    {w}
                                </motion.span>
                            </span>
                        ))}
                    </span>
                    <span className="block">
                        {['Data'].map((w, i) => (
                            <span key={w} className="inline-block overflow-hidden align-bottom pb-[0.06em] mr-[0.24em] last:mr-0">
                                <motion.span
                                    className="inline-block bg-gradient-to-b from-white via-white to-neutral-400 bg-clip-text text-transparent"
                                    custom={i + 5}
                                    variants={wordVariant}
                                >
                                    {w}
                                </motion.span>
                            </span>
                        ))}
                    </span>
                </h2>

                <motion.p variants={revealItem} className="mt-4 text-xs sm:text-sm text-neutral-400 max-w-xl leading-relaxed">
                    Everything you need to manage captured data from project setup through
                    processing, validation, and delivery.
                </motion.p>

                <motion.div variants={revealItem} className="flex flex-wrap items-center justify-center gap-2 mt-6">
                    {['Import', 'Process', 'Review', 'QA/QC', 'Analyse', 'Deliver'].map((step, i) => (
                        <React.Fragment key={step}>
                            {i > 0 && <span className="text-sky-400/60 text-[10px]">→</span>}
                            <span className="font-mono text-[10px] font-medium tracking-[0.18em] uppercase text-neutral-300 px-3 py-1.5 rounded-md border border-white/[0.07] bg-white/[0.02]">
                                {step}
                            </span>
                        </React.Fragment>
                    ))}
                </motion.div>

                <motion.div variants={revealItem} className="flex flex-wrap items-center justify-center gap-3 mt-8">
                    <MagneticWrap strength={0.35} max={8}>
                        <HoverBorderGradient
                            onClick={onLaunch}
                            containerClassName="group/btn rounded-lg cursor-pointer active:scale-[0.97]"
                            className="px-6 py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 text-neutral-100"
                        >
                            <span>Launch Workspace</span>
                            <ArrowRight className="w-4 h-4 text-neutral-400 group-hover/btn:text-white transition-all group-hover/btn:translate-x-0.5" />
                        </HoverBorderGradient>
                    </MagneticWrap>
                    <button
                        onClick={onSignIn}
                        className="rounded-lg border border-white/10 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] px-5 py-3 text-xs font-medium text-neutral-300 hover:text-white transition-all cursor-pointer active:scale-[0.97]"
                    >
                        Sign In
                    </button>
                </motion.div>

                {/* Module quick-jump tiles */}
                <motion.div variants={revealItem} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 sm:gap-2 w-full mt-8 sm:mt-12 max-w-sm sm:max-w-none mx-auto">
                    {modules.map((m, i) => {
                        const Icon = m.icon;
                        return (
                            <motion.button
                                key={m.id}
                                onClick={() => onJumpTo(i)}
                                whileHover={{ y: -4 }}
                                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                                className="group flex flex-col items-center justify-center gap-1 sm:gap-2 rounded-lg sm:rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/25 px-2 py-2.5 sm:px-3 sm:py-4 cursor-pointer transition-colors"
                                title={m.title}
                            >
                                {m.iconImage ? (
                                    <img
                                        src={m.iconImage}
                                        alt=""
                                        className="icon-white w-5 h-5 sm:w-7 sm:h-7 object-contain group-hover:scale-110 transition-transform"
                                        loading="lazy"
                                    />
                                ) : (
                                    <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neutral-400 group-hover:text-sky-300 transition-colors" />
                                )}
                                <span className="text-[8px] sm:text-[9px] font-medium uppercase tracking-[0.10em] sm:tracking-[0.12em] text-neutral-400 group-hover:text-neutral-200 transition-colors leading-tight text-center">
                                    {m.title.split('&')[0].trim()}
                                </span>
                                <span className="text-[7.5px] sm:text-[8px] font-mono text-neutral-600">{String(i + 1).padStart(2, '0')}</span>
                            </motion.button>
                        );
                    })}
                </motion.div>

                <motion.div
                    variants={revealItem}
                    className="mt-14 pt-5 border-t border-white/[0.06] w-full flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-neutral-600"
                >
                    <div className="flex items-center gap-2.5 flex-wrap justify-center sm:justify-start">
                        <GeoSphereFullLogo size={22} colorful className="h-5 sm:h-6 w-auto shrink-0" />
                        <span className="font-mono tracking-wider">· MOBILE MAPPING DATA MANAGEMENT SYSTEM</span>
                    </div>
                    <span className="font-mono tracking-wider">POSTGIS · SUPABASE · MAPLIBRE GL · CUDA</span>
                </motion.div>
            </motion.div>
        </section>
    );
};
