import React, { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'framer-motion';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·/+';

interface ScrambleTextProps {
    text: string;
    className?: string;
    /** Total decode time in ms. */
    duration?: number;
}

/**
 * Mono char-scramble decode triggered once when the text scrolls into view.
 * Falls back to the plain string when IntersectionObserver is missing (jsdom)
 * or the user prefers reduced motion.
 */
export const ScrambleText: React.FC<ScrambleTextProps> = ({ text, className, duration = 620 }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const inView = useInView(ref, { once: true, margin: '-6%' });
    const reduced = useReducedMotion();
    const [display, setDisplay] = useState(text);

    useEffect(() => {
        if (!inView || reduced) {
            setDisplay(text);
            return;
        }
        let frame = 0;
        const total = Math.max(8, Math.round(duration / 34));
        const id = window.setInterval(() => {
            frame += 1;
            const settled = Math.floor((frame / total) * text.length);
            if (settled >= text.length) {
                setDisplay(text);
                window.clearInterval(id);
                return;
            }
            let out = text.slice(0, settled);
            for (let i = settled; i < text.length; i++) {
                out += text[i] === ' ' ? ' ' : CHARS[Math.floor(Math.random() * CHARS.length)];
            }
            setDisplay(out);
        }, 34);
        return () => window.clearInterval(id);
    }, [inView, reduced, text, duration]);

    return (
        <span ref={ref} className={className}>
            {display}
        </span>
    );
};
