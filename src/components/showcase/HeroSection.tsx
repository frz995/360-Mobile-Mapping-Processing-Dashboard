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
            className="relative min-h-dvh-safe snap-start flex flex-col items-center justify-center text-center px-4 sm:px-8 pt-24 pb-10"
        >
            {/* Aurora depth field */}
            <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute left-1/2 top-[16%] -translate-x-1/2 w-[560px] h-[380px] rounded-full bg-sky-500/10 blur-[110px] animate-aurora-a" />
                <div className="absolute left-[28%] top-[42%] w-[420px] h-[320px] rounded-full bg-indigo-500/10 blur-[120px] animate-aurora-b" />
            </div>

            {/* Status eyebrow */}
            <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.7, ease: EASE }}
                className="relative z-10 flex items-center gap-2"
            >
                <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-400" />
                </span>
                <span className="text-[10px] font-medium tracking-[0.22em] uppercase text-neutral-400">
                    Cloud-Native WebGIS · Production Grade
                </span>
            </motion.div>

            {/* Headline — per-word mask reveal */}
            <h1
                aria-label="GeoSphere 360°"
                className="relative z-10 mt-5 text-4xl sm:text-6xl xl:text-7xl font-bold tracking-tight bg-gradient-to-b from-white via-white to-white/55 bg-clip-text text-transparent"
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
                A Cloud-Native Mobile Mapping Platform
            </motion.span>

            <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.62, duration: 0.8, ease: EASE }}
                className="relative z-10 mt-3 text-[11px] sm:text-[13px] text-neutral-400 leading-relaxed max-w-2xl"
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

            {/* Live telemetry stat row */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85, duration: 0.85, ease: EASE }}
                className="relative z-10 flex flex-wrap items-start justify-center mt-6 w-full max-w-3xl mx-auto"
            >
                {[
                    { label: 'Distance Mapped', node: <CountUp value={distanceKm} decimals={1} suffix=" km" className="text-lg sm:text-2xl font-semibold text-white tabular-nums" /> },
                    { label: '360° Frames', node: <CountUp value={frames} className="text-lg sm:text-2xl font-semibold text-white tabular-nums" /> },
                    { label: 'Active Jobs', node: <CountUp value={activeJobs} className="text-lg sm:text-2xl font-semibold text-white tabular-nums" /> },
                ].map((s, i) => (
                    <div
                        key={s.label}
                        className={`flex flex-col items-center text-center px-6 sm:px-10 ${i > 0 ? 'border-l border-white/10' : ''}`}
                    >
                        {s.node}
                        <div className="text-[9px] uppercase tracking-[0.18em] text-neutral-500 mt-1">{s.label}</div>
                    </div>
                ))}
            </motion.div>

            {/* CTAs */}
            <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1, duration: 0.8, ease: EASE }}
                className="relative z-10 flex flex-wrap items-center justify-center gap-3 mt-8"
            >
                <MagneticWrap>
                    <HoverBorderGradient
                        onClick={onLaunch}
                        containerClassName="group/btn rounded-lg cursor-pointer active:scale-[0.97]"
                        className="px-5 py-2.5 rounded-lg font-medium text-xs sm:text-sm flex items-center justify-center gap-2 text-neutral-100"
                    >
                        <span>Launch Workspace</span>
                        <ArrowRight className="w-3.5 h-3.5 text-neutral-400 group-hover/btn:text-white transition-all group-hover/btn:translate-x-0.5" />
                    </HoverBorderGradient>
                </MagneticWrap>
                <button
                    onClick={onExplore3D}
                    className="group flex items-center gap-2 rounded-lg border border-white/10 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] px-4 py-2.5 text-xs font-medium text-neutral-300 hover:text-white transition-all cursor-pointer active:scale-[0.97]"
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
                className="marquee-host relative z-10 w-full mt-10 sm:mt-14 border-y border-white/[0.06] py-2.5 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
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

            {/* Scroll hint */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5, duration: 0.8 }}
                className="relative z-10 mt-5 flex flex-col items-center gap-1 text-white"
            >
                <span className="text-[9px] tracking-[0.3em] uppercase text-white/75">Scroll to explore</span>
                <img
                    src="/icon animation/Arrow.svg"
                    alt=""
                    className="w-8 h-8 drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]"
                />
            </motion.div>
        </section>
    );
};
