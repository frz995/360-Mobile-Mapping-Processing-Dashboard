import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { SparklesCore } from '../common/Sparkles';
import { HoverBorderGradient } from '../common/HoverBorderGradient';
import { MagneticWrap } from './MagneticWrap';
import { EASE, HERO_SECTION } from './showcaseMotion';

interface HeroSectionProps {
    distanceKm?: number;
    frames?: number;
    activeJobs?: number;
    sparklesReady?: boolean;
    viewerName?: string;
    onExplorePlatform: () => void;
    onExploreEarth: () => void;
}

const wordVariant = {
    hidden: { y: '115%', opacity: 0 },
    show: (i: number) => ({
        y: '0%',
        opacity: 1,
        transition: { delay: 0.12 + i * 0.06, duration: 0.75, ease: EASE },
    }),
};

/**
 * Opening act of the scroll story: word-mask headline reveal over drifting
 * aurora light, centered title and subtitle, sparkles divider, and primary launch CTAs.
 */
export const HeroSection: React.FC<HeroSectionProps> = ({
    sparklesReady = true,
    onExplorePlatform,
    onExploreEarth,
}) => {
    return (
        <section
            data-section-idx={HERO_SECTION}
            className="relative min-h-dvh-safe snap-start flex flex-col items-center justify-center text-center px-2 xs:px-4 sm:px-8 py-16 pointer-events-none"
        >
            {/* Aurora depth field */}
            <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-[520px] h-[340px] rounded-full bg-sky-500/10 blur-[110px] animate-aurora-a" />
                <div className="absolute left-[30%] top-[40%] w-[400px] h-[280px] rounded-full bg-indigo-500/10 blur-[120px] animate-aurora-b" />
            </div>

            {/* Headline — centered, gracefully sized and fitted with reliable in-view replay */}
            <motion.div
                initial="hidden"
                whileInView="show"
                viewport={{ once: false, amount: 0.15 }}
                className="relative z-10 w-full max-w-xl sm:max-w-2xl md:max-w-3xl lg:max-w-4xl mx-auto px-1 sm:px-2"
            >
                <h1
                    aria-label="Mobile Mapping Data, Manage in One Place"
                    className="text-[25px] xs:text-[28px] sm:text-4xl md:text-5xl lg:text-[52px] font-bold tracking-tight text-white leading-[1.16] sm:leading-[1.15]"
                >
                    <span className="block whitespace-nowrap">
                        {['Mobile', 'Mapping', 'Data,', 'Manage', 'in'].map((w, i) => (
                            <span key={w} className="inline-block overflow-hidden align-bottom pb-[0.06em] mr-[0.24em] last:mr-0">
                                <motion.span
                                    className="inline-block text-white"
                                    custom={i}
                                    variants={wordVariant}
                                >
                                    {w}
                                </motion.span>
                            </span>
                        ))}
                    </span>
                    <span className="block">
                        {['One', 'Place'].map((w, i) => (
                            <span key={w} className="inline-block overflow-hidden align-bottom pb-[0.06em] mr-[0.24em] last:mr-0">
                                <motion.span
                                    className="inline-block text-white"
                                    custom={i + 5}
                                    variants={wordVariant}
                                >
                                    {w}
                                </motion.span>
                            </span>
                        ))}
                    </span>
                </h1>

                <motion.p
                    variants={{
                        hidden: { opacity: 0, y: 14 },
                        show: {
                            opacity: 1,
                            y: 0,
                            transition: { delay: 0.45, duration: 0.75, ease: EASE },
                        },
                    }}
                    className="mt-3 sm:mt-4 text-xs sm:text-sm md:text-base font-medium tracking-wide text-neutral-300/85 max-w-lg sm:max-w-xl mx-auto text-balance"
                >
                    A practical workspace for mobile mapping operations.
                </motion.p>
            </motion.div>

            {/* Sparkles emitter line */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.65, duration: 0.9 }}
                className="relative z-10 w-full max-w-xs sm:max-w-md mx-auto h-6 sm:h-8 my-3 sm:my-4"
            >
                <div className="absolute left-0 right-0 mx-auto top-0 bg-gradient-to-r from-transparent via-indigo-500 to-transparent h-px w-3/4" />
                <div className="absolute left-0 right-0 mx-auto top-0 bg-gradient-to-r from-transparent via-sky-500 to-transparent h-[2px] w-1/4" />
                <div aria-hidden className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-64 h-32 pointer-events-none">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-32 h-10 rounded-full bg-sky-400/25 blur-xl" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-48 h-16 rounded-full bg-sky-500/10 blur-2xl" />
                </div>
                {sparklesReady && (
                    <div className="absolute inset-0 w-full h-full [mask-image:radial-gradient(ellipse_48%_175%_at_50%_0%,black_42%,transparent_78%)]">
                        <SparklesCore
                            id="tsparticlesfullpage"
                            background="transparent"
                            minSize={0.4}
                            maxSize={1}
                            particleDensity={900}
                            className="w-full h-full"
                            particleColor="#FFFFFF"
                        />
                    </div>
                )}
            </motion.div>

            {/* CTAs */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8, duration: 0.75, ease: EASE }}
                className="relative z-10 flex flex-wrap items-center justify-center gap-2.5 sm:gap-3.5 pointer-events-auto"
            >
                <MagneticWrap>
                    <HoverBorderGradient
                        onClick={onExplorePlatform}
                        containerClassName="group/btn rounded-lg cursor-pointer active:scale-[0.97]"
                        className="px-3.5 py-2 sm:px-5 sm:py-2.5 rounded-lg font-medium text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 text-neutral-100"
                    >
                        <span>Explore Platform</span>
                        <ArrowRight className="w-3.5 h-3.5 text-neutral-400 group-hover/btn:text-white transition-all group-hover/btn:translate-x-0.5" />
                    </HoverBorderGradient>
                </MagneticWrap>
                <button
                    onClick={onExploreEarth}
                    className="group flex items-center gap-1.5 sm:gap-2 rounded-lg border border-white/10 hover:border-white/30 bg-white/[0.03] hover:bg-white/[0.08] px-3.5 py-2 sm:px-4 sm:py-2.5 text-xs font-medium text-neutral-300 hover:text-white transition-all cursor-pointer active:scale-[0.97]"
                >
                    <span className="material-symbols-outlined text-[14px] sm:text-[15px] leading-none text-neutral-400 group-hover:text-sky-300 transition-colors">public</span>
                    <span>Explore 3D Earth</span>
                </button>
            </motion.div>

            {/* Scroll hint — pinned to bottom */}
            <div className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-0 right-0 flex justify-center pointer-events-none">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.0, duration: 0.8 }}
                    className="flex flex-col items-center gap-1 text-white"
                >
                    <span className="text-[9px] tracking-[0.3em] uppercase text-white/70">Scroll to explore</span>
                    <img
                        src="/icon animation/Arrow.svg"
                        alt=""
                        className="w-7 h-7 drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]"
                    />
                </motion.div>
            </div>
        </section>
    );
};

