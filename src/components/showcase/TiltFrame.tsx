import React, { useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';

interface TiltFrameProps {
    children: React.ReactNode;
    className?: string;
    /** Max pointer tilt in degrees. */
    maxTilt?: number;
    glare?: boolean;
}

/**
 * Pointer-tracked 3D tilt with a moving specular glare. All values are motion
 * values written straight to style — no React re-renders while pointing.
 */
export const TiltFrame: React.FC<TiltFrameProps> = ({ children, className, maxTilt = 5, glare = true }) => {
    const ref = useRef<HTMLDivElement>(null);
    const reduced = useReducedMotion();

    const px = useMotionValue(0.5);
    const py = useMotionValue(0.5);
    const rx = useSpring(useTransform(py, [0, 1], [maxTilt, -maxTilt]), { stiffness: 170, damping: 20, mass: 0.6 });
    const ry = useSpring(useTransform(px, [0, 1], [-maxTilt, maxTilt]), { stiffness: 170, damping: 20, mass: 0.6 });

    const glareOpacity = useMotionValue(0);
    const glareSpring = useSpring(glareOpacity, { stiffness: 120, damping: 24 });
    const glareBg = useTransform(
        [px, py],
        ([x, y]) =>
            `radial-gradient(440px circle at ${(x as number) * 100}% ${(y as number) * 100}%, rgba(255,255,255,0.09), rgba(255,255,255,0.02) 42%, transparent 68%)`
    );

    const handleMove = (e: React.PointerEvent) => {
        if (reduced || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        px.set((e.clientX - r.left) / r.width);
        py.set((e.clientY - r.top) / r.height);
    };

    const handleLeave = () => {
        px.set(0.5);
        py.set(0.5);
        glareOpacity.set(0);
    };

    return (
        <motion.div
            ref={ref}
            className={className}
            onPointerMove={handleMove}
            onPointerEnter={() => { if (!reduced && glare) glareOpacity.set(1); }}
            onPointerLeave={handleLeave}
            style={{ rotateX: rx, rotateY: ry, transformPerspective: 1500 }}
        >
            {children}
            {glare && (
                <motion.div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-[inherit] z-20"
                    style={{ opacity: glareSpring, background: glareBg }}
                />
            )}
        </motion.div>
    );
};
