import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

interface TextRevealProps {
    text: string;
    fromFrame: number;
    stagger?: number;
    style?: React.CSSProperties;
    wordStyle?: React.CSSProperties;
    enterOffset?: number;
    enterBlur?: number;
    opacityMul?: number;
}

/** Modern word-by-word reveal: each word springs up out of a soft blur. */
export const TextReveal: React.FC<TextRevealProps> = ({
    text,
    fromFrame,
    stagger = 6,
    style,
    wordStyle,
    enterOffset = 26,
    enterBlur = 8,
    opacityMul = 1,
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const words = text.split(/\s+/).filter(Boolean);

    return (
        <div
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                columnGap: '0.28em',
                rowGap: '0.08em',
                ...style,
            }}
        >
            {words.map((w, i) => {
                const p = spring({
                    frame: frame - fromFrame - i * stagger,
                    fps,
                    config: { damping: 15, stiffness: 95, mass: 0.8 },
                    durationInFrames: 34,
                });
                return (
                    <span
                        key={`${w}-${i}`}
                        style={{
                            display: 'inline-block',
                            whiteSpace: 'pre',
                            opacity: p * opacityMul,
                            transform: `translateY(${(1 - p) * enterOffset}px)`,
                            filter: `blur(${(1 - p) * enterBlur}px)`,
                            willChange: 'transform, opacity, filter',
                            ...wordStyle,
                        }}
                    >
                        {w}
                    </span>
                );
            })}
        </div>
    );
};
