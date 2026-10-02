// =====================================================================
// Choropleth Settings Editor
// ArcGIS-style symbol editor for the Project Explorer choropleth.
//
// The map previously had fixed class breaks hard-coded per metric, so an
// operator could pick a palette but never a classification. This panel edits
// the class breaks, class colours, ramp, opacity and direction for the active
// metric, with a live preview that drives the map, legend and charts from the
// same classifier.
//
// There is no Apply button: every edit applies to the live workspace
// immediately, so the map, legend and charts always show the operator's change
// before they commit. `applied` is the snapshot the Revert button rolls back
// to, and the only thing Save writes to Supabase
// (project_settings.roadAnalysisState). Cancel-style discard is therefore a
// live re-apply of `applied`, not a local state reset.
// =====================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import {
  ATLAS_PALETTES,
  type ExplorerChoroplethPalette
} from '../../utils/projectExplorerGeometry';
import {
  BREAK_METHOD_HINTS,
  BREAK_METHOD_LABELS,
  applyMethod,
  applyPalette,
  classColors,
  classIndex,
  classIndexFor,
  classRangeLabel,
  MAX_CLASSES,
  MIN_CLASSES,
  removeClass,
  resolveSetting,
  toggleReverse,
  type BreakMethod,
  type ChoroplethSetting,
  type ChoroplethSettingsMap
} from '../../utils/choroplethSettings';

export interface ChoroplethSettingsEditorProps {
  metric: string;
  palette: ExplorerChoroplethPalette;
  settings: ChoroplethSettingsMap;
  /** Observed values for `metric`, used by natural/equal/quantile breaks. */
  metricValues: number[];
  onApply: (setting: ChoroplethSetting) => void;
  onSave: (setting: ChoroplethSetting) => void;
  onPaletteChange: (palette: ExplorerChoroplethPalette) => void;
  onClose: () => void;
}

const RAMP_IDS = Object.keys(ATLAS_PALETTES) as ExplorerChoroplethPalette[];

