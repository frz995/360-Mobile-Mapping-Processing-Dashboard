import React from 'react';
import { motion } from 'framer-motion';
import { ScrambleText } from './ScrambleText';
import { WorkflowNodeGraph } from './WorkflowNodeGraph';
import { WORKFLOW_SECTION, VIEWPORT_REVEAL, revealGroup, revealItem, wordVariant } from './showcaseMotion';

interface WorkflowSectionProps {
    onJumpTo?: (index: number) => void;
}

/**
 * Dedicated MIT-style Systems Architecture & Data Lifecycle section.
 * Positioned right after Module 6 (Data Management) and before the OutroSection.
 */
export const WorkflowSection: React.FC<WorkflowSectionProps> = () => {
    return (
        <section
            data-section-idx={WORKFLOW_SECTION}
            className="relative min-h-screen min-h-dvh-safe snap-start flex flex-col items-center justify-start sm:justify-center text-center px-4 sm:px-6 lg:px-8 pt-20 xs:pt-24 sm:py-12 pb-12"
        >
            <motion.div
                variants={revealGroup}
                initial="hidden"
                whileInView="show"
                viewport={VIEWPORT_REVEAL}
                className="w-full max-w-6xl flex flex-col items-center justify-center my-auto mt-2 xs:mt-4 sm:mt-auto"
            >
                <motion.span
                    variants={revealItem}
                    className="text-xs sm:text-sm font-mono font-semibold tracking-[0.25em] text-sky-300/85 uppercase"
                >
                    <ScrambleText text="END-TO-END MMS ARCHITECTURE" />
                </motion.span>

                <h2
                    aria-label="System Architecture & Data Lifecycle"
                    className="mt-3 text-3xl sm:text-5xl font-semibold tracking-tight leading-tight"
                >
                    {['System', 'Architecture', '&', 'Data', 'Lifecycle'].map((w, i) => (
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
                </h2>

                <motion.p variants={revealItem} className="mt-3 text-xs sm:text-sm text-neutral-400 max-w-xl leading-relaxed">
                    How mobile mapping survey telemetry transitions from on-premises GPU workers to cloud storage, visual QA/QC inspection, and published WebGIS layers.
                </motion.p>

                <motion.div variants={revealItem} className="w-full mt-4">
                    <WorkflowNodeGraph />
                </motion.div>
            </motion.div>
        </section>
    );
};
