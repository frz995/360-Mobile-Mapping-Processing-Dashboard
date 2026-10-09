import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { HoverBorderGradient } from '../common/HoverBorderGradient';
import { CoverflowGallery } from './CoverflowGallery';
import { MagneticWrap } from './MagneticWrap';
import { ScrambleText } from './ScrambleText';
import { EASE, VIEWPORT_REVEAL, revealGroup, revealItem } from './showcaseMotion';
import type { SystemModule } from './types';

interface ModuleSectionProps {
    mod: SystemModule;
    index: number;
    total: number;
    onEnter: (moduleId: string) => void;
}

/**
 * One full-viewport panel of the scroll story. Text and coverflow gallery
 * alternate sides per section; everything reveals with a staggered
 * fade/rise/defocus as the panel crosses the viewport mid-band.
 */
export const ModuleSection: React.FC<ModuleSectionProps> = ({ mod, index, total, onEnter }) => {
    const Icon = mod.icon;
    const textFirst = index % 2 === 0;
    const shortTitle = mod.title.split('&')[0].trim();

    return (
        <section
            data-section-idx={index}
            className="relative min-h-dvh-safe snap-start flex items-center px-6 sm:px-8 lg:px-14 py-16 sm:py-20"
        >
            {/* Ghost section numeral */}
            <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
                <span
                    className={`ghost-numeral absolute top-1/2 -translate-y-1/2 text-[24vw] font-bold leading-none ${textFirst ? 'left-[-2vw]' : 'right-[-2vw]'
                        }`}
                >
                    {String(index + 1).padStart(2, '0')}
                </span>
            </div>

            <div className="relative w-full max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
                {/* Screenshot coverflow */}
                <motion.div
                    id={`module-gallery-${index}`}
                    variants={{
                        hidden: { opacity: 0, filter: 'blur(7px)' },
                        show: {
                            opacity: 1,
                            filter: 'blur(0px)',
                            transition: { duration: 0.85, ease: EASE }
                        }
                    }}
                    initial="hidden"
                    whileInView="show"
                    viewport={VIEWPORT_REVEAL}
                    className={`order-1 w-full ${textFirst ? 'lg:order-2 lg:col-start-7 lg:col-span-6' : 'lg:order-1 lg:col-start-1 lg:col-span-6'
                        }`}
                >
                    <CoverflowGallery
                        index={index}
                        moduleId={mod.id}
                        moduleTitle={mod.title}
                        moduleSubtitle={mod.subtitle}
                        moduleDescription={mod.description}
                        images={mod.images}
                        hotspots={mod.hotspots}
                    />
                </motion.div>

                {/* Narrative */}
                <motion.div
                    variants={revealGroup}
                    initial="hidden"
                    whileInView="show"
                    viewport={VIEWPORT_REVEAL}
                    className={`order-2 w-full space-y-5 ${textFirst ? 'lg:order-1 lg:col-start-1 lg:col-span-5' : 'lg:order-2 lg:col-start-8 lg:col-span-5'
                        }`}
                >
                    {/* Eyebrow */}
                    <motion.div variants={revealItem} className="flex items-center gap-3">
                        <span className="text-[10px] font-mono font-semibold tracking-[0.2em] uppercase whitespace-nowrap">
                            <ScrambleText
                                text={mod.category}
                                className="bg-gradient-to-r from-sky-300 via-blue-400 to-indigo-400 bg-clip-text text-transparent"
                            />
                        </span>
                        <span className="h-px flex-1 bg-gradient-to-r from-white/15 to-transparent" />
                        <span className="text-[10px] font-mono text-neutral-600 tabular-nums tracking-wider shrink-0">
                            {String(index + 1).padStart(2, '0')}/{String(total).padStart(2, '0')}
                        </span>
                    </motion.div>

                    {/* Module title with icon */}
                    <motion.div variants={revealItem} className="flex items-center gap-2.5 sm:gap-3">
                        {mod.iconImage ? (
                            <img
                                src={mod.iconImage}
                                alt=""
                                className="icon-white w-6 h-6 sm:w-7 sm:h-7 object-contain shrink-0"
                                loading="lazy"
                            />
                        ) : (
                            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-neutral-300 shrink-0" />
                        )}
                        <span aria-hidden className="w-px h-5 sm:h-6 bg-white/15 shrink-0" />
                        <h2 className="inline-block bg-gradient-to-b from-white via-white to-neutral-400 bg-clip-text text-transparent text-2xl sm:text-3xl xl:text-[2.6rem] font-semibold tracking-tight leading-[1.18] pb-2 -mb-2">
                            {mod.title}
                        </h2>
                    </motion.div>

                    {/* Subtitle & description block */}
                    <motion.div variants={revealItem} className="space-y-2.5">
                        <p className="text-[11px] sm:text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
                            {mod.subtitle}
                        </p>
                        <p className="text-[13px] sm:text-sm text-neutral-400 leading-relaxed max-w-lg">
                            {mod.description}
                        </p>
                    </motion.div>

                    {/* Specs */}
                    {mod.specs.length > 0 && (
                        <motion.div variants={revealItem} className="space-y-0">
                            <div className="h-px w-full bg-gradient-to-r from-white/10 via-white/10 to-transparent" />
                            <dl className="grid">
                                {mod.specs.map((s) => (
                                    <div key={s.label}>
                                        <div className="flex items-center gap-2.5 sm:gap-3 py-1.5">
                                            <dt className="text-[10px] sm:text-[11px] text-neutral-400 font-medium shrink-0 w-24 sm:w-28">{s.label}</dt>
                                            <span aria-hidden className="w-px h-3 sm:h-3.5 bg-white/15 shrink-0" />
                                            <dd className="min-w-0 flex-1 text-[10px] sm:text-[11px] font-medium text-neutral-200 truncate" title={s.value}>{s.value}</dd>
                                        </div>
                                        <div className="h-px w-full bg-gradient-to-r from-white/[0.08] via-white/[0.08] to-transparent" />
                                    </div>
                                ))}
                            </dl>
                        </motion.div>
                    )}

                    {/* Workflow timeline */}
                    {mod.workflow.length > 0 && (
                        <motion.div variants={revealItem} className="space-y-2.5">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500 block">
                                Workflow
                            </span>
                            <div className="relative pl-7">
                                <div className="absolute left-[9px] top-2 bottom-2 w-px bg-white/10" />
                                <motion.div
                                    className="absolute left-[9px] top-2 bottom-2 w-px bg-gradient-to-b from-sky-400/70 via-white/40 to-transparent origin-top"
                                    initial={{ scaleY: 0 }}
                                    whileInView={{ scaleY: 1 }}
                                    viewport={{ once: false, amount: 0.4 }}
                                    transition={{ duration: 1.1, ease: EASE, delay: 0.25 }}
                                />
                                {mod.workflow.map((wf, i) => (
                                    <div key={i} className="relative py-1.5">
                                        <span className="absolute -left-7 top-1.5 w-[19px] h-[19px] rounded-full bg-[#05070a] border border-white/15 text-[8px] font-mono font-semibold text-neutral-400 flex items-center justify-center">
                                            {i + 1}
                                        </span>
                                        <div className="text-[11px] font-mono font-semibold text-neutral-200 tracking-wide">
                                            {wf.step.replace(/^\d+[.\s]+/, '')}
                                        </div>
                                        <div className="text-[10px] text-neutral-500 leading-relaxed">{wf.action}</div>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {/* CTAs */}
                    <motion.div variants={revealItem} className="flex flex-wrap items-center gap-3 pt-1">
                        <MagneticWrap>
                            <HoverBorderGradient
                                onClick={() => onEnter(mod.id)}
                                containerClassName="group/btn rounded-lg cursor-pointer active:scale-[0.97]"
                                className="px-4 py-2 rounded-lg font-medium text-xs flex items-center justify-center gap-2 text-neutral-200"
                            >
                                <span>Enter {shortTitle}</span>
                                <ArrowRight className="w-3.5 h-3.5 text-neutral-400 group-hover/btn:text-white transition-all group-hover/btn:translate-x-0.5" />
                            </HoverBorderGradient>
                        </MagneticWrap>
                    </motion.div>
                </motion.div>
            </div>
        </section>
    );
};
