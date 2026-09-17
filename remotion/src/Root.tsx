import React from 'react';
import { Composition } from 'remotion';
import { ModuleTour } from './ModuleTourComposition';
import { TOUR_DURATION_FRAMES, TOUR_FPS, TOUR_MODULES } from './tour-data';

export const RemotionRoot: React.FC = () => (
    <>
        {TOUR_MODULES.map((mod) => (
            <Composition
                key={mod.id}
                id={mod.id}
                component={ModuleTour}
                durationInFrames={TOUR_DURATION_FRAMES}
                fps={TOUR_FPS}
                width={1280}
                height={720}
                defaultProps={{ moduleId: mod.id }}
            />
        ))}
    </>
);