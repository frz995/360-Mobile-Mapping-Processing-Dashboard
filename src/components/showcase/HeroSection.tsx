import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { SparklesCore } from '../common/Sparkles';
import { HoverBorderGradient } from '../common/HoverBorderGradient';
import { CountUp } from './CountUp';
import { MagneticWrap } from './MagneticWrap';
import { EASE, HERO_SECTION } from './showcaseMotion';

interface HeroSectionProps {
    distanceKm: number;
    frames: number;
    activeJobs: number;
    sparklesReady: boolean;
    viewerName: string;
    onLaunch: () => void;
    onExplore3D: () => void;
}

const MARQUEE_ITEMS = [
    'Executive Dashboard & Spatial Telemetry',
    'Data Management & Masterlist Ledgers',
    'Production Workspace, NAS & Lineage',
    'Panoramic StreetView & QA/QC Defect Workspace',
    'PostGIS Spatial Hub & Vector Layer Staging',
    'Executive Reports, Audit Trail & RBAC Governance',
];

const wordVariant = {
    hidden: { y: '115%' },
    show: (i: number) => ({
        y: '0%',
        transition: { delay: 0.25 + i * 0.09, duration: 0.95, ease: EASE },
    }),
};

/**
 * Opening act of the scroll story: word-mask headline reveal over drifting
 * aurora light, live count-up telemetry, tech-stack marquee and the primary
 * launch CTAs. The backdrop globe shines at full presence behind this panel.
 */
