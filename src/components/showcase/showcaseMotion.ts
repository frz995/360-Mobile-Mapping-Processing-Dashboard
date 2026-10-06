import type { Transition, Variants } from 'framer-motion';

/** One easing curve for the whole showcase — long, calm deceleration. */
export const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];
export const EASE_SOFT = [0.22, 1, 0.36, 1] as [number, number, number, number];

/** Slow, heavy glide — used by the backdrop globe choreography. */
export const springGlide: Transition = { type: 'spring', stiffness: 46, damping: 18, mass: 1.05 };
/** Snappier spring — UI micro-interactions. */
export const springSnap: Transition = { type: 'spring', stiffness: 160, damping: 20, mass: 0.8 };

/** Scroll-reveal building blocks (staggered fade + rise + defocus). */
export const revealItem: Variants = {
    hidden: { opacity: 0, y: 22, filter: 'blur(7px)' },
    show: {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        transition: { duration: 1.05, ease: EASE },
    },
};

export const revealGroup: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.09, delayChildren: 0.04 } },
};

/** Staggered word-mask headline reveal (used by Hero, Workflow, Outro headlines). */
export const wordVariant: Variants = {
    hidden: { y: '115%', opacity: 0 },
    show: (i: number) => ({
        y: '0%',
        opacity: 1,
        transition: { delay: 0.12 + i * 0.06, duration: 0.75, ease: EASE },
    }),
};

/**
 * Replays the reveal every time a panel enters the viewport — scrolling down
 * or back up always re-runs the animation.
 */
export const VIEWPORT_REVEAL = { once: false, amount: 0.3 } as const;

/** Section indices used across the scroll story. */
export const HERO_SECTION = -1;
export const WORKFLOW_SECTION = 6;
export const OUTRO_SECTION = 7;

export interface GlobePose {
    x: number;
    y: number;
    scale: number;
    opacity: number;
}

/**
 * Aspect ratio of the viewport the satellite globe's camera pose was framed
 * against. Everything in `globeFitScale` is relative to this.
 */
const REFERENCE_ASPECT = 1920 / 970;

/**
 * Full-bleed fit for the satellite globe.
 *
 * MapLibre holds the sphere at a fixed angular size, so across viewports the only
 * thing that varies is how much of the frame the globe spans: a window wider
 * than the reference exposes empty space past both limbs, while a narrow one
 * crops in. Scaling the canvas by the aspect excess keeps the globe spanning edge
 * to edge on any screen, which is what the showcase is composed around.
 *
 * Never below 1 — the globe has to stay full-bleed, not float in space. This
 * replaces the per-section scale fudging (1.72 on mobile, 0.7 on module
 * sections), which shrank the globe to 70% mid-scroll and read as the globe
 * zooming out from under the viewer. Clamped at 1.6 so an ultrawide monitor
 * cannot crop the sphere past recognition.
 */
export function globeFitScale(vw: number, vh: number): number {
    if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return 1;
    return Math.max(1, Math.min(1.6, vw / vh / REFERENCE_ASPECT));
}

/**
 * Stationary-parallax choreography: where the backdrop globe sits for each
 * scroll section. Even sections keep text on the left (globe drifts left
 * behind the copy), odd sections mirror. Values are px offsets computed from
 * the live viewport so the drift scales with screen size.
 *
 * NOTE: these `scale` values are tuned for the SVG vector globe. The satellite
 * globe ignores them and uses `globeFitScale` instead — see the caller.
 */
export function globePoseFor(
    section: number,
    isMobile: boolean,
    vw: number,
    vh: number,
    globeMode: boolean
): GlobePose {
    if (globeMode) return { x: 0, y: 0, scale: 1, opacity: 1 };
    if (section === HERO_SECTION) {
        return isMobile
            ? { x: 0, y: vh * 0.08, scale: 1.72, opacity: 0.7 }
            : { x: 0, y: vh * 0.18, scale: 1, opacity: 0.95 };
    }
    if (section === WORKFLOW_SECTION) {
        return isMobile
            ? { x: 0, y: 0, scale: 0.95, opacity: 0.25 }
            : { x: 0, y: 0, scale: 1.05, opacity: 0.38 };
    }
    if (section === OUTRO_SECTION) {
        return isMobile
            ? { x: 0, y: 0, scale: 0.9, opacity: 0.38 }
            : { x: 0, y: 0, scale: 1.04, opacity: 0.58 };
    }
    if (isMobile) {
        return { x: 0, y: -vh * 0.16, scale: 1, opacity: 0.26 };
    }
    const side = section % 2 === 0 ? -1 : 1;
    return {
        x: side * vw * 0.2,
        y: vh * 0.06 + (section % 3) * vh * 0.012,
        scale: 0.7,
        opacity: 0.4,
    };
}
