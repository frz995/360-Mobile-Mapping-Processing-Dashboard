import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';

const AREA_W = 1140;
const AREA_H = 440;

const loop = (frame: number, period: number) => (frame % period) / period;

const TelemetryRow: React.FC<{ label: string; value: string; accent: string; delay: number }> = ({
    label,
    value,
    accent,
    delay,
}) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 16 }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', letterSpacing: 1.5, color: 'rgba(255,255,255,0.42)', width: 74 }}>
            {label}
        </span>
        <span style={{ flex: 1, height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <span
                style={{
                    display: 'block',
                    height: '100%',
                    width: `${68 + delay}%`,
                    borderRadius: 999,
                    background: accent,
                    boxShadow: `0 0 8px ${accent}`,
                }}
            />
        </span>
        <span style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, color: '#ffffff', width: 52, textAlign: 'right' }}>
            {value}
        </span>
    </div>
);

/** Animated HUD layer that keeps the on-screen dashboard feeling live. */
export const HudOverlay: React.FC<{ accent: string }> = ({ accent }) => {
    const frame = useCurrentFrame();

    const sweep = loop(frame, 108);
    const sweepY = interpolate(sweep, [0, 1], [-30, AREA_H + 30]);

    const blink = 0.35 + 0.65 * Math.abs(Math.sin(frame / 6));

    const radarRot = (frame * 2.6) % 360;
    const radarPulse = loop(frame, 90);

    const bars = Array.from({ length: 16 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(frame / 15 + i * 0.65)));

    const sparkPoints = Array.from({ length: 24 }, (_, i) => {
        const x = (i / 23) * 150;
        const y = 17 - 13 * Math.sin(i * 0.62 + frame / 8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const throughput = 640 + Math.round(148 * Math.abs(Math.sin(frame / 19)));
    const latency = 18 + Math.round(9 * Math.abs(Math.sin(frame / 11 + 1)));
    const sync = (99.1 + 0.8 * Math.abs(Math.sin(frame / 27))).toFixed(1);

    const pins = [
        { x: 232, y: 118 },
        { x: 372, y: 322 },
        { x: 892, y: 196 },
        { x: 778, y: 356 },
    ];

    return (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            {/* radar rings + rotating sweep */}
            <div
                style={{
                    position: 'absolute',
                    left: 132,
                    top: AREA_H / 2,
                    width: 150,
                    height: 150,
                    marginLeft: -75,
                    marginTop: -75,
                    opacity: 0.5,
                }}
            >
                <div
                    style={{
                        position: 'absolute',
                        inset: 0,
                        borderRadius: 999,
                        background: `conic-gradient(from ${radarRot}deg, ${accent}59, transparent 72deg)`,
                        maskImage: 'radial-gradient(circle, #000 98%, transparent 100%)',
                        WebkitMaskImage: 'radial-gradient(circle, #000 98%, transparent 100%)',
                    }}
                />
                {[150, 104, 58].map((d, i) => (
                    <span
                        key={d}
                        style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            width: d,
                            height: d,
                            marginLeft: -d / 2,
                            marginTop: -d / 2,
                            borderRadius: 999,
                            border: `1px solid ${accent}${i === 0 ? '52' : '33'}`,
                        }}
                    />
                ))}
                <span
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        width: 58,
                        height: 58,
                        marginLeft: -29,
                        marginTop: -29,
                        borderRadius: 999,
                        border: `1px solid ${accent}`,
                        opacity: 1 - radarPulse,
                        transform: `scale(${1 + radarPulse * 1.6})`,
                    }}
                />
            </div>

            {/* travelling data pins with expanding pings */}
            {pins.map((p, i) => {
                const t = loop(frame + i * 22, 90);
                return (
                    <React.Fragment key={`${p.x}-${p.y}`}>
                        <span
                            style={{
                                position: 'absolute',
                                left: p.x,
                                top: p.y,
                                width: 8,
                                height: 8,
                                marginLeft: -4,
                                marginTop: -4,
                                borderRadius: 999,
                                background: accent,
                                boxShadow: `0 0 12px ${accent}`,
                                opacity: 0.9,
                            }}
                        />
                        <span
                            style={{
                                position: 'absolute',
                                left: p.x,
                                top: p.y,
                                width: 34,
                                height: 34,
                                marginLeft: -17,
                                marginTop: -17,
                                borderRadius: 999,
                                border: `1.5px solid ${accent}`,
                                opacity: (1 - t) * 0.8,
                                transform: `scale(${0.3 + t * 1.5})`,
                            }}
                        />
                    </React.Fragment>
                );
            })}

            {/* live badge */}
            <div
                style={{
                    position: 'absolute',
                    left: 24,
                    top: 22,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '5px 11px',
                    borderRadius: 999,
                    border: `1px solid ${accent}55`,
                    background: 'rgba(5,7,10,0.62)',
                    backdropFilter: 'blur(4px)',
                }}
            >
                <span style={{ width: 7, height: 7, borderRadius: 999, background: accent, opacity: blink, boxShadow: `0 0 8px ${accent}` }} />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#ffffff' }}>LIVE</span>
            </div>

            {/* telemetry panel */}
            <div
                style={{
                    position: 'absolute',
                    right: 24,
                    top: 20,
                    width: 262,
                    padding: '12px 14px 10px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(5,7,10,0.66)',
                    backdropFilter: 'blur(6px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 2, color: 'rgba(255,255,255,0.55)' }}>
                        PIPELINE
                    </span>
                    <svg width={150} height={34} style={{ display: 'block' }}>
                        <polyline points={sparkPoints} fill="none" stroke={accent} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                </div>
                <TelemetryRow label="THROUGHPUT" value={`${throughput}/s`} accent={accent} delay={6} />
                <TelemetryRow label="LATENCY" value={`${latency} ms`} accent={accent} delay={-4} />
                <TelemetryRow label="SYNC" value={`${sync}%`} accent={accent} delay={14} />
            </div>

            {/* animated bars */}
            <div
                style={{
                    position: 'absolute',
                    right: 26,
                    bottom: 26,
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 4,
                    height: 62,
                    opacity: 0.8,
                }}
            >
                {bars.map((h, i) => (
                    <span
                        key={i}
                        style={{
                            width: 6,
                            height: `${h * 100}%`,
                            borderRadius: 2,
                            background: i % 3 === 0 ? accent : 'rgba(255,255,255,0.35)',
                            boxShadow: i % 3 === 0 ? `0 0 8px ${accent}` : 'none',
                        }}
                    />
                ))}
            </div>

            {/* scan sweep */}
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: sweepY - 30,
                    height: 62,
                    background: `linear-gradient(180deg, transparent, ${accent}14, transparent)`,
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: sweepY,
                    height: 1.5,
                    background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
                    boxShadow: `0 0 12px ${accent}`,
                    opacity: 0.7,
                }}
            />
        </div>
    );
};

export const HUD_AREA = { w: AREA_W, h: AREA_H };
