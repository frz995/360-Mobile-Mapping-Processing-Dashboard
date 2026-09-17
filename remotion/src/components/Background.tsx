import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

/** Bare cinematic stage: soft brand glow that breathes slowly, plus a vignette. */
export const Background: React.FC<{ accent: string }> = ({ accent }) => {
    const frame = useCurrentFrame();
    const pulse = interpolate(frame, [0, 170, 340], [0.5, 1, 0.5], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    return (
        <AbsoluteFill>
            <AbsoluteFill
                style={{
                    background:
                        'radial-gradient(1200px 660px at 50% 40%, rgba(40,60,90,0.16), transparent 68%)',
                }}
            />
            <AbsoluteFill
                style={{
                    background: `radial-gradient(860px 500px at 50% 46%, ${accent}${Math.round(
                        pulse * 12
                    ).toString(16).padStart(2, '0')}, transparent 66%)`,
                }}
            />
            {/* vignette */}
            <AbsoluteFill
                style={{
                    background:
                        'radial-gradient(140% 120% at 50% 50%, transparent 56%, rgba(0,0,0,0.6) 100%)',
                }}
            />
        </AbsoluteFill>
    );
};
