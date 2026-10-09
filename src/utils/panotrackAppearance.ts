/**
 * How a panotrack point looks, derived from two independent facts.
 *
 * WHY TWO FIELDS AND NOT ONE STATUS
 *
 * A POI can be missing its image AND carry a defect record. Forcing that into a
 * single `status` string means picking a winner, and both choices destroy
 * information: gray-over-red hides a defect the operator must act on, and
 * red-over-gray implies a bad image where no image exists at all.
 *
 * `frameState` answers "is the image there?" and `qaState` answers "is the image
 * good?". They are answered from different tables — the storage bucket and
 * `qa_defects` respectively — and they fail independently. A defect record can
 * exist for a frame that never uploaded; a frame can be present and clean.
 *
 * WHY THIS IS ONE MODULE
 *
 * Before this, fourteen sites each computed a colour with their own ternary:
 *
 *   App.tsx:2578, 2738            MapComponent.tsx:169-171, 222-228
 *   DeletionSelectionMap.tsx:279  DataManagementPage.tsx:632-633
 *   QAQCWorkbench.tsx:821         panotrackExtractor.ts:164, 202, 271, 299
 *   AdminSettingsView.tsx:261-274  RoadAnalysisMap.tsx:441
 *
 * They disagreed. `panotrackExtractor.ts:68-71` documented an explicit
 * assumption that this system "tracks only three operational statuses —
 * Published, Staging, and Defect", which is precisely the assumption that
 * collapses a missing frame into one of the three. Fourteen copies of a rule
 * that is stated once here is the only way it stays true.
 *
 * WHY `unrecorded` IS A FOURTH STATE
 *
 * `src/services/api/datasets.ts` synthesizes a filename for any POI whose real
 * name was never stored:
 *
 *   const fn = g.imageFilenames[pIdx] || `${subgrid}-${String(pIdx + 1)...}.jpg`;
 *
 * That invented name is of course not in the bucket, so `isAvailable` is false.
 * Under a naive "no image means missing" rule, **every POI whose filename was
 * never recorded would be reported as a missing frame.** We do not know its
 * image exists and we do not know it does not, so `unrecorded` says that instead
 * of inventing a deficit. `QCAuditModal.tsx` and `SubgridImagesListModal.tsx`
 * both already refuse to synthesise names for exactly this reason.
 */

/** Whether a POI's image is present, absent, or unknowable. */
export type FrameState =
  | 'present'
    /** Recorded filename, found in the storage inventory. */
  | 'missing'
    /** Recorded filename, storage reachable, not in the inventory. */
  | 'unverified'
    /** Storage could not be reached. Neither present nor missing. */
  | 'unrecorded'
    /** No filename was ever stored for this POI. */

/** Whether a present image passed QA/QC. Meaningless without `present`. */
export type QaState =
  | 'clean'
  | 'defect'
    /** Never audited, or the defect table was unreadable. */
  | 'unaudited';

export interface PointAppearanceInput {
  frameState: FrameState;
  qaState: QaState;
  /** Run-level publication state. Only colours a frame that exists. */
  isPublished: boolean;
  /** Selected/deletion-preview overrides, preserved from existing behaviour. */
  isSelected?: boolean;
  /** Renders unpresentable points in the muted slate. */
  dimmed?: boolean;
  /**
   * When true (default), confirmed missing frames render as gray (#94a3b8) with
   * status 'missing'. When false, missing frames fall back to their pipeline
   * status color: yellow (#f59e0b) if staging, green (#10b981) if published.
   */
  highlightMissingFrames?: boolean;
}

export interface PointAppearance {
  /** Circle fill. Carries QA outcome — a defect stays visibly red. */
  color: string;
  /** Stroke / ring colour. Carries frame outcome independently of fill. */
  strokeColor: string;
  /**
   * Echoed back so a payload can carry the state alongside the colour. A
   * consumer that only receives the hex would have to re-derive the state to
   * FILTER on it — and the external WebGIS app cannot derive one, because it
   * never fetches a Storage inventory.
   */
  frameState: FrameState;
  qaState: QaState;
  /** Map `status` string. Kept compatible with the existing WebGIS contract. */
  status: string;
  /**
   * Opacity. `unverified` and `unrecorded` are drawn faint because they are
   * statements about our knowledge, not about the survey.
   */
  opacity: number;
}

/**
 * Palette. Deliberately literal hex rather than theme tokens: these values are
 * posted across a `postMessage` boundary to an external WebGIS app, which cannot
 * resolve CSS custom properties. Theme-awareness is handled by
 * `SET_MAP_THEME`, which sends overridable track colours.
 */
const PALETTE = {
  published: '#10b981',
  staging: '#f59e0b',
  defect: '#ef4444',
  selected: '#38bdf8',
  /** Gray — used ONLY for a confirmed missing frame. */
  missing: '#94a3b8',
  /** Muted slate — the "we could not check" family. */
  unknown: '#64748b',
  dimmed: '#64748b'
} as const;

export const POINT_APPEARANCE_COLORS = PALETTE;

/**
 * Resolve one point's appearance from its two independent facts.
 *
 * Precedence for the FILL is defect, because a defect is actionable and must not
 * be hidden by an absent image. Precedence for the STROKE is frame state, so a
 * red point with a missing frame reads as a red dot inside a gray ring — both
 * facts visible at once, which is the entire reason for this module.
 */
