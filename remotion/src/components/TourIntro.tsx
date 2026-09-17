import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { TOUR_TEXT_MUTED } from '../tour-data';
import type { TourModule } from '../tour-data';
import { TextReveal } from './TextReveal';
import { BrandLogo } from './BrandLogo';

/**
 * Cinematic title beat: the white arrow lockup breathes in, the module name
 * reveals word-by-word, then everything drifts up and out as the gallery
 * arrives. No chrome, no frames — pure type on a dark stage.
 */
export const TourIntro: React.FC<{ module: TourModule }> = ({ module }) => {
    const frame = useCurrentFrame();

    const exit = interpolate(frame, [42, 56], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    if (exit <= 0.004) return null;

    const logoPulse = 1 + Math.sin(frame / 7) * 0.015;

    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 22,
                transform: `translateY(${(1 - exit) * -46}px)`,
                willChange: 'transform, opacity',
            }}
        >
            <BrandLogo
                height={42}
                style={{
                    opacity: exit,
                    transform: `scale(${logoPulse})`,
                    filter: 'drop-shadow(0 0 22px rgba(255,255,255,0.16))',
                }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: exit }}>
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: 5,
                        color: module.accent,
                    }}
                >
                    {module.tag}
                </span>
                <span style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.22)' }} />
                <span style={{ fontSize: 11, fontFamily: 'monospace', letterSpacing: 2, color: TOUR_TEXT_MUTED }}>
                    {module.order}
                </span>
            </div>
            <TextReveal
                text={module.title.replace(/\n/g, ' ')}
                fromFrame={10}
                stagger={5}
                opacityMul={exit}
                style={{ maxWidth: 900, rowGap: 8 }}
                wordStyle={{
                    fontSize: 52,
                    fontWeight: 700,
                    lineHeight: 1.12,
                    letterSpacing: -1,
                    background: 'linear-gradient(180deg, #ffffff 30%, #b6c1cd 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                }}
            />
            <TextReveal
                text={module.subtitle}
                fromFrame={26}
                stagger={3}
                enterOffset={14}
                enterBlur={5}
                opacityMul={exit}
                style={{ maxWidth: 720 }}
                wordStyle={{ fontSize: 17, fontWeight: 400, color: 'rgba(255,255,255,0.55)', letterSpacing: 0.2 }}
            />
        </div>
    );
};
