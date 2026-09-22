import React, { useState } from 'react';
import {
  Sliders,
  SunMedium,
  Compass,
  Box,
  Play,
  Pause,
  RotateCcw,
  X,
  ChevronDown,
  ChevronUp,
  MapPin
} from 'lucide-react';
import {
  type LightingPreset,
  type ColorThemePreset,
  COLOR_THEMES
} from '../../utils/map3DLighting';

export interface RoadAnalysis3DStudioProps {
  show3D: boolean;
  onToggle3D: (active: boolean) => void;
  lightingPreset: LightingPreset;
  onSelectLighting: (preset: LightingPreset) => void;
  colorTheme: ColorThemePreset;
  onSelectTheme: (theme: ColorThemePreset) => void;
  heightScale: number;
  onChangeHeightScale: (scale: number) => void;
  currentPitch: number;
  onSetPitch: (pitch: number) => void;
  isOrbiting: boolean;
  onToggleOrbit: () => void;
  onResetBearing: () => void;
  onClose: () => void;
  showLabels?: boolean;
  onToggleLabels?: (show: boolean) => void;
  atmosphereTint?: boolean;
  onToggleAtmosphereTint?: (tint: boolean) => void;
}

export const RoadAnalysis3DStudio: React.FC<RoadAnalysis3DStudioProps> = ({
  show3D,
  onToggle3D,
  lightingPreset,
  onSelectLighting,
  colorTheme,
  onSelectTheme,
  heightScale,
  onChangeHeightScale,
  currentPitch,
  onSetPitch,
  isOrbiting,
  onToggleOrbit,
  onResetBearing,
  onClose,
  showLabels = true,
  onToggleLabels,
  atmosphereTint = true,
  onToggleAtmosphereTint
}) => {
  const [minimized, setMinimized] = useState(false);

  const lightingItems: Array<{ id: LightingPreset; label: string }> = [
    { id: 'dawn', label: 'Dawn' },
    { id: 'day', label: 'Day' },
    { id: 'dusk', label: 'Dusk' },
    { id: 'night', label: 'Night' }
  ];

  const themeKeys = Object.keys(COLOR_THEMES) as ColorThemePreset[];

  const pitchPresets = [
    { pitch: 0, label: '2D Flat' },
    { pitch: 45, label: '45°' },
    { pitch: 60, label: '60° Swoop' }
  ];

  return (
    <div
      className="absolute top-14 left-3 z-[1001] w-80 rounded-xl border border-white/10 bg-[#0d131f]/95 backdrop-blur-xl shadow-2xl text-neutral-100 overflow-hidden transition-all select-none animate-in fade-in slide-in-from-top-2 duration-200"
      style={{
        boxShadow: '0 20px 45px -15px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08)'
      }}
    >
      {/* Studio Header — Clean, monochrome, no colored icon */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-black/40 border-b border-white/10">
        <div className="flex items-center gap-2 min-w-0">
          <Sliders size={14} className="text-neutral-400 shrink-0" />
          <span className="text-xs font-semibold text-white tracking-tight">
            3D Map Studio
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title={minimized ? 'Expand Studio' : 'Minimize Studio'}
          >
            {minimized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="Close 3D Studio"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="p-3 space-y-3.5 text-xs">
          {/* 1. AVAILABLE 3D THEMES (Matches Theme Settings style) */}
          <div>
            <div className="flex items-center justify-between text-[10.5px] font-mono font-semibold tracking-wider text-neutral-400 uppercase mb-2">
              <span className="flex items-center gap-1.5">
                <Sliders size={12} className="text-neutral-500" />
                Available Themes
              </span>
              <button
                type="button"
                onClick={() => onSelectTheme('default')}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer capitalize font-sans tracking-normal"
              >
                Reset
              </button>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/30 overflow-hidden divide-y divide-white/[0.06]">
              {themeKeys.map((key) => {
                const conf = COLOR_THEMES[key];
                const isActive = colorTheme === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onSelectTheme(key)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors text-left cursor-pointer ${
                      isActive
                        ? 'bg-white/[0.07] text-white font-medium'
                        : 'text-neutral-300 hover:bg-white/[0.03] hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isActive ? (
                        <span className="w-3.5 h-3.5 rounded-full bg-white text-slate-950 flex items-center justify-center shrink-0">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <polyline points="2.5 6 4.8 8.5 9.5 3.5" />
                          </svg>
                        </span>
                      ) : (
                        <span
                          className="w-2 h-2 rounded-full shrink-0 ml-0.5"
                          style={{ backgroundColor: conf.previewDots[1] || '#94a3b8' }}
                        />
                      )}
                      <span className="truncate text-[11.5px]">{conf.name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {conf.previewDots.map((dotColor, i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full border border-black/40 shrink-0"
                          style={{ backgroundColor: dotColor }}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. STYLE OVERRIDES SECTION (Lighting, Perspective, Buildings) */}
          <div className="pt-2.5 border-t border-white/10 space-y-3">
            <div className="text-[10.5px] font-mono font-semibold tracking-wider text-neutral-400 uppercase">
              <span className="flex items-center gap-1.5">
                <Sliders size={12} className="text-neutral-500" />
                Style Overrides
              </span>
            </div>

            {/* Lighting Mode Row (Radio options) */}
            <div>
              <div className="flex items-center justify-between text-[11.5px] font-medium text-neutral-200 mb-1.5">
                <span className="flex items-center gap-1.5 text-neutral-300">
                  <SunMedium size={12} className="text-neutral-400" />
                  Lighting
                </span>
                <span className="text-[10px] text-neutral-500 capitalize">{lightingPreset}</span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-0.5">
                {lightingItems.map((item) => {
                  const isActive = lightingPreset === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectLighting(item.id)}
                      className="flex items-center gap-1.5 text-xs cursor-pointer select-none transition-colors group"
                    >
                      {isActive ? (
                        <span className="w-3.5 h-3.5 rounded-full bg-white text-slate-950 flex items-center justify-center shrink-0">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <polyline points="2.5 6 4.8 8.5 9.5 3.5" />
                          </svg>
                        </span>
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full border border-neutral-600 group-hover:border-neutral-400 shrink-0 inline-block" />
                      )}
                      <span className={isActive ? 'text-white font-medium' : 'text-neutral-400 group-hover:text-neutral-200'}>
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Camera Perspective Pitch (Radio options) */}
            <div className="pt-2.5 border-t border-white/[0.06]">
              <div className="flex items-center justify-between text-[11.5px] font-medium text-neutral-200 mb-1.5">
                <span className="flex items-center gap-1.5 text-neutral-300">
                  <Compass size={12} className="text-neutral-400" />
                  Camera Perspective
                </span>
                <span className="text-[10px] text-neutral-500">{Math.round(currentPitch)}° Pitch</span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-0.5">
                {pitchPresets.map((p) => {
                  const isSelected = Math.abs(currentPitch - p.pitch) < 5;
                  return (
                    <button
                      key={p.pitch}
                      type="button"
                      onClick={() => onSetPitch(p.pitch)}
                      className="flex items-center gap-1.5 text-xs cursor-pointer select-none transition-colors group"
                    >
                      {isSelected ? (
                        <span className="w-3.5 h-3.5 rounded-full bg-white text-slate-950 flex items-center justify-center shrink-0">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <polyline points="2.5 6 4.8 8.5 9.5 3.5" />
                          </svg>
                        </span>
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full border border-neutral-600 group-hover:border-neutral-400 shrink-0 inline-block" />
                      )}
                      <span className={isSelected ? 'text-white font-medium' : 'text-neutral-400 group-hover:text-neutral-200'}>
                        {p.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Action Buttons: Cinematic Orbit & North */}
              <div className="flex items-center gap-2 mt-2.5 pt-1">
                <button
                  type="button"
                  onClick={onToggleOrbit}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                    isOrbiting
                      ? 'bg-white/10 border-white/30 text-white shadow-sm'
                      : 'bg-white/[0.03] border-white/10 text-neutral-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                  title={isOrbiting ? 'Stop Camera Orbit' : 'Start Cinematic 360° Camera Orbit'}
                >
                  {isOrbiting ? <Pause size={12} className="text-neutral-300" /> : <Play size={12} className="text-neutral-300" />}
                  <span>{isOrbiting ? 'Orbiting…' : 'Cinematic Orbit'}</span>
                </button>

                <button
                  type="button"
                  onClick={onResetBearing}
                  className="flex items-center gap-1 py-1.5 px-3 rounded-lg border border-white/10 bg-white/[0.03] text-neutral-300 hover:bg-white/[0.08] hover:text-white transition-all text-xs cursor-pointer"
                  title="Reset North Orientation"
                >
                  <RotateCcw size={11} className="text-neutral-400" />
                  <span>North</span>
                </button>
              </div>
            </div>

            {/* 3D Buildings & Height Scale */}
            <div className="pt-2.5 border-t border-white/[0.06]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                  <Box size={12} className="text-neutral-400" />
                  3D Buildings
                </span>
                <button
                  type="button"
                  onClick={() => onToggle3D(!show3D)}
                  className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    show3D ? 'bg-sky-500' : 'bg-neutral-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      show3D ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {show3D && (
                <div className="mt-2.5 pt-1.5">
                  <div className="text-[10.5px] text-neutral-400 mb-1.5">Height Scale</div>
                  <div className="flex items-center gap-4 px-0.5">
                    {[1.0, 1.5, 2.0].map((scale) => {
                      const isSelected = heightScale === scale;
                      return (
                        <button
                          key={scale}
                          type="button"
                          onClick={() => onChangeHeightScale(scale)}
                          className="flex items-center gap-1.5 text-xs cursor-pointer select-none transition-colors group"
                        >
                          {isSelected ? (
                            <span className="w-3.5 h-3.5 rounded-full bg-white text-slate-950 flex items-center justify-center shrink-0">
                              <svg className="w-2.5 h-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2">
                                <polyline points="2.5 6 4.8 8.5 9.5 3.5" />
                              </svg>
                            </span>
                          ) : (
                            <span className="w-3.5 h-3.5 rounded-full border border-neutral-600 group-hover:border-neutral-400 shrink-0 inline-block" />
                          )}
                          <span className={isSelected ? 'text-white font-medium' : 'text-neutral-400 group-hover:text-neutral-200'}>
                            {scale}x
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Atmosphere Ground Tint */}
            {onToggleAtmosphereTint && (
              <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                  <SunMedium size={12} className="text-neutral-400" />
                  Atmosphere Tint
                </span>
                <button
                  type="button"
                  onClick={() => onToggleAtmosphereTint(!atmosphereTint)}
                  className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    atmosphereTint ? 'bg-sky-500' : 'bg-neutral-700'
                  }`}
                  title={atmosphereTint ? 'Disable atmospheric ground tint' : 'Enable atmospheric ground tint'}
                >
                  <span
                    className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      atmosphereTint ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Place & POI Labels */}
            {onToggleLabels && (
              <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
                  <MapPin size={12} className="text-neutral-400" />
                  Place & POI Labels
                </span>
                <button
                  type="button"
                  onClick={() => onToggleLabels(!showLabels)}
                  className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    showLabels ? 'bg-sky-500' : 'bg-neutral-700'
                  }`}
                  title={showLabels ? 'Hide basemap place names and POIs' : 'Show basemap place names and POIs'}
                >
                  <span
                    className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      showLabels ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
