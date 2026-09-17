import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

const BASE = 46;

const TARGETS = [
    { x: 380, y: 300 },
    { x: 640, y: 230 },
    { x: 470, y: 380 },
    { x: 850, y: 330 },
];

/**
 * A faux OS cursor that glides into the stage per screenshot, clicks (ripple),
 * then drifts off — selling the "a user is exploring the module" feel.
 */
export const Cursor: React.FC<{ shots: number; accent: string }> = ({ shots, accent }) => {
    const frame = useCurrentFrame();
    const per = 232 / shots;
    const raw = frame - BASE;
    const i = Math.min(shots - 1, Math.max(0, Math.floor(raw / per)));
    const tIn = raw / per;
    const target = TARGETS[i % TARGETS.length];

    const enter = 0.3;
    const rippleAt = 0.48;
    const exit = 0.85;

    let x = -60;
    let y = target.y - 90;
    let opacity = 1;

    if (tIn >= 0 && tIn < enter) {
        const k = tIn / enter;
        x = interpolate(k, [0, 1], [-60, target.x]);
        y = interpolate(k, [0, 1], [target.y - 90, target.y]);
    } else if (tIn >= enter && tIn < exit) {
        x = target.x;
        y = target.y;
    } else {
        const k = (tIn - exit) / (1 - exit);
        x = interpolate(k, [0, 1], [target.x, 1330]);
        y = interpolate(k, [0, 1], [target.y, target.y + 28]);
        opacity = 1 - interpolate(k, [0.35, 1], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
        });
    }

    // Fade the whole cursor out as the montage itself wraps up.
    opacity *= interpolate(frame, [276, 288], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    const rippleP = interpolate(tIn, [rippleAt, rippleAt + 0.2], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    const rippleR = interpolate(rippleP, [0, 1], [10, 54]);
    const rippleO = (1 - rippleP) * interpolate(frame, [276, 288], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    if (opacity <= 0.01) return null;

    return (
        <div style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
            {rippleP > 0 && rippleO > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        left: target.x - rippleR,
                        top: target.y - rippleR,
                        width: rippleR * 2,
                        height: rippleR * 2,
                        borderRadius: 999,
                        border: `1.5px solid ${accent}`,
                        opacity: rippleO * 0.9,
                        boxShadow: `0 0 14px ${accent}66`,
                    }}
                />
            )}
            <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                style={{
                    position: 'absolute',
                    left: x,
                    top: y,
                    opacity,
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
                    transform: 'translate(-2px, -1px)',
                }}
            >
                <path d="M5 3 L19 13 L11.5 14.6 L8 21 Z" fill="#ffffff" />
                <path d="M5 3 L19 13 L11.5 14.6 L8 21 Z" fill="none" stroke={accent} strokeWidth="1.3" />
            </svg>
        </div>
    );
};