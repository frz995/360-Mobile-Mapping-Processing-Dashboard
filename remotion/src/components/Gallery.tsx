import React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { TOUR_TEXT_MUTED } from '../tour-data';
import type { TourModule } from '../tour-data';
import { BrandLogo } from './BrandLogo';

const START = 56;
const END = 268;
const SLIDE = 16;

/**
 * Professional slideshow: each module screenshot fills the whole frame and
 * slides horizontally into the next on a clean cubic ease. A quiet
 * lower-third caption names the step being shown. No effects, no chrome.
 */
export const Gallery: React.FC<{ module: TourModule }> = ({ module }) => {
    const frame = useCurrentFrame();
    const shots = module.screenshots;
    const n = shots.length;
    const per = (END - START) / n;

    const group = interpolate(frame, [START, START + 10, END - 10, END], [0, 1, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    if (group <= 0.004) return null;

    return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', opacity: group }}>
            {shots.map((src, i) => {
                const s = START + i * per;
                const e = s + per;
                if (frame < s || frame > e + SLIDE) return null;
                const enter = interpolate(frame, [s, s + SLIDE], [100, 0], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                    easing: Easing.inOut(Easing.cubic),
                });
                const exit = interpolate(frame, [e, e + SLIDE], [0, -100], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                    easing: Easing.inOut(Easing.cubic),
                });
                const x = frame < e ? enter : exit;
                return (
                    <div
                        key={src}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            transform: `translateX(${x}%)`,
                            willChange: 'transform',
                        }}
                    >
                        <Img
                            src={staticFile(src)}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                    </div>
                );
            })}

            {shots.map((src, i) => {
                const s = START + i * per;
                const e = s + per;
                const capIn = interpolate(frame, [s + SLIDE, s + SLIDE + 8], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                });
                const capOut = interpolate(frame, [e - 8, e], [1, 0], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                });
                const o = Math.min(capIn, capOut);
                if (o <= 0.01) return null;
                return (
                    <div
                        key={`cap-${src}`}
                        style={{
                            position: 'absolute',
                            left: 56,
                            bottom: 44,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            opacity: o,
                            transform: `translateY(${(1 - o) * 8}px)`,
                        }}
                    >
                        <span style={{ fontSize: 13, fontFamily: 'monospace', letterSpacing: 2, color: module.accent }}>
                            {String(i + 1).padStart(2, '0')}
                        </span>
                        <span style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.25)' }} />
                        <span style={{ fontSize: 20, fontWeight: 600, color: '#ffffff', letterSpacing: 0.2 }}>
                            {module.steps[i % module.steps.length] ?? module.subtitle}
                        </span>
                    </div>
                );
            })}

            <div
                style={{
                    position: 'absolute',
                    right: 44,
                    top: 36,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    opacity: 0.9,
                }}
            >
                <BrandLogo height={20} />
                <span style={{ fontSize: 12, fontFamily: 'monospace', letterSpacing: 2, color: TOUR_TEXT_MUTED }}>
                    {module.order}
                </span>
            </div>
        </div>
    );
};