export function resolvePointAppearance({
  frameState,
  qaState,
  isPublished,
  isSelected = false,
  dimmed = false,
  highlightMissingFrames = true
}: PointAppearanceInput): PointAppearance {
  if (dimmed) {
    return {
      color: PALETTE.dimmed,
      strokeColor: PALETTE.dimmed,
      frameState,
      qaState,
      status: qaState === 'defect' ? 'defect' : 'missing',
      opacity: 0.35
    };
  }

  // ---- fill: the QA outcome --------------------------------------------
  let color: string;
  if (qaState === 'defect') {
    color = PALETTE.defect;
  } else if (frameState === 'missing') {
    color = highlightMissingFrames ? PALETTE.missing : (isPublished ? PALETTE.published : PALETTE.staging);
  } else if (frameState === 'unverified' || frameState === 'unrecorded') {
    color = PALETTE.unknown;
  } else {
    color = isPublished ? PALETTE.published : PALETTE.staging;
  }

  // ---- stroke: the frame outcome, independent of the fill --------------
  let strokeColor: string;
  if (frameState === 'missing') {
    strokeColor = highlightMissingFrames ? PALETTE.missing : color;
  } else if (frameState === 'unverified' || frameState === 'unrecorded') {
    strokeColor = PALETTE.unknown;
  } else {
    strokeColor = color;
  }

  // ---- status string: the existing WebGIS contract ---------------------
  // `status` is a loose string everywhere it matters, and the external map
  // switches on it. `missing` is a new value; the WebGIS app needs a legend
  // entry for it. Until then it degrades to the colour we send alongside it.
  let status: string;
  if (qaState === 'defect') {
    status = 'defect';
  } else if (frameState === 'missing') {
    status = highlightMissingFrames ? 'missing' : (isPublished ? 'published' : 'staging');
  } else if (frameState === 'unverified' || frameState === 'unrecorded') {
    status = 'unverified';
  } else {
    status = isPublished ? 'published' : 'staging';
  }

  // Selection outranks every state, matching the existing behaviour at
  // `MapComponent.tsx:169-171`, where a selected point is blue regardless.
  if (isSelected) {
    return {
      color: PALETTE.selected,
      strokeColor: PALETTE.selected,
      frameState,
      qaState,
      status,
      opacity: 1.0
    };
  }

  // Absence and doubt are both drawn faint; presence is drawn solid.
  const opacity = frameState === 'missing'
    ? (highlightMissingFrames ? 0.75 : (isPublished ? 1.0 : 0.7))
    : (frameState === 'present' ? 1.0 : 0.5);

  return { color, strokeColor, frameState, qaState, status, opacity };
}

/**
 * Derive `frameState` from the facts the data layer has.
 *
 * `verified` comes from `verifyFilenamesAgainstStorage`, which distinguishes a
 * reachable-but-empty bucket (a real, verified zero) from an unreachable one.
 * That distinction is the whole reason this function exists — the old code
 * inferred it from `verifiedFiles.length > 0`, which is false for BOTH cases and
 * therefore had to guess, and guessed differently for published and staged rows.
 */
export function deriveFrameState(input: {
  /** Filename recorded for this POI, or undefined/empty if none was. */
  recordedFilename?: string | null;
  /** The storage-verified subset for the run. */
  verifiedFilenames: readonly string[];
  /** False when storage could not be reached at all. */
  inventoryVerified: boolean;
}): FrameState {
  const recorded = (input.recordedFilename ?? '').trim();
  if (!recorded) return 'unrecorded';
  if (!input.inventoryVerified) return 'unverified';

  const base = (recorded.split('/').pop() || recorded).toUpperCase();
  const found = input.verifiedFilenames.some((v) => {
    const candidate = (v.split('/').pop() || v).toUpperCase();
    return candidate === base;
  });
  return found ? 'present' : 'missing';
}

/**
 * Legacy convenience projection of `frameState`.
 *
 * SIX call sites read `panoramas[].isAvailable` today. They cannot be given the
 * richer field without touching all of them, so it is retained as a derived
 * value — and deliberately lossy, because a boolean cannot distinguish
 * `unverified` from `missing`. Any caller that needs to tell those apart must
 * read `frameState`.
 */
export function isAvailableFromFrameState(frameState: FrameState): boolean {
  return frameState === 'present';
}

/**
 * `qaState` from the fields a point already carries.
 *
 * `defectCount > 0` is deliberately NOT consulted. A run-level defect count
 * says something about the run, not about this frame; using it would paint every
 * point red in any run that contained a single defect.
 */
export function deriveQaState(point: {
  isDefect?: boolean;
  is_defect?: boolean;
  status?: string;
  qa_status?: string;
}): QaState {
  if (point.isDefect === true || point.is_defect === true) return 'defect';
  const status = (point.status ?? '').toLowerCase();
  const qaStatus = (point.qa_status ?? '').toLowerCase();
  if (status === 'defect' || qaStatus === 'defect' || qaStatus.includes('defect') || qaStatus === 'flagged') {
    return 'defect';
  }
  if (qaStatus === 'published' || status === 'published' || status === 'yes') return 'clean';
  return 'unaudited';
}