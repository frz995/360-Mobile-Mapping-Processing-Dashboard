import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Controlled range slider that decouples *live preview* from *commit*.
 *
 * Native `<input type="range">` fires `onChange` for every step while dragging.
 * When that onChange performs expensive work (persisting to localStorage,
 * toggling dirty-state, re-serializing fingerprints), sliding becomes laggy and
 * "unsaved edits" banners flicker on every tick.
 *
 * CommitSlider keeps a local `draft` value during the drag so the thumb/readout
 * respond instantly, calls `onPreview` (cheap, optional) on every tick, and only
 * calls `onCommit` exactly once when the user releases the pointer / thumb.
 */
export interface CommitSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  style?: React.CSSProperties;
  className?: string;
  disabled?: boolean;
  /** Live-only preview, fires on every tick while dragging (no persist/dirty). */
  onPreview?: (next: number) => void;
  /** Commit, fires exactly once when the drag ends. */
  onCommit: (next: number) => void;
}

export const CommitSlider: React.FC<CommitSliderProps> = ({
  value,
  min,
  max,
  step = 1,
  style,
  className,
  disabled,
  onPreview,
  onCommit
}) => {
  const [draft, setDraft] = useState<number>(value);
  const draggingRef = useRef(false);
  const draftRef = useRef<number>(value);

  // While idle, keep the displayed value in sync with the committed prop value.
  useEffect(() => {
    if (!draggingRef.current) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = parseFloat(e.target.value);
      draggingRef.current = true;
      draftRef.current = next;
      setDraft(next);
      onPreview?.(next);
    },
    [onPreview]
  );

  const handleCommit = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onCommit(draftRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCommit]);

  // Capture pointer release at the document level so letting go *outside* the
  // thumb/track still commits cleanly (and never double-commits).
  useEffect(() => {
    if (!draggingRef.current) return;
    const release = () => handleCommit();
    document.addEventListener('pointerup', release);
    document.addEventListener('touchend', release);
    return () => {
      document.removeEventListener('pointerup', release);
      document.removeEventListener('touchend', release);
    };
  }, [handleCommit]);

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={draggingRef.current ? draft : value}
      disabled={disabled}
      aria-label={`${min}-${max}`}
      onChange={handleChange}
      onPointerDown={() => {
        draggingRef.current = true;
      }}
      onPointerUp={handleCommit}
      onTouchEnd={handleCommit}
      onKeyUp={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
          handleCommit();
        }
      }}
      onBlur={handleCommit}
      style={style}
      className={className}
    />
  );
};

export default CommitSlider;