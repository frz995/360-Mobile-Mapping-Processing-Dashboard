import React, { useEffect, useMemo, useState } from 'react';

/**
 * Particle burst card — adapted from the RareUI ParticleCard pattern
 * (https://rareui.in/docs/components/particle-card), but the image explosion is
 * triggered when the card APPEARS (auto-replays once shortly after mount)
 * instead of on hover.
 *
 * The screenshots card starts fully assembled, then its image dissolves into a
 * grid of particles that scatter outward, leaving the title/subtitle content
 * visible beneath. Duration spread is compact so a whole vertical gallery
 * bursts in a pleasing cascade.
 */

const IS_TEST_ENV = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');

interface ParticleData {
    x: number;
    y: number;
    posX: number;
    posY: number;
    randX: number;
    randY: number;
    rotate: number;
    scale: number;
    delay: number;
}

interface ParticleCardProps {
    img: string;
    title: string;
    subtitle?: string;
    /** Particle grid columns (affects tile size). */
    cols?: number;
    /** Particle grid rows (affects tile size). */
    rows?: number;
    /** ms after mount before the image bursts into particles. */
    explosionDelay?: number;
    className?: string;
}

const ScatterTile = React.memo(({
    p,
    exploded,
    img,
    cols,
    rows,
}: {
    p: ParticleData;
    exploded: boolean;
    img: string;
    cols: number;
    rows: number;
}) => {
    const backgroundStyle: React.CSSProperties = {
        backgroundImage: `url(${img})`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
        backgroundPosition: `${p.posX}% ${p.posY}%`,
        backgroundRepeat: 'no-repeat',
    };

    const scattered = `translate3d(${p.randX}px, ${p.randY}px, 0) rotate(${p.rotate}deg) scale(${p.scale})`;

    const style: React.CSSProperties = {
        ...backgroundStyle,
        transition: `transform 2600ms cubic-bezier(.2,.8,.2,1) ${p.delay}ms, opacity 2400ms ease-in ${p.delay + 220}ms`,
        transform: exploded ? scattered : 'translate3d(0,0,0) rotate(0deg) scale(1)',
        opacity: exploded ? 0 : 1,
        boxShadow: exploded ? '0 2px 4px rgba(0,0,0,0.1)' : 'none',
        borderRadius: exploded ? 4 : 0,
        width: '100.5%',
        height: '100.5%',
        willChange: 'transform, opacity',
        position: 'absolute',
        top: 0,
        left: 0,
    };

    return (
        <div
            style={{
                width: `${100 / cols}%`,
                height: `${100 / rows}%`,
                position: 'absolute',
                left: `${(p.x / cols) * 100}%`,
                top: `${(p.y / rows) * 100}%`,
            }}
        >
            <div style={style} />
        </div>
    );
});

const ParticleCardInner: React.FC<ParticleCardProps> = ({
    img,
    title,
    subtitle,
    cols = 16,
    rows = 9,
    explosionDelay = 500,
    className = '',
}) => {
    const [exploded, setExploded] = useState(false);

    useEffect(() => {
        if (IS_TEST_ENV) return;
        const t = window.setTimeout(() => setExploded(true), Math.max(150, explosionDelay));
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [explosionDelay]);

    const particles = useMemo<ParticleData[]>(() => {
        if (IS_TEST_ENV) return [];
        const arr: ParticleData[] = [];
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const posX = (x / (cols - 1)) * 100;
                const posY = (y / (rows - 1)) * 100;
                const dx = x - cols / 2;
                const dy = y - rows / 2;
                const angle = Math.atan2(dy, dx);
                const distance = Math.sqrt(dx * dx + dy * dy);
                const spread = 80 + Math.random() * 160;
                const randX = Math.cos(angle) * spread * (1 + Math.random() * 0.5);
                const randY = Math.sin(angle) * spread * (1 + Math.random() * 0.5);
                const rotate = (Math.random() * 2 - 1) * 140;
                const scale = 0.5 + Math.random() * 0.5;
                const delay = distance * 22 + Math.random() * 120;
                arr.push({ x, y, posX, posY, randX, randY, rotate, scale, delay });
            }
        }
        return arr;
    }, [cols, rows]);

    return (
        <div
            className={`relative w-full overflow-hidden rounded-xl border bg-[#0a0e14] ${exploded ? 'border-white/[0.09]' : 'border-white/15'} ${className}`}
        >
            {/* Card body content (revealed after the image bursts away) */}
            <div
                className="absolute inset-0 z-0 flex flex-col justify-end gap-0.5 p-3"
                style={{
                    background:
                        'linear-gradient(135deg, rgba(15,23,42,0.92) 0%, rgba(8,14,22,0.96) 100%)',
                    opacity: exploded ? 1 : 0,
                    transition: 'opacity 700ms ease-in 500ms',
                }}
            >
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] bg-gradient-to-r from-sky-300 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
                    {title}
                </span>
                {subtitle && (
                    <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-neutral-500">
                        {subtitle}
                    </span>
                )}
            </div>

            {/* Foreground image + particles (disbands on appear) */}
            <div className="absolute inset-0 z-10">
                <img
                    src={img}
                    alt={title}
                    draggable={false}
                    loading="eager"
                    decoding="async"
                    className={`pointer-events-none absolute top-0 left-0 h-full w-full object-cover transition-opacity duration-500 ease-out ${exploded ? 'opacity-0' : 'opacity-100'
                        }`}
                />
                <div
                    className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity duration-500 ${exploded ? 'opacity-0' : 'opacity-100'
                        }`}
                />
                <div
                    className={`absolute right-0 bottom-0 left-0 transform p-3 transition-all duration-500 ${exploded ? 'translate-y-3 opacity-0' : 'translate-y-0 opacity-100'
                        }`}
                >
                    <span className="block text-[10px] font-bold text-white leading-tight">{title}</span>
                    {subtitle && (
                        <span className="block text-[8px] font-medium text-white/80 uppercase tracking-wider mt-0.5">
                            {subtitle}
                        </span>
                    )}
                </div>
                <div className="absolute inset-0 h-full w-full overflow-hidden">
                    {!IS_TEST_ENV && particles.map((p, i) => (
                        <ScatterTile key={i} p={p} exploded={exploded} img={img} cols={cols} rows={rows} />
                    ))}
                </div>
            </div>
        </div>
    );
};

export const ParticleCard = React.memo(ParticleCardInner);
export default ParticleCard;