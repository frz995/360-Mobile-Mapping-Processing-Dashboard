import React from 'react';
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { TOUR_LINE, TOUR_LOGO, TOUR_TEXT_MUTED } from '../tour-data';
import type { TourModule } from '../tour-data';
import { Montage } from './Montage';
import { HudOverlay } from './HudOverlay';
import { Cursor } from './Cursor';
import { StepChips } from './StepChips';

export const PANEL = { x: 70, y: 96, w: 1140, h: 528, radius: 24, toolbar: 54, progress: 34 };

export const Stage: React.FC<{ module: TourModule }> = ({ module }) => {
    const frame = useCurrentFrame();
    // The intro overlay reads over a dimmed stage that clarifies by ~frame 50.
    const dim = interpolate(frame, [0, 26, 50], [0.28, 0.55, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    return (
        <div
            style={{
                position: 'absolute',
                left: PANEL.x,
                top: PANEL.y,
                width: PANEL.w,
                height: PANEL.h,
                borderRadius: PANEL.radius,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: 'linear-gradient(180deg, #0d141d 0%, #090e15 100%)',
                boxShadow: '0 40px 90px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
                overflow: 'hidden',
                opacity: dim,
            }}
        >
            <Toolbar module={module} />
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: PANEL.toolbar,
                    bottom: PANEL.progress,
                    overflow: 'hidden',
                }}
            >
                <Montage shots={module.screenshots} />
                <HudOverlay accent={module.accent} />
                <Cursor shots={module.screenshots.length} accent={module.accent} />
                <StepChips steps={module.steps} accent={module.accent} />
            </div>
            <ProgressBar module={module} />
        </div>
    );
};

const Toolbar: React.FC<{ module: TourModule }> = ({ module }) => (
    <div
        style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: PANEL.toolbar,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '0 18px',
            borderBottom: `1px solid ${TOUR_LINE}`,
            background: 'rgba(255, 255, 255, 0.015)',
        }}
    >
        <div style={{ display: 'flex', gap: 5 }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
                <span key={c} style={{ width: 9, height: 9, borderRadius: 999, background: c, opacity: 0.7 }} />
            ))}
        </div>
        <Img
            src={staticFile(TOUR_LOGO)}
            style={{
                width: 28,
                height: 28,
                objectFit: 'contain',
            }}
        />
        <span
            style={{
                fontSize: 14,
                fontWeight: 600,
                color: '#ffffff',
                letterSpacing: 0.1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}
        >
            {module.title.split('\n')[0]}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
                style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 2,
                    color: module.accent,
                    border: `1px solid ${module.accent}55`,
                    borderRadius: 999,
                    padding: '3px 10px',
                    background: `${module.accent}14`,
                }}
            >
                {module.tag}
            </span>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: TOUR_TEXT_MUTED, letterSpacing: 1 }}>
                MODULE {module.order}
            </span>
        </div>
    </div>
);

const ProgressBar: React.FC<{ module: TourModule }> = ({ module }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const mont = interpolate(frame, [46, 278], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });
    return (
        <div
            style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: PANEL.progress,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 18px',
                borderTop: `1px solid ${TOUR_LINE}`,
                background: 'rgba(0, 0, 0, 0.28)',
            }}
        >
            {module.steps.map((s, i) => {
                const segStart = i / module.steps.length;
                const segEnd = (i + 1) / module.steps.length;
                const fill = mont <= segStart ? 0 : mont >= segEnd ? 1 : (mont - segStart) / (segEnd - segStart);
                const active = mont >= segStart && mont <= segEnd;
                return (
                    <div
                        key={s}
                        style={{
                            width: 120,
                            flex: 1,
                            height: 4,
                            borderRadius: 999,
                            background: 'rgba(255,255,255,0.08)',
                            overflow: 'hidden',
                            alignSelf: 'center',
                        }}
                    >
                        <div
                            style={{
                                height: '100%',
                                borderRadius: 999,
                                width: `${fill * 100}%`,
                                background: active ? module.accent : TOUR_TEXT_MUTED,
                                boxShadow: active ? `0 0 8px ${module.accent}` : 'none',
                            }}
                        />
                    </div>
                );
            })}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: TOUR_TEXT_MUTED, letterSpacing: 1 }}>
                {Math.round(mont * 100)}% · {String(Math.round(frame / fps)).padStart(2, '0')}s
            </span>
        </div>
    );
};