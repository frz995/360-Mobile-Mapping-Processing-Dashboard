import React, { useState, useEffect, useCallback, useRef } from 'react';

interface InterModuleConnectorsProps {
    totalModules: number;
    containerRef: React.RefObject<HTMLDivElement>;
}

interface ConnectorPath {
    id: string;
    d: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

/**
 * Builds an orthogonal circuit leader line path with G1-continuous rounded corners.
 * Seamlessly connects the bottom of one module's gallery card to the top of the next module's gallery card.
 */
function buildInterModulePath(x1: number, y1: number, x2: number, y2: number, r = 24): string {
    const midY = (y1 + y2) / 2;
    const dx = x2 - x1;

    // Almost vertical: straight line
    if (Math.abs(dx) < 8) {
        return `M ${x1} ${y1} V ${y2}`;
    }

    const sign = dx > 0 ? 1 : -1;
    const clampedR = Math.min(r, Math.abs(dx) / 2, Math.abs(midY - y1) - 6);

    return `M ${x1} ${y1} V ${midY - clampedR} Q ${x1} ${midY} ${x1 + sign * clampedR} ${midY} H ${x2 - sign * clampedR} Q ${x2} ${midY} ${x2} ${midY + clampedR} V ${y2}`;
}

export const InterModuleConnectors: React.FC<InterModuleConnectorsProps> = ({
    totalModules,
    containerRef,
}) => {
    const [paths, setPaths] = useState<ConnectorPath[]>([]);
    const rafRef = useRef<number | null>(null);

    const updatePaths = useCallback(() => {
        const wrap = containerRef.current;
        if (!wrap) return;

        const wrapRect = wrap.getBoundingClientRect();
        if (wrapRect.width === 0) return;

        const newPaths: ConnectorPath[] = [];

        for (let i = 0; i < totalModules - 1; i++) {
            // Target the exact gallery card border; fallback to gallery container if needed
            const elA = document.getElementById(`module-gallery-card-${i}`) || document.getElementById(`module-gallery-${i}`);
            const elB = document.getElementById(`module-gallery-card-${i + 1}`) || document.getElementById(`module-gallery-${i + 1}`);

            if (!elA || !elB) continue;

            const rectA = elA.getBoundingClientRect();
            const rectB = elB.getBoundingClientRect();

            if (rectA.width === 0 || rectB.width === 0) continue;

            // X coordinates relative to the modules container
            const x1 = rectA.left - wrapRect.left + rectA.width * 0.5;
            // Starts precisely at the bottom border of card A
            const y1 = rectA.bottom - wrapRect.top;

            const x2 = rectB.left - wrapRect.left + rectB.width * 0.5;
            // Stops precisely at the top border of card B — never penetrates into card B
            const y2 = rectB.top - wrapRect.top;

            if (y2 <= y1) continue;

            const d = buildInterModulePath(x1, y1, x2, y2, 20);
            newPaths.push({
                id: `connector-${i}-${i + 1}`,
                d,
                x1,
                y1,
                x2,
                y2,
            });
        }

        setPaths(newPaths);
    }, [totalModules, containerRef]);

    useEffect(() => {
        const scheduleUpdate = () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(updatePaths);
        };

        scheduleUpdate();

        const wrap = containerRef.current;
        let ro: ResizeObserver | null = null;
        if (wrap) {
            ro = new ResizeObserver(scheduleUpdate);
            ro.observe(wrap);
            for (let i = 0; i < totalModules; i++) {
                const card = document.getElementById(`module-gallery-card-${i}`) || document.getElementById(`module-gallery-${i}`);
                if (card) ro.observe(card);
            }
        }

        const scrollContainer = wrap?.closest('.showcase-scrollport') || window;
        scrollContainer.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);

        // Staggered triggers to account for font loading and image layout stabilization
        const timer1 = setTimeout(scheduleUpdate, 200);
        const timer2 = setTimeout(scheduleUpdate, 600);
        const timer3 = setTimeout(scheduleUpdate, 1200);

        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (ro) ro.disconnect();
            scrollContainer.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
            clearTimeout(timer1);
            clearTimeout(timer2);
            clearTimeout(timer3);
        };
    }, [updatePaths, containerRef, totalModules]);

    if (paths.length === 0) return null;

    return (
        <svg
            className="absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible"
            aria-hidden="true"
        >
            {paths.map((p) => (
                <path
                    key={p.id}
                    d={p.d}
                    stroke="rgba(255, 255, 255, 0.16)"
                    strokeWidth="1.2"
                    fill="none"
                    strokeLinecap="butt"
                    strokeLinejoin="round"
                />
            ))}
        </svg>
    );
};
