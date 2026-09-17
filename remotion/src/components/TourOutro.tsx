import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { TourModule } from '../tour-data';
import { TextReveal } from './TextReveal';
import { BrandLogo } from './BrandLogo';

/** Closing beat: the white arrow lockup settles in, module title + blurb reveal, fade to black. */
export const TourOutro: React.FC<{ module: TourModule }> = ({ module }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    const inP = interpolate(frame, [276, 290], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    if (inP <= 0.004) return null;

    const logoScale = spring({
        frame: frame - 278,
        fps,
        config: { damping: 13, stiffness: 90 },
        durationInFrames: 22,
    });

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
                opacity: inP,
                background: 'radial-gradient(1100px 640px at 50% 50%, rgba(5,7,10,0.25), rgba(5,7,10,0.88) 80%)',
                pointerEvents: 'none',
            }}
        >
            <BrandLogo
                height={80}
                style={{
                    transform: `scale(${logoScale})`,
                    filter: 'drop-shadow(0 0 26px rgba(255,255,255,0.18))',
                }}
            />
            <TextReveal
                text={module.title.replace(/\n/g, ' ')}
                fromFrame={284}
                stagger={4}
                enterOffset={18}
                enterBlur={6}
                style={{ maxWidth: 880 }}
                wordStyle={{
                    fontSize: 34,
                    fontWeight: 700,
                    letterSpacing: -0.4,
                    background: 'linear-gradient(180deg, #ffffff 30%, #b6c1cd 100%)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                }}
            />
            <TextReveal
                text={module.blurb}
                fromFrame={292}
                stagger={2}
                enterOffset={12}
                enterBlur={4}
                style={{ maxWidth: 680 }}
                wordStyle={{ fontSize: 15, fontWeight: 400, color: 'rgba(255,255,255,0.55)' }}
            />
        </div>
    );
};
