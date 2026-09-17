import React from 'react';
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { TourModule } from '../tour-data';
import { TOUR_LOGO } from '../tour-data';

export const IntroOverlay: React.FC<{ module: TourModule }> = ({ module }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    const overlay = interpolate(frame, [44, 54], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    const rise = spring({ frame, fps, config: { damping: 16, stiffness: 90 }, durationInFrames: 40 });
    const iconScale = spring({ frame, fps, config: { damping: 12, stiffness: 120 }, durationInFrames: 44 });
    const barW = interpolate(frame, [6, 26], [0, 120], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    if (overlay <= 0.003) return null;

    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 20,
                opacity: overlay,
                background: 'radial-gradient(1000px 620px at 50% 42%, rgba(5,7,10,0.5), rgba(5,7,10,0.86) 78%)',
                pointerEvents: 'none',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    opacity: rise,
                }}
            >
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: 3,
                        color: module.accent,
                    }}
                >
                    GEOSPHERE 360°
                </span>
                <span style={{ width: 28, height: 1, background: 'rgba(255,255,255,0.25)' }} />
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.55)', letterSpacing: 1 }}>
                    {module.order}
                </span>
            </div>

            <Img
                src={staticFile(TOUR_LOGO)}
                style={{
                    width: 132,
                    height: 132,
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 0 24px rgba(255, 255, 255, 0.18))',
                    transform: `scale(${iconScale})`,
                    opacity: rise,
                }}
            />

            <div
                style={{
                    fontSize: 44,
                    lineHeight: 1.02,
                    fontWeight: 700,
                    color: '#ffffff',
                    textAlign: 'center',
                    letterSpacing: -0.5,
                    transform: `translateY(${(1 - rise) * 26}px)`,
                    opacity: rise,
                }}
            >
                {module.title.split('\n').map((ln) => (
                    <span key={ln} style={{ display: 'block' }}>
                        {ln}
                    </span>
                ))}
            </div>

            <div
                style={{
                    width: barW,
                    height: 2,
                    background: module.accent,
                    boxShadow: `0 0 12px ${module.accent}`,
                    opacity: rise,
                }}
            />

            <span
                style={{
                    fontSize: 14,
                    color: 'rgba(255,255,255,0.62)',
                    textAlign: 'center',
                    maxWidth: 620,
                    lineHeight: 1.45,
                    transform: `translateY(${(1 - rise) * 16}px)`,
                    opacity: rise,
                }}
            >
                {module.subtitle}
            </span>
        </div>
    );
};