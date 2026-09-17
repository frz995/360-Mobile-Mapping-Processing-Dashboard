import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

const BASE = 46;
const LENGTH = 232;

export const StepChips: React.FC<{ steps: string[]; accent: string }> = ({ steps, accent }) => {
    const frame = useCurrentFrame();
    const per = LENGTH / steps.length;

    return (
        <div style={{ position: 'absolute', left: 20, bottom: 8, display: 'flex', gap: 8, pointerEvents: 'none' }}>
            {steps.map((s, i) => {
                const start = BASE + i * per;
                const fadeIn = interpolate(frame, [start, start + 7], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                });
                const fadeOut = interpolate(frame, [start + per - 7, start + per], [1, 0], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                });
                const o = Math.min(fadeIn, fadeOut);
                if (o <= 0.01) return null;
                return (
                    <div
                        key={s}
                        style={{
                            opacity: o,
                            transform: `translateY(${(1 - o) * 10}px)`,
                            background: 'rgba(5,7,10,0.75)',
                            border: `1px solid ${accent}40`,
                            borderRadius: 999,
                            padding: '6px 13px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                        }}
                    >
                        <span
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                background: accent,
                                boxShadow: `0 0 8px ${accent}`,
                            }}
                        />
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#ffffff', letterSpacing: 0.2 }}>
                            {s}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};