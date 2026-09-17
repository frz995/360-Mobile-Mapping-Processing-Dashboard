import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { HoverBorderGradient } from '../common/HoverBorderGradient';
import { MagneticWrap } from './MagneticWrap';
import { ScrambleText } from './ScrambleText';
import { OUTRO_SECTION, VIEWPORT_REVEAL, revealGroup, revealItem } from './showcaseMotion';
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
                    className="text-[10px] font-mono font-semibold tracking-[0.3em] uppercase text-sky-300/70"
                >
                    <ScrambleText text="BUILT AROUND THE MOBILE MAPPING WORKFLOW" />
                </motion.span>

                <motion.h2
                    variants={revealItem}
                    className="mt-4 bg-gradient-to-b from-white via-white to-neutral-400 bg-clip-text text-transparent text-3xl sm:text-5xl xl:text-6xl font-semibold tracking-tight leading-[1.05]"
                >
                    From Survey Capture to Verified Data
                </motion.h2>

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
                <motion.div variants={revealItem} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 w-full mt-12">
                    {modules.map((m, i) => {
                        const Icon = m.icon;
                        return (
                            <motion.button
                                key={m.id}
                                onClick={() => onJumpTo(i)}
                                whileHover={{ y: -4 }}
                                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                                className="group flex flex-col items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/25 px-3 py-4 cursor-pointer transition-colors"
                                title={m.title}
                            >
                                {m.iconImage ? (
                                    <img
                                        src={m.iconImage}
                                        alt=""
                                        className="icon-white w-7 h-7 object-contain group-hover:scale-110 transition-transform"
                                        loading="lazy"
                                    />
                                ) : (
                                    <Icon className="w-4 h-4 text-neutral-400 group-hover:text-sky-300 transition-colors" />
                                )}
                                <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-neutral-500 group-hover:text-neutral-200 transition-colors leading-tight text-center">
                                    {m.title.split('&')[0].trim()}
                                </span>
                                <span className="text-[8px] font-mono text-neutral-700">{String(i + 1).padStart(2, '0')}</span>
                            </motion.button>
                        );
                    })}
                </motion.div>

                <motion.div
                    variants={revealItem}
                    className="mt-14 pt-5 border-t border-white/[0.06] w-full flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-neutral-600"
                >
                    <span className="font-mono tracking-wider">GEOSPHERE 360° · MOBILE MAPPING DATA MANAGEMENT SYSTEM</span>
                    <span className="font-mono tracking-wider">POSTGIS · SUPABASE · MAPLIBRE GL · CUDA</span>
                </motion.div>
            </motion.div>
        </section>
    );
};
