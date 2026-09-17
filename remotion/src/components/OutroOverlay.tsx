import React from 'react';
import { Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { TOUR_ICON, TOUR_LOGO, TOUR_MODULES, TOUR_TEXT_MUTED } from '../tour-data';
import type { TourModule } from '../tour-data';

export const OutroOverlay: React.FC<{ module: TourModule }> = ({ module }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    const overlay = interpolate(frame, [278, 288], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    const rise = spring({ frame: frame - 282, fps, config: { damping: 16, stiffness: 90 }, durationInFrames: 18 });
    const iconScale = spring({ frame: frame - 282, fps, config: { damping: 12, stiffness: 140 }, durationInFrames: 22 });

    const idx = TOUR_MODULES.findIndex((m) => m.id === module.id);
    const next = TOUR_MODULES[(idx + 1) % TOUR_MODULES.length];

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
                gap: 18,
                opacity: overlay,
                background:
                    'radial-gradient(1000px 620px at 50% 46%, rgba(5,7,10,0.38), rgba(5,7,10,0.9) 78%)',
                pointerEvents: 'none',
            }}
        >
            <Img
                src={staticFile(TOUR_LOGO)}
                style={{
                    width: 128,
                    height: 128,
                    objectFit: 'contain',
                    opacity: rise,
                    transform: `scale(${iconScale})`,
                    filter: 'drop-shadow(0 0 24px rgba(255, 255, 255, 0.18))',
                }}
            />

            <div
                style={{
                    transform: `translateY(${(1 - rise) * 18}px)`,
                    opacity: rise,
                    textAlign: 'center',
                }}
            >
                <span
                    style={{
                        fontSize: 11,
                        fontFamily: 'monospace',
                        letterSpacing: 2,
                        color: TOUR_TEXT_MUTED,
                        display: 'block',
                        marginBottom: 6,
                    }}
                >
                    MODULE {module.order}
                </span>
                <span
                    style={{
                        fontSize: 30,
                        fontWeight: 700,
                        color: '#ffffff',
                        letterSpacing: -0.4,
                        lineHeight: 1.1,
                    }}
                >
                    {module.title.replace(/\n/g, ' · ')}
                </span>
                <span
                    style={{
                        display: 'block',
                        fontSize: 13,
                        color: 'rgba(255,255,255,0.55)',
                        marginTop: 8,
                        maxWidth: 560,
                        margin: '8px auto 0',
                    }}
                >
                    {module.blurb}
                </span>
            </div>

            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    marginTop: 8,
                    padding: '10px 18px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.03)',
                    opacity: rise,
                    transform: `translateY(${(1 - rise) * 14}px)`,
                }}
            >
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2, color: TOUR_TEXT_MUTED }}>
                    NEXT
                </span>
                <Img
                    src={staticFile(TOUR_ICON)}
                    style={{
                        width: 20,
                        height: 20,
                        objectFit: 'contain',
                    }}
                />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#ffffff' }}>
                    {next.title.split('\n')[0]}
                </span>
                <span style={{ fontSize: 14, color: next.accent }}>▸</span>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
                {TOUR_MODULES.map((m) => (
                    <span
                        key={m.id}
                        style={{
                            width: 7,
                            height: 7,
                            borderRadius: 999,
                            background: m.id === module.id ? module.accent : 'rgba(255,255,255,0.18)',
                            boxShadow: m.id === module.id ? `0 0 8px ${module.accent}` : 'none',
                        }}
                    />
                ))}
            </div>
        </div>
    );
};