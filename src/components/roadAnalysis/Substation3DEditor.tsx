import React from 'react';
import { Zap } from 'lucide-react';
import type { CatalogVectorLayer } from '../../utils/gisImportParser';
import {
  type SubstationType,
  type SubstationVoltage,
  SUBSTATION_3D_PRESETS
} from '../../utils/substationTypes';
import { CommitSlider } from './CommitSlider';
import { getSliderStyle } from './sliderStyle';

export interface Substation3DEditorProps {
  layer: CatalogVectorLayer;
  onUpdate: (layerId: string, updates: Partial<CatalogVectorLayer>) => void;
  onLiveUpdate?: (layerId: string, updates: Partial<CatalogVectorLayer>) => void;
}

const MODEL_COLORS = ['#2563eb', '#ea580c', '#dc2626', '#475569', '#10b981', '#7c3aed'];

/**
 * 3D Substation model controls (PE / SSU / PPU) for a single catalog layer.
 * Extracted from RoadCatalogPanel so that god file stays within its size budget.
 */
export const Substation3DEditor: React.FC<Substation3DEditorProps> = ({
  layer,
  onUpdate,
  onLiveUpdate
}) => {
  const sub = layer.substation3D;

  return (
    <div className="flex flex-col gap-2 pt-2.5 border-t border-subtle/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Zap size={11} className={sub?.enabled ? 'text-amber-400' : 'text-text-muted'} />
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-widest">
            3D Substation Model
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            const nextEnabled = !sub?.enabled;
            const currentConf = sub || {
              enabled: true,
              ...SUBSTATION_3D_PRESETS.PE
            };
            onUpdate(layer.id, {
              substation3D: { ...currentConf, enabled: nextEnabled }
            });
          }}
          className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors cursor-pointer ${
            sub?.enabled
              ? 'bg-inner border border-amber-500/70 text-amber-400 font-semibold shadow-sm'
              : 'text-text-muted hover:text-text-base border border-subtle'
          }`}
        >
          {sub?.enabled ? '3D Active' : 'Disabled'}
        </button>
      </div>

      {sub?.enabled && (
        <div className="flex flex-col gap-2.5 bg-inner/30 rounded-md p-2.5 border border-amber-500/30">
          {/* Station Type Presets (PE / SSU / PPU) */}
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-text-muted font-medium">Substation Classification</span>
            <div className="grid grid-cols-3 gap-1">
              {(['PE', 'SSU', 'PPU'] as SubstationType[]).map((stType) => {
                const isSelected = (sub.type || 'PE') === stType;
                return (
                  <button
                    key={stType}
                    type="button"
                    onClick={() => {
                      const preset = SUBSTATION_3D_PRESETS[stType];
                      onUpdate(layer.id, {
                        substation3D: {
                          ...sub,
                          enabled: true,
                          ...preset
                        }
                      });
                    }}
                    className={`py-1 px-1.5 rounded text-[10px] font-semibold border flex flex-col items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-sm'
                        : 'bg-app border-subtle text-text-muted hover:text-text-base hover:border-subtle'
                    }`}
                  >
                    <span>{stType}</span>
                    <span className="text-[8px] opacity-75 font-normal">
                      {stType === 'PE' ? '11kV Dist.' : stType === 'SSU' ? 'Switching' : '33kV Bulk'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Voltage Selection */}
          <div className="flex items-center justify-between text-[9px] pt-1 border-t border-subtle/40">
            <span className="text-text-muted font-medium">Voltage Rating:</span>
            <div className="flex items-center gap-1">
              {(['11kV', '22kV', '33kV'] as SubstationVoltage[]).map((volt) => (
                <button
                  key={volt}
                  type="button"
                  onClick={() => {
                    onUpdate(layer.id, {
                      substation3D: {
                        ...sub,
                        voltage: volt
                      }
                    });
                  }}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono border cursor-pointer transition-colors ${
                    (sub.voltage || '11kV') === volt
                      ? 'bg-sky-500/20 border-sky-400 text-sky-300 font-bold'
                      : 'text-text-muted border-subtle hover:text-text-base'
                  }`}
                >
                  {volt}
                </button>
              ))}
            </div>
          </div>

          {/* Building Height Slider */}
          <div className="flex flex-col gap-1 pt-1 border-t border-subtle/40">
            <div className="flex items-center justify-between text-[9px]">
              <span className="text-text-muted font-medium">Extrusion Height</span>
              <span className="font-mono text-amber-300 font-semibold">
                {sub.height ?? 4.5} m
              </span>
            </div>
            <CommitSlider
              value={sub.height ?? 4.5}
              min={2}
              max={30}
              step={0.5}
              onPreview={(v) =>
                onLiveUpdate?.(layer.id, {
                  substation3D: { ...sub, height: v }
                })
              }
              onCommit={(v) =>
                onUpdate(layer.id, {
                  substation3D: { ...sub, height: v }
                })
              }
              style={getSliderStyle(sub.wallColor || '#f59e0b')}
              className="slider-sm"
            />
          </div>

          {/* Footprint Dimensions (for point/mixed features) */}
          {(layer.geometryType === 'Point' || layer.geometryType === 'Mixed') && (
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-subtle/40">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-text-muted font-medium">Width</span>
                  <span className="font-mono text-text-base font-semibold">{sub.footprintWidth ?? 8} m</span>
                </div>
                <CommitSlider
                  value={sub.footprintWidth ?? 8}
                  min={3}
                  max={60}
                  step={1}
                  onPreview={(v) =>
                    onLiveUpdate?.(layer.id, {
                      substation3D: { ...sub, footprintWidth: v }
                    })
                  }
                  onCommit={(v) =>
                    onUpdate(layer.id, {
                      substation3D: { ...sub, footprintWidth: v }
                    })
                  }
                  style={getSliderStyle(sub.wallColor || '#f59e0b')}
                  className="slider-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[9px]">
                  <span className="text-text-muted font-medium">Length</span>
                  <span className="font-mono text-text-base font-semibold">{sub.footprintLength ?? 6} m</span>
                </div>
                <CommitSlider
                  value={sub.footprintLength ?? 6}
                  min={3}
                  max={60}
                  step={1}
                  onPreview={(v) =>
                    onLiveUpdate?.(layer.id, {
                      substation3D: { ...sub, footprintLength: v }
                    })
                  }
                  onCommit={(v) =>
                    onUpdate(layer.id, {
                      substation3D: { ...sub, footprintLength: v }
                    })
                  }
                  style={getSliderStyle(sub.wallColor || '#f59e0b')}
                  className="slider-sm"
                />
              </div>
            </div>
          )}

          {/* Building Wall Color */}
          <div className="flex items-center justify-between text-[9px] pt-1 border-t border-subtle/40">
            <span className="text-text-muted font-medium">Model Color:</span>
            <div className="flex items-center gap-1.5">
              {MODEL_COLORS.map((wc) => (
                <button
                  key={wc}
                  type="button"
                  onClick={() => {
                    onUpdate(layer.id, {
                      substation3D: { ...sub, wallColor: wc }
                    });
                  }}
                  style={{ backgroundColor: wc }}
                  className={`w-3.5 h-3.5 rounded-full border border-white/20 cursor-pointer ${
                    (sub.wallColor || '#2563eb') === wc
                      ? 'ring-1.5 ring-amber-400 ring-offset-1 ring-offset-slate-900 scale-110'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  title={`Color ${wc}`}
                />
              ))}
            </div>
          </div>

          {/* Show Voltage Badge Floating Label Toggle */}
          <label className="flex items-center justify-between text-[9px] pt-1 border-t border-subtle/40 cursor-pointer select-none">
            <span className="text-text-muted font-medium">Show Overhead Voltage Badge</span>
            <input
              type="checkbox"
              checked={sub.showVoltageBadge !== false}
              onChange={(e) => {
                onUpdate(layer.id, {
                  substation3D: {
                    ...sub,
                    showVoltageBadge: e.target.checked
                  }
                });
              }}
              className="rounded border-subtle text-amber-500 focus:ring-0 cursor-pointer w-3 h-3"
            />
          </label>
        </div>
      )}
    </div>
  );
};
