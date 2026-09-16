import React from 'react';
import { motion, type MotionValue } from 'framer-motion';
import type { SystemModule } from './types';

interface SectionRailProps {
    modules: SystemModule[];
    /** -1 hero, 0..n-1 modules, n outro. */
    activeSection: number;
    progress: MotionValue<number>;
    onHome: () => void;
    onSelect: (index: number) => void;
    onLaunch: () => void;
}

/**
 * Sticky right-edge progress rail: numbered module dots with expanding labels
 * and a hairline that draws itself with scroll progress.
 */
export const SectionRail: React.FC<SectionRailProps> = ({
    modules,
    activeSection,
    progress,
    onHome,
    onSelect,
    onLaunch,
}) => {
    return (
        <nav
            aria-label="Section navigation"
            className="absolute right-5 top-1/2 -translate-y-1/2 z-40 hidden xl:flex flex-col items-end gap-3"
        >
            {/* Home */}
            <button
                onClick={onHome}
                aria-label="Back to top"
                className="group flex items-center gap-2 cursor-pointer"
            >
                <span className="material-symbols-outlined text-[14px] leading-none text-neutral-600 group-hover:text-white transition-colors">
                    north
                </span>
                <span
                    className={`block rounded-full transition-all duration-500 ${activeSection === -1
                            ? 'w-5 h-1 bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                            : 'w-1 h-1 bg-white/25 group-hover:bg-white/60'
                        }`}
                />
            </button>

            {/* Modules with drawn progress line */}
            <div className="relative flex flex-col items-end gap-3.5 py-1 pr-[3px]">
                <div className="absolute right-[3px] top-0 bottom-0 w-px bg-white/[0.08]" />
                <motion.div
                    className="absolute right-[3px] top-0 bottom-0 w-px bg-gradient-to-b from-sky-400/80 to-white/70 origin-top"
                    style={{ scaleY: progress }}
                />
                {modules.map((m, i) => {
                    const active = activeSection === i;
                    return (
                        <button
                            key={m.id}
                            onClick={() => onSelect(i)}
                            aria-label={`Go to section ${i + 1}: ${m.title}`}
                            aria-current={active ? 'true' : undefined}
                            className="group relative flex items-center gap-2.5 cursor-pointer"
                        >
                            <span
                                className={`max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-medium transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${active
                                        ? 'max-w-[200px] opacity-100 text-white'
                                        : 'opacity-0 text-neutral-400 group-hover:max-w-[200px] group-hover:opacity-100'
                                    }`}
                            >
                                <span className="font-mono text-neutral-600 mr-1.5">{String(i + 1).padStart(2, '0')}</span>
                                {m.title.split('&')[0].trim()}
                            </span>
                            <span
                                className={`relative z-10 block rounded-full transition-all duration-500 ${active
                                        ? 'w-5 h-1.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                                        : 'w-1.5 h-1.5 bg-white/25 group-hover:bg-white/60'
                                    }`}
                            />
                        </button>
                    );
                })}
            </div>

            {/* Launch */}
            <button
                onClick={onLaunch}
                aria-label="Launch workspace"
                className="group flex items-center gap-2 cursor-pointer"
            >
                <span className="material-symbols-outlined text-[14px] leading-none text-neutral-600 group-hover:text-sky-300 transition-colors">
                    rocket_launch
                </span>
                <span
                    className={`block rounded-full transition-all duration-500 ${activeSection >= modules.length
                            ? 'w-5 h-1 bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.7)]'
                            : 'w-1 h-1 bg-white/25 group-hover:bg-white/60'
                        }`}
                />
            </button>
        </nav>
    );
};
