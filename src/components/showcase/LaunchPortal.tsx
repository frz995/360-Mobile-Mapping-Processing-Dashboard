import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { EASE } from './showcaseMotion';

export interface LaunchRequest {
    title: string;
    image?: string;
}

interface LaunchPortalProps {
    launch: LaunchRequest | null;
}

/**
 * Cinematic exit transition: the workspace screenshot zooms through the
 * camera while an initialization caption flashes, covering the hard view
 * swap into the dashboard. Purely visual — the parent fires the real
 * navigation on a timer.
 */
export const LaunchPortal: React.FC<LaunchPortalProps> = ({ launch }) => {
    return (
        <AnimatePresence>
            {launch && (
                <motion.div
                    key="launch-portal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'linear' }}
                    className="absolute inset-0 z-[70] bg-[#030508] flex flex-col items-center justify-center overflow-hidden"
                    aria-hidden
                >
                    {launch.image && (
                        <motion.img
                            src={launch.image}
                            alt=""
                            className="absolute w-[70%] max-w-[900px] rounded-xl opacity-60 select-none pointer-events-none"
                            initial={{ scale: 0.8, opacity: 0.55, filter: 'blur(4px)' }}
                            animate={{ scale: 1.9, opacity: 0, filter: 'blur(14px)' }}
                            transition={{ duration: 0.95, ease: EASE }}
                            draggable={false}
                        />
                    )}
                    <div className="relative z-10 flex flex-col items-center gap-3 text-center px-6">
                        <span className="text-[9px] font-mono tracking-[0.4em] uppercase text-neutral-500">
                            Initializing
                        </span>
                        <span className="text-sm sm:text-base font-semibold tracking-[0.2em] uppercase text-white">
                            {launch.title} Workspace
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono">
                            <Loader2 size={12} className="animate-spin text-sky-400" />
                            <span>Establishing secure session…</span>
                        </div>
                        <motion.div
                            className="mt-2 h-px w-56 bg-gradient-to-r from-transparent via-sky-400 to-transparent origin-left"
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ duration: 0.6, ease: EASE }}
                        />
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
