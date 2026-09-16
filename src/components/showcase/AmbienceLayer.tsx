import React, { useEffect, useRef } from 'react';

/** Static fractal-noise tile (URL-encoded SVG) — one composited layer, no JS cost. */
const GRAIN_URI =
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

/**
 * Global landing ambience: film grain, edge vignette, and a soft cursor
 * spotlight (fine pointers only). Purely decorative, never blocks input.
 */
export const AmbienceLayer: React.FC = () => {
    const spotRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = spotRef.current;
        if (!el) return;
        if (typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) return;
        let raf = 0;
        const onMove = (e: PointerEvent) => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                el.style.setProperty('--mx', `${e.clientX}px`);
                el.style.setProperty('--my', `${e.clientY}px`);
                el.style.opacity = '1';
            });
        };
        const onLeave = () => { el.style.opacity = '0'; };
        window.addEventListener('pointermove', onMove, { passive: true });
        document.addEventListener('pointerleave', onLeave);
        return () => {
            window.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerleave', onLeave);
            if (raf) cancelAnimationFrame(raf);
        };
    }, []);

    return (
        <div aria-hidden className="absolute inset-0 z-[1] pointer-events-none">
            {/* Film grain */}
            <div
                className="absolute inset-0 opacity-[0.045] mix-blend-overlay"
                style={{ backgroundImage: GRAIN_URI, backgroundSize: '180px 180px' }}
            />
            {/* Edge vignette */}
            <div
                className="absolute inset-0"
                style={{ background: 'radial-gradient(ellipse 120% 90% at 50% 45%, transparent 58%, rgba(0,0,0,0.55) 100%)' }}
            />
            {/* Cursor spotlight */}
            <div
                ref={spotRef}
                className="absolute inset-0 opacity-0 transition-opacity duration-700"
                style={{
                    background:
                        'radial-gradient(440px circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.04), rgba(120,180,255,0.015) 45%, transparent 68%)',
                }}
            />
        </div>
    );
};