export const ChoroplethSettingsEditor: React.FC<ChoroplethSettingsEditorProps> = ({
  metric,
  palette,
  settings,
  metricValues,
  onApply,
  onSave,
  onPaletteChange,
  onClose
}) => {
  // Snapshot the applied setting once per metric so Cancel has something to
  // restore to even after the operator has typed in several bounds.
  const [draft, setDraft] = useState<ChoroplethSetting>(() =>
    resolveSetting(settings, metric, palette)
  );
  const [applied, setApplied] = useState<ChoroplethSetting>(() =>
    resolveSetting(settings, metric, palette)
  );
  const [isDirty, setIsDirty] = useState(false);

  // Re-seed when the operator switches metric: each metric has its own saved
  // classes, so carrying density breaks over to complexity would be wrong.
  useEffect(() => {
    const next = resolveSetting(settings, metric, palette);
    setDraft(next);
    setApplied(next);
    setIsDirty(false);
  }, [metric]);

  const unit = metric === 'coverage' ? '%' : metric === 'density' ? 'km/km²' : '';

  // Every edit goes straight to the live workspace, so the map, legend and both
  // charts move as the operator types. `applied` is the rollback snapshot that
  // Cancel restores and Save re-anchors.
  const patch = (next: ChoroplethSetting) => {
    setDraft(next);
    setIsDirty(true);
    onApply(next);
  };

  const setBound = (index: number, raw: string) => {
    const parsed = raw === '' ? NaN : Number(raw);
    patch({
      ...draft,
      method: 'manual',
      classes: draft.classes.map((c, i) =>
        i === index
          ? { ...c, upperBound: isFinite(parsed) ? parsed : null }
          : c
      )
    });
  };

  // Rows are listed low-value-first, so with `reverse` on the row's colour lives
  // at the mirrored index in the backing `classes` array.
  const setColor = (displayIndex: number, color: string) => {
    const target = classIndex(draft, displayIndex);
    patch({
      ...draft,
      classes: draft.classes.map((c, i) => (i === target ? { ...c, color } : c))
    });
  };

  const changeMethod = (method: BreakMethod) => {
    patch(applyMethod(draft, method, metricValues));
  };

  // Add or drop one class. Both paths go through the shared helpers so the
  // bounds stay strictly ascending and the colours stay distinct.
  const changeCount = (delta: number) => {
    const next = draft.classes.length + delta;
    if (next < MIN_CLASSES || next > MAX_CLASSES) return;
    if (delta < 0) {
      patch(removeClass(draft, draft.classes.length - 1, palette));
      return;
    }

    // Add a top class, splitting the current open-ended range at the midpoint
    // of its lower bound. The new class takes the next palette stop rather than
    // the top class's colour, so it is visibly distinct on the map and legend.
    const topBound = draft.classes[draft.classes.length - 2]?.upperBound ?? 0;
    const inferred = topBound * 2 || 1;
    const ramp = ATLAS_PALETTES[palette]?.stops.map(s => s.color) || [];
    patch({
      ...draft,
      classes: draft.classes
        .map((c, i) => (i === draft.classes.length - 1 ? { ...c, upperBound: inferred } : c))
        .concat([
          {
            upperBound: null,
            color: ramp[draft.classes.length] || ramp[ramp.length - 1] || '#888888'
          }
        ])
    });
  };

  // Remove a specific row. `classIndex` maps the displayed (low-value-first)
  // row onto the backing array, which is mirrored when `reverse` is on.
  const dropClass = (displayIndex: number) => {
    patch(removeClass(draft, classIndex(draft, displayIndex), palette));
  };

  // The ramp pick rides the same live-apply path as every other edit, so Cancel
  // restores the previous palette with the rest of the setting instead of
  // leaving the parent on a palette the operator backed out of.
  const choosePalette = (next: ExplorerChoroplethPalette) => {
    patch(applyPalette(draft, next));
    onPaletteChange(next);
  };

  // Edits already reached the map, so reverting has to push the snapshot back
  // out — setting local state alone would leave the live view on the edit.
  const handleCancel = () => {
    setDraft(applied);
    setIsDirty(false);
    onApply(applied);
    onPaletteChange(palette);
  };

  const handleSave = () => {
    onSave(draft);
    setApplied(draft);
    setIsDirty(false);
  };

  const previewColors = useMemo(() => classColors(draft), [draft]);

  const cellCount = useMemo(() => {
    const counts = new Array(draft.classes.length).fill(0);
    for (const v of metricValues) {
      if (!isFinite(v) || v <= 0) continue;
      counts[classIndexFor(draft, v)]++;
    }
    return counts;
  }, [draft, metricValues]);

  return (
    <div
      role="dialog"
      aria-label="Choropleth symbol settings"
      className="w-[300px] sm:w-[330px] rounded-2xl border style-surface backdrop-blur-2xl p-3 z-[1003] animate-in fade-in zoom-in-95 duration-150 max-h-[70vh] overflow-y-auto"
      style={{
        backgroundColor: 'var(--bg-card, rgba(12, 18, 30, 0.96))',
        borderColor: 'var(--border-subtle, rgba(255, 255, 255, 0.15))',
        color: 'var(--text-primary, #EEF2F1)',
        boxShadow: 'var(--card-shadow, 0 20px 40px -10px rgba(0,0,0,0.8))'
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--divider,rgba(255,255,255,0.08))]">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold truncate">Symbol settings</div>
          <div className="text-[9px] text-[var(--text-muted,#9BAAA9)] truncate">
            {metric} · {draft.classes.length} classes
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="p-1 rounded-lg hover:bg-white/5 text-[var(--text-muted,#9BAAA9)] hover:text-[var(--text-primary,#EEF2F1)] transition-colors cursor-pointer"
        >
          <X size={13} />
        </button>
      </div>

      {/* Live preview */}
      <div className="mt-2.5">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted,#9BAAA9)] mb-1">
          Preview
        </div>
        <div className="flex w-full h-4 rounded-md overflow-hidden border border-black/30">
          {previewColors.map((c, i) => (
            <div key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="flex items-center justify-between text-[8px] font-mono text-[var(--text-muted,#9BAAA9)] mt-1">
          <span>0</span>
          <span>{metricValues.length} cells</span>
        </div>
      </div>

      {/* Colour ramp */}
      <div className="mt-3">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted,#9BAAA9)] mb-1">
          Colour ramp
        </div>
        <div className="grid grid-cols-5 gap-1">
          {RAMP_IDS.map((id) => {
            const stops = ATLAS_PALETTES[id]?.stops || [];
            const isActive = id === palette;
            return (
              <button
                key={id}
                type="button"
                onClick={() => choosePalette(id)}
                title={id}
                aria-label={`Use ${id} ramp`}
                aria-pressed={isActive}
                className={`h-6 rounded-md overflow-hidden flex flex-col border transition-all cursor-pointer ${
                  isActive ? 'ring-1 ring-[var(--accent,rgba(255,255,255,0.4))]' : 'border-black/30 hover:opacity-80'
                }`}
              >
                {stops.slice(0, 4).map((s, i) => (
                  <span key={i} className="flex-1 w-full" style={{ backgroundColor: s.color }} />
                ))}
              </button>
            );
          })}
        </div>
      </div>

      {/* Break method */}
      <div className="mt-3">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted,#9BAAA9)] mb-1">
          Class breaks
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(BREAK_METHOD_LABELS) as BreakMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMethod(m)}
              aria-pressed={draft.method === m}
              className={`px-2 py-1 rounded-lg text-[10px] transition-colors cursor-pointer border ${
                draft.method === m
                  ? 'font-semibold'
                  : 'hover:bg-white/5 text-[var(--text-muted,#9BAAA9)]'
              }`}
              style={
                draft.method === m
                  ? {
                      backgroundColor: 'var(--accent-bg, rgba(255, 255, 255, 0.12))',
                      borderColor: 'var(--accent, rgba(255, 255, 255, 0.2))',
                      color: 'var(--text-primary, #EEF2F1)'
                    }
                  : { borderColor: 'var(--border-subtle, rgba(255,255,255,0.08))' }
              }
            >
              {BREAK_METHOD_LABELS[m].replace(/ \(.*\)/, '')}
            </button>
          ))}
        </div>
        <div className="text-[8.5px] text-[var(--text-muted,#9BAAA9)] mt-1 leading-snug">
          {BREAK_METHOD_HINTS[draft.method]}
        </div>
      </div>

      {/* Class rows */}
      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted,#9BAAA9)]">
            Classes
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => changeCount(-1)}
              disabled={draft.classes.length <= MIN_CLASSES}
              aria-label="Remove last class"
              className="w-5 h-5 rounded-md border border-[var(--border-subtle,rgba(255,255,255,0.1))] text-[11px] leading-none text-[var(--text-primary,#EEF2F1)] hover:bg-white/5 disabled:opacity-30 cursor-pointer"
            >
              −
            </button>
            <span className="font-mono text-[10px] text-[var(--text-muted,#9BAAA9)] w-6 text-center">
              {draft.classes.length}
            </span>
            <button
              type="button"
              onClick={() => changeCount(1)}
              disabled={draft.classes.length >= MAX_CLASSES}
              aria-label="Add class"
              className="w-5 h-5 rounded-md border border-[var(--border-subtle,rgba(255,255,255,0.1))] text-[11px] leading-none text-[var(--text-primary,#EEF2F1)] hover:bg-white/5 disabled:opacity-30 cursor-pointer"
            >
              +
            </button>
          </div>
        </div>

        {/* Rows are listed low-value-first matching `classes`, and the swatch shows
            `classColors(draft)[i]` — the colour the map paints on class i. */}
        {draft.classes.map((cls, i) => {
          const isTop = i === draft.classes.length - 1;
          return (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg px-1.5 py-1"
              style={{ backgroundColor: 'var(--bg-inner, rgba(255, 255, 255, 0.03))' }}
            >
              <input
                type="color"
                value={classColors(draft)[i] || cls.color}
                onChange={(e) => setColor(i, e.target.value)}
                aria-label={`Class ${i + 1} colour`}
                className="w-6 h-6 rounded-md border border-black/30 cursor-pointer bg-transparent p-0 shrink-0"
              />
              <span className="text-[9px] font-mono text-[var(--text-muted,#9BAAA9)] w-8 shrink-0">
                {i + 1}
              </span>
              <span className="text-[9.5px] text-[var(--text-primary,#EEF2F1)] truncate flex-1 min-w-0">
                {classRangeLabel(i, draft.classes, unit)}
              </span>
              {isTop ? (
                <span className="text-[8.5px] font-mono text-[var(--text-muted,#9BAAA9)] w-14 text-right shrink-0">
                  {cellCount[i] || 0} cells
                </span>
              ) : (
                <input
                  type="number"
                  value={cls.upperBound ?? ''}
                  step="any"
                  onChange={(e) => setBound(i, e.target.value)}
                  aria-label={`Class ${i + 1} upper bound`}
                  className="w-14 rounded-md px-1 py-0.5 text-[9.5px] font-mono text-right shrink-0"
                  style={{
                    backgroundColor: 'var(--input-bg, var(--bg-inner, rgba(255,255,255,0.05)))',
                    borderColor: 'var(--border-subtle, rgba(255,255,255,0.1))',
                    color: 'var(--text-primary, #EEF2F1)'
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => dropClass(i)}
                disabled={draft.classes.length <= MIN_CLASSES}
                aria-label={`Remove class ${i + 1}`}
                title={
                  isTop
                    ? `Remove class ${i + 1}`
                    : `Remove class ${i + 1}; class ${i} widens to cover it`
                }
                className="w-4 h-4 shrink-0 rounded text-[11px] leading-none text-[var(--text-muted,#9BAAA9)] hover:text-[var(--text-primary,#EEF2F1)] hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                −
              </button>
            </div>
          );
        })}
      </div>

      {/* Opacity + reverse */}
      <div className="mt-3 space-y-1.5 pt-2 border-t border-[var(--divider,rgba(255,255,255,0.08))]">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-[var(--text-muted,#9BAAA9)] w-14 shrink-0">Opacity</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={draft.alpha}
            onChange={(e) => patch({ ...draft, alpha: Number(e.target.value) })}
            aria-label="Fill opacity"
            className="flex-1 accent-[var(--accent,#38bdf8)]"
          />
          <span className="text-[9px] font-mono text-[var(--text-muted,#9BAAA9)] w-7 text-right">
            {Math.round(draft.alpha * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => patch(toggleReverse(draft))}
            aria-pressed={draft.reverse}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] border transition-colors cursor-pointer ${
              draft.reverse ? 'font-semibold' : 'text-[var(--text-muted,#9BAAA9)] hover:bg-white/5'
            }`}
            style={{
              backgroundColor: draft.reverse ? 'var(--accent-bg, rgba(255,255,255,0.12))' : 'transparent',
              borderColor: 'var(--border-subtle, rgba(255,255,255,0.1))',
              color: draft.reverse ? 'var(--text-primary, #EEF2F1)' : undefined
            }}
          >
            <RotateCcw size={11} />
            Reverse ramp
          </button>
          {draft.reverse && (
            <span className="text-[8.5px] text-[var(--text-muted,#9BAAA9)] truncate">
              high values use the light end
            </span>
          )}
        </div>
      </div>

      {/* Footer. There is no Apply button: every edit is already live, so this
          row only offers Revert and the database write. */}
      <div className="mt-3 pt-2 border-t border-[var(--divider,rgba(255,255,255,0.08))] flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleCancel}
          disabled={!isDirty}
          className="px-2.5 py-1 rounded-lg text-[10px] border border-[var(--border-subtle,rgba(255,255,255,0.1))] text-[var(--text-muted,#9BAAA9)] hover:bg-white/5 disabled:opacity-40 cursor-pointer"
        >
          Revert
        </button>
        <span className="text-[8.5px] text-[var(--text-muted,#9BAAA9)] leading-snug">
          Changes preview live.
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty}
          className="ml-auto flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-semibold disabled:opacity-40 cursor-pointer"
          style={{
            backgroundColor: 'var(--accent-bg, rgba(56, 189, 248, 0.2))',
            borderColor: 'var(--accent, rgba(56, 189, 248, 0.4))',
            color: 'var(--text-primary, #EEF2F1)'
          }}
        >
          <Check size={11} />
          Save
        </button>
      </div>
    </div>
  );
};
