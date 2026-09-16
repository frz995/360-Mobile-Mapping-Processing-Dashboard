import React, { useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';

interface MagneticWrapProps {
    children: React.ReactNode;
    className?: string;
    /** How strongly the element follows the cursor (0–1). */
    strength?: number;
    /** Max displacement in px. */
    max?: number;
}

/** Pulls its child a few pixels toward the cursor — subtle magnetic CTA feel. */
export const MagneticWrap: React.FC<MagneticWrapProps> = ({ children, className, strength = 0.3, max = 7 }) => {
    const ref = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();
    const mx = useMotionValue(0);
    const my = useMotionValue(0);
    const x = useSpring(mx, { stiffness: 220, damping: 18, mass: 0.4 });
    const y = useSpring(my, { stiffness: 220, damping: 18, mass: 0.4 });

    const onMove = (e: React.PointerEvent) => {
        if (reduced || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        mx.set(Math.max(-max, Math.min(max, dx * strength)));
        my.set(Math.max(-max, Math.min(max, dy * strength)));
    };

    const onLeave = () => {
        mx.set(0);
        my.set(0);
    };

    return (
        <motion.div ref={ref} className={className} style={{ x, y }} onPointerMove={onMove} onPointerLeave={onLeave}>
            {children}
        </motion.div>
    );
};
