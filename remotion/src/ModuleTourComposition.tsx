import React from 'react';
import { AbsoluteFill, interpolate } from 'remotion';
import { useCurrentFrame } from 'remotion';
import { TOUR_BG, TOUR_MODULES } from './tour-data';
import { fontFamily } from './fonts';
import { Background } from './components/Background';
import { TourIntro } from './components/TourIntro';
import { Gallery } from './components/Gallery';
import { TourOutro } from './components/TourOutro';

/**
 * Premium 3D module tour: title beat -> the real screenshots floating as
 * glass cards in 3D space with modern text captions -> closing brand beat.
 * Nothing but the pictures, soft light and typography — no UI chrome.
 */
export const ModuleTour: React.FC<{ moduleId: string }> = ({ moduleId }) => {
    const frame = useCurrentFrame();
    const module = TOUR_MODULES.find((m) => m.id === moduleId) ?? TOUR_MODULES[0];
    const blackout = interpolate(frame, [332, 340], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
    });

    return (
        <AbsoluteFill style={{ backgroundColor: TOUR_BG, fontFamily }}>
            <Background accent={module.accent} />
            <TourIntro module={module} />
            <Gallery module={module} />
            <TourOutro module={module} />
            <AbsoluteFill style={{ background: '#000', opacity: blackout }} />
        </AbsoluteFill>
    );
};
