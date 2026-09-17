import React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';

const BASE = 46;
const LENGTH = 232;

export const Montage: React.FC<{ shots: string[] }> = ({ shots }) => {
    const frame = useCurrentFrame();
    const per = LENGTH / shots.length;
    const overlap = 16;

    return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#0a0f16' }}>
            {shots.map((src, i) => {
                const start = BASE + i * per;
                const end = start + per;
                const fadeIn = interpolate(frame, [start, start + overlap], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                    easing: Easing.inOut(Easing.ease),
                });
                const fadeOut = interpolate(frame, [end - overlap, end], [1, 0], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                    easing: Easing.inOut(Easing.ease),
                });
                const opacity = Math.min(fadeIn, fadeOut);
                if (opacity <= 0.001) return null;
                const t = interpolate(frame, [start, end], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                });
                const zoom = 1.06 + t * 0.16;
                const panX = [-26, 24, 0, 20][i % 4] * t;
                const panY = [16, -18, -12, 14][i % 4] * t;
                return (
                    <Img
                        key={src}
                        src={staticFile(src)}
                        style={{
                            position: 'absolute',
                            inset: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            objectPosition: 'center center',
                            opacity,
                            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                            willChange: 'transform, opacity',
                        }}
                    />
                );
            })}
            {/* Contrast veil so HUD chips / cursor read on bright screenshots */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                        'linear-gradient(180deg, rgba(5,7,10,0.22), transparent 26%, transparent 72%, rgba(5,7,10,0.34))',
                    pointerEvents: 'none',
                }}
            />
        </div>
    );
};