import React, { useEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';
import { EASE } from './showcaseMotion';

interface CountUpProps {
    value: number;
    decimals?: number;
    prefix?: string;
    suffix?: string;
    duration?: number;
    className?: string;
}

/**
 * Ticks a number up from 0 when it scrolls into view. Writes straight to the
 * span's textContent (no re-render per frame). Without IntersectionObserver
 * (jsdom) or with reduced motion it renders the final value immediately.
 */
export const CountUp: React.FC<CountUpProps> = ({
    value,
    decimals = 0,
    prefix = '',
    suffix = '',
    duration = 1.5,
    className,
}) => {
    const ref = useRef<HTMLSpanElement>(null);
    const inView = useInView(ref, { once: true, margin: '-8%' });
    const reduced = useReducedMotion();

    const fmt = (v: number) =>
        `${prefix}${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (!inView || reduced || !Number.isFinite(value)) {
            el.textContent = fmt(Number.isFinite(value) ? value : 0);
            return;
        }
        el.textContent = fmt(0);
        const controls = animate(0, value, {
            duration,
            ease: EASE,
            onUpdate: (v: number) => { el.textContent = fmt(v); },
        });
        return () => controls.stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inView, value, reduced, duration]);

    return <span ref={ref} className={className}>{fmt(Number.isFinite(value) ? value : 0)}</span>;
};