export const HeroSection: React.FC<HeroSectionProps> = ({
    distanceKm,
    frames,
    activeJobs,
    sparklesReady,
    viewerName,
    onLaunch,
    onExplore3D,
}) => {
    const marquee = [...MARQUEE_ITEMS, `Photo-Sphere · ${viewerName}`];

    return (
        <section
            data-section-idx={HERO_SECTION}
            className="relative min-h-dvh-safe snap-start flex flex-col items-center justify-start sm:justify-center text-center px-4 sm:px-8 pt-16 sm:pt-24 pb-8 sm:pb-10 pointer-events-none"
        >
            {/* Aurora depth field */}
            <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute left-1/2 top-[16%] -translate-x-1/2 w-[560px] h-[380px] rounded-full bg-sky-500/10 blur-[110px] animate-aurora-a" />
                <div className="absolute left-[28%] top-[42%] w-[420px] h-[320px] rounded-full bg-indigo-500/10 blur-[120px] animate-aurora-b" />
            </div>

            {/* Headline — per-word mask reveal */}
            <h1
                aria-label="GeoSphere 360°"
                className="relative z-10 mt-2 sm:mt-5 text-3xl sm:text-6xl xl:text-7xl font-bold tracking-tight bg-gradient-to-b from-white via-white to-white/55 bg-clip-text text-transparent"
            >
                {['GeoSphere', '360°'].map((w, i) => (
                    <span key={w} className="inline-block overflow-hidden align-bottom pb-[0.08em] mr-[0.28em] last:mr-0">
                        <motion.span
                            className="inline-block"
                            custom={i}
                            variants={wordVariant}
                            initial="hidden"
                            animate="show"
                        >
                            {w}
                        </motion.span>
                    </span>
                ))}
            </h1>

            <motion.span
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.8, ease: EASE }}
                className="relative z-10 block mt-2 text-xs sm:text-base xl:text-lg font-semibold tracking-wide text-neutral-300"
            >
                A Cloud-Native Mobile Mapping Platform.
            </motion.span>

            <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.62, duration: 0.8, ease: EASE }}
                className="relative z-10 mt-2 sm:mt-3 text-[10px] sm:text-[13px] text-neutral-400 leading-relaxed max-w-md sm:max-w-2xl"
            >
                An integrated WebGIS workspace where survey rigs, GPU processing workers, NAS storage, and PostGIS
                databases collaborate to transform mobile mapping data into trustworthy, published infrastructure assets.
            </motion.p>

            {/* Sparkles emitter (lazy-mounted after the view transition settles) */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.75, duration: 1 }}
                className="relative z-10 w-full max-w-lg sm:max-w-2xl mx-auto h-12 sm:h-16 mt-1"
            >
                <div className="absolute left-0 right-0 mx-auto top-0 bg-gradient-to-r from-transparent via-indigo-500 to-transparent h-px w-3/4" />
                <div className="absolute left-0 right-0 mx-auto top-0 bg-gradient-to-r from-transparent via-sky-500 to-transparent h-[2px] w-1/4" />
                <div aria-hidden className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-80 h-52 pointer-events-none">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-40 h-16 rounded-full bg-sky-400/30 blur-xl" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 w-64 h-24 rounded-full bg-sky-500/15 blur-2xl" />
                </div>
                {sparklesReady && (
                    <div className="absolute inset-0 w-full h-full [mask-image:radial-gradient(ellipse_48%_175%_at_50%_0%,black_42%,transparent_78%)]">
                        <SparklesCore
                            id="tsparticlesfullpage"
                            background="transparent"
                            minSize={0.4}
                            maxSize={1}
                            particleDensity={1200}
                            className="w-full h-full"
                            particleColor="#FFFFFF"
                        />
                    </div>
                )}
            </motion.div>

            {/* Live telemetry stat row — full-width 3-col grid so mobile
                spacing stays even and the dividers never wrap mid-row */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85, duration: 0.85, ease: EASE }}
                className="relative z-10 -mt-3 sm:mt-2 w-full max-w-xs sm:max-w-md mx-auto grid grid-cols-3 divide-x divide-white/10"
            >
                {[
                    { label: 'Distance Mapped', node: <CountUp value={distanceKm} decimals={1} suffix=" km" className="text-sm sm:text-lg font-semibold text-white tabular-nums" /> },
                    { label: '360° Frames', node: <CountUp value={frames} className="text-sm sm:text-lg font-semibold text-white tabular-nums" /> },
                    { label: 'Active Jobs', node: <CountUp value={activeJobs} className="text-sm sm:text-lg font-semibold text-white tabular-nums" /> },
                ].map((s) => (
                    <div
                        key={s.label}
                        className="flex flex-col items-center justify-center text-center px-2 sm:px-5 min-w-0"
                    >
                        {s.node}
                        <div className="text-[8px] sm:text-[9px] uppercase tracking-[0.1em] sm:tracking-[0.14em] text-neutral-500 mt-0.5 whitespace-nowrap">
                            {s.label}
                        </div>
                    </div>
                ))}
            </motion.div>

            {/* CTAs */}
            <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1, duration: 0.8, ease: EASE }}
                className="relative z-10 flex flex-wrap items-center justify-center gap-2 sm:gap-3 mt-5 sm:mt-8 pointer-events-auto"
            >
                <MagneticWrap>
                    <HoverBorderGradient
                        onClick={onLaunch}
                        containerClassName="group/btn rounded-lg cursor-pointer active:scale-[0.97]"
                        className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg font-medium text-[11px] sm:text-sm flex items-center justify-center gap-2 text-neutral-100"
                    >
                        <span>Launch Workspace</span>
                        <ArrowRight className="w-3.5 h-3.5 text-neutral-400 group-hover/btn:text-white transition-all group-hover/btn:translate-x-0.5" />
                    </HoverBorderGradient>
                </MagneticWrap>
                <button
                    onClick={onExplore3D}
                    className="group flex items-center gap-2 rounded-lg border border-white/10 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] px-3 py-2 sm:px-4 sm:py-2.5 text-[11px] sm:text-xs font-medium text-neutral-300 hover:text-white transition-all cursor-pointer active:scale-[0.97]"
                >
                    <span className="material-symbols-outlined text-[15px] leading-none text-neutral-400 group-hover:text-sky-300 transition-colors">public</span>
                    <span>Explore in 3D</span>
                </button>
            </motion.div>

            {/* Tech-stack marquee */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.2, duration: 1 }}
                className="marquee-host relative z-10 w-full mt-auto sm:mt-14 border-y border-white/[0.06] py-2.5 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
            >
                <div className="flex w-max animate-showcase-marquee">
                    {[0, 1].map((dup) => (
                        <div key={dup} className="flex items-center" aria-hidden={dup === 1}>
                            {marquee.map((item) => (
                                <span key={`${dup}-${item}`} className="flex items-center whitespace-nowrap">
                                    <span className="text-[10px] uppercase tracking-[0.22em] text-neutral-500 font-medium px-5">
                                        {item}
                                    </span>
                                    <span className="text-[7px] text-white/15">◆</span>
                                </span>
                            ))}
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* Scroll hint — flow after the marquee on mobile (mt-auto pins
                it to the bottom while keeping the marquee above it); absolute
                bottom-pinned on larger screens. */}
            <div className="relative z-10 mt-4 sm:mt-0 sm:absolute sm:bottom-7 left-0 right-0 flex justify-center pointer-events-none">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.5, duration: 0.8 }}
                    className="flex flex-col items-center gap-1 text-white"
                >
                    <span className="text-[9px] tracking-[0.3em] uppercase text-white/75">Scroll to explore</span>
                    <img
                        src="/icon animation/Arrow.svg"
                        alt=""
                        className="w-8 h-8 drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]"
                    />
                </motion.div>
            </div>
        </section>
    );
};
