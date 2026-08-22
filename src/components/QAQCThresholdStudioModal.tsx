import React, { useState, useMemo } from 'react';
import {
  RotateCcw,
  Check,
  Zap,
  EyeOff,
  Sun
} from 'lucide-react';

export interface QAQCThresholdsData {
  blurVarianceThreshold: number;
  gpsMaxJumpDistanceMeters: number;
  obstructionMinBrightness: number;
  glareLuminanceThreshold: number;
}

export interface QAQCThresholdStudioViewProps {
  thresholds: QAQCThresholdsData;
  setThresholds: React.Dispatch<React.SetStateAction<QAQCThresholdsData>>;
  onSave?: (updated: QAQCThresholdsData) => void;
  onResetDefaults?: () => void;
}

export const QAQCThresholdStudioView: React.FC<QAQCThresholdStudioViewProps> = ({
  thresholds,
  setThresholds,
  onSave,
  onResetDefaults
}) => {
  const [activeDefectTab, setActiveDefectTab] = useState<'blur' | 'obstruction' | 'gps'>('blur');
  const [showToast, setShowToast] = useState<boolean>(false);

  // Tab 1: Blur simulation interactive controls
  const [blurPreviewLevel, setBlurPreviewLevel] = useState<number>(1.0);
  const [isComparingSplit, setIsComparingSplit] = useState<boolean>(true);
  const [splitPosition, setSplitPosition] = useState<number>(50);

  // Tab 2: Lens Defect simulation interactive controls
  const [obstructionSimMode, setObstructionSimMode] = useState<'glitch' | 'blackout' | 'glare'>('glitch');
  const [glitchIntensity, setGlitchIntensity] = useState<number>(100);
  const [blackoutSimLevel, setBlackoutSimLevel] = useState<number>(12);
  const [glareSimLevel, setGlareSimLevel] = useState<number>(245);
  const [isComparingSplitObstruction, setIsComparingSplitObstruction] = useState<boolean>(true);
  const [splitPositionObstruction, setSplitPositionObstruction] = useState<number>(50);

  // Simulated live scores for Blur
  const simulatedSharpScore = 84.6;
  const simulatedBlurScore = useMemo(() => {
    const score = Math.max(12.0, Math.round((84.6 / (1 + blurPreviewLevel * 0.75)) * 10) / 10);
    return score;
  }, [blurPreviewLevel]);

  const isSimulatedBlurFlagged = simulatedBlurScore < thresholds.blurVarianceThreshold;

  // Evaluation for Tab 2
  const isObstructionFlagged = useMemo(() => {
    if (obstructionSimMode === 'glitch') {
      return glitchIntensity >= 25;
    }
    if (obstructionSimMode === 'blackout') {
      return blackoutSimLevel < thresholds.obstructionMinBrightness;
    }
    if (obstructionSimMode === 'glare') {
      return glareSimLevel >= thresholds.glareLuminanceThreshold;
    }
    return false;
  }, [obstructionSimMode, glitchIntensity, blackoutSimLevel, glareSimLevel, thresholds]);

  const handleReset = () => {
    if (onResetDefaults) {
      onResetDefaults();
    } else {
      setThresholds({
        blurVarianceThreshold: 60.0,
        gpsMaxJumpDistanceMeters: 50.0,
        obstructionMinBrightness: 15.0,
        glareLuminanceThreshold: 240.0
      });
    }
    setBlurPreviewLevel(1.0);
    setGlitchIntensity(100);
    setBlackoutSimLevel(12);
    setGlareSimLevel(245);
  };

  const handleApply = () => {
    if (onSave) {
      onSave(thresholds);
    }
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 1200);
  };

  return (
    <div className="flex-1 p-2 sm:p-3.5 gap-2 sm:gap-3.5 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-app min-h-0">

      {/* Toast Notification (Professional, non-colorful) */}
      {showToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100000] px-4 py-2.5 rounded-xl bg-card border border-subtle text-text-base text-xs font-medium shadow-2xl flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-150">
          <Check size={14} className="text-zinc-300 shrink-0" />
          <span>Threshold settings applied and saved successfully.</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. LEFT MAIN CARD: INSPECTION CANVAS (FOLLOWS QA/QC BORDER RULES) */}
      {/* ========================================================================= */}
      <main className="flex-1 bg-card/90 backdrop-blur-md border border-subtle rounded-2xl flex flex-col overflow-hidden shadow-xl ring-1 ring-white/5 relative min-w-0">

        {/* Canvas Top Bar: Benchmark Context, Centered Defect Switcher, View Toggles */}
        <div className="min-h-14 py-2 sm:py-0 px-3 sm:px-4 border-b border-subtle flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 shrink-0 bg-card relative z-10">

          {/* Left: Benchmark Identifier */}
          <div className="flex items-center gap-2 text-xs min-w-0">
            <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" />
            <span className="font-semibold text-zinc-200 truncate">
              {activeDefectTab === 'blur' && 'Blur Focus Calibration'}
              {activeDefectTab === 'obstruction' && 'Sensor Glitch & Obstruction'}
              {activeDefectTab === 'gps' && 'GPS Jump Telemetry'}
            </span>
          </div>

          {/* Center: Defect Sub-Tabs Switcher — Centered with Canvas Inspection! */}
          <div className="flex items-center p-1 rounded-xl bg-inner border border-subtle shadow-inner overflow-x-auto no-scrollbar gap-1">
            <button
              type="button"
              onClick={() => setActiveDefectTab('blur')}
              className={`px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${activeDefectTab === 'blur'
                  ? 'bg-card text-white shadow-sm ring-1 ring-white/10'
                  : 'text-text-muted hover:text-text-base'
                }`}
            >
              Blur Detection
            </button>
            <button
              type="button"
              onClick={() => setActiveDefectTab('obstruction')}
              className={`px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${activeDefectTab === 'obstruction'
                  ? 'bg-card text-white shadow-sm ring-1 ring-white/10'
                  : 'text-text-muted hover:text-text-base'
                }`}
            >
              Lens &amp; Glitch
            </button>
            <button
              type="button"
              onClick={() => setActiveDefectTab('gps')}
              className={`px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${activeDefectTab === 'gps'
                  ? 'bg-card text-white shadow-sm ring-1 ring-white/10'
                  : 'text-text-muted hover:text-text-base'
                }`}
            >
              GPS Telemetry
            </button>
          </div>

          {/* Right: View Toggle (Split / Side-by-Side) */}
          <div className="flex items-center justify-end gap-2 shrink-0">
            {activeDefectTab !== 'gps' ? (
              <button
                type="button"
                onClick={() => {
                  if (activeDefectTab === 'blur') setIsComparingSplit(!isComparingSplit);
                  else setIsComparingSplitObstruction(!isComparingSplitObstruction);
                }}
                className="w-full md:w-auto px-3 py-1.5 rounded-xl bg-inner hover:bg-inner/80 border border-subtle text-xs font-semibold text-zinc-300 hover:text-white transition-all cursor-pointer shadow-sm active:scale-95 text-center"
              >
                {(activeDefectTab === 'blur' ? isComparingSplit : isComparingSplitObstruction)
                  ? 'Side-by-Side'
                  : 'Split Slider'}
              </button>
            ) : (
              <span className="text-[10px] sm:text-[11px] text-zinc-500 font-mono">Haversine Geodesic</span>
            )}
          </div>
        </div>

        {/* Viewport Frame */}
        <div className="flex-1 bg-black relative flex flex-col p-2 sm:p-3 overflow-hidden select-none min-h-[260px]">
          <div className="flex-1 relative w-full h-full rounded-xl overflow-hidden border border-subtle bg-zinc-950 flex items-center justify-center shadow-inner">

            {/* ------------------------------------------------------------- */}
            {/* TAB 1: BLUR PREVIEW VIEWPORT */}
            {/* ------------------------------------------------------------- */}
            {activeDefectTab === 'blur' && (
              isComparingSplit ? (
                /* Interactive Split Comparison View */
                <div className="relative w-full h-full overflow-hidden">
                  {/* Underlying Blurry Layer */}
                  <div
                    className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center transition-all duration-75"
                    style={{
                      backgroundImage: `url('/samples/sample_survey_sharp.jpg')`,
                      filter: `blur(${blurPreviewLevel}px)`
                    }}
                  />

                  {/* Overlay Sharp Layer (Clipped by Split Slider) */}
                  <div
                    className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center border-r-2 border-zinc-400 pointer-events-none"
                    style={{
                      backgroundImage: `url('/samples/sample_survey_sharp.jpg')`,
                      clipPath: `polygon(0 0, ${splitPosition}% 0, ${splitPosition}% 100%, 0 100%)`
                    }}
                  />

                  {/* High-Contrast Solid Dark HUD Cards */}
                  {/* Left HUD: Baseline Sharp */}
                  <div className="absolute top-2 sm:top-4 left-2 sm:left-4 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs shadow-2xl flex items-center gap-2 z-10">
                    <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" />
                    <span className="text-zinc-300 font-medium">Sharp Base</span>
                    <span className="font-mono text-zinc-100 font-bold text-xs sm:text-sm tabular-nums">{simulatedSharpScore.toFixed(1)}</span>
                  </div>

                  {/* Right HUD: Test Scan */}
                  <div className="absolute top-2 sm:top-4 right-2 sm:right-4 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs shadow-2xl flex items-center gap-1.5 sm:gap-2.5 z-10">
                    <span className={`w-2 h-2 rounded-full ${isSimulatedBlurFlagged ? 'bg-rose-400' : 'bg-emerald-400'} shrink-0`} />
                    <span className="text-zinc-300 font-medium hidden xs:inline">Simulated</span>
                    <span className="font-mono font-bold text-zinc-100 text-xs sm:text-sm tabular-nums">{simulatedBlurScore.toFixed(1)}</span>
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-semibold ${isSimulatedBlurFlagged
                        ? 'bg-rose-950 text-rose-300 border border-rose-700/80'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-700/80'
                      }`}>
                      {isSimulatedBlurFlagged ? 'Defect' : 'Passed'}
                    </span>
                  </div>

                  {/* Split Drag Range Input */}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={splitPosition}
                    onChange={(e) => setSplitPosition(Number(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                  />

                  {/* Split Divider Bar */}
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10 flex items-center justify-center -translate-x-1/2"
                    style={{ left: `${splitPosition}%` }}
                  >
                    <div className="w-0.5 h-full bg-zinc-400 shadow-md" />
                    <div className="absolute w-7 h-7 rounded-full bg-zinc-900 border border-zinc-500 text-zinc-200 flex items-center justify-center shadow-2xl text-xs font-mono font-bold">
                      ↔
                    </div>
                  </div>

                  {/* Center Helper Text */}
                  <div className="hidden sm:block absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-zinc-950/95 border border-zinc-700/80 text-xs text-zinc-300 font-sans pointer-events-none shadow-2xl whitespace-nowrap">
                    Drag split divider horizontally to compare Sharp (Left) vs Blurry (Right)
                  </div>
                </div>
              ) : (
                /* Side-by-Side Dual View */
                <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3.5 p-2 sm:p-3.5">
                  <div className="relative rounded-xl overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src="/samples/sample_survey_sharp.jpg"
                      alt="Sharp Reference"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2 sm:top-3 left-2 sm:left-3 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs text-zinc-200 flex items-center gap-1.5 sm:gap-2 shadow-xl">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                      <span className="font-medium">Sharp Base ({simulatedSharpScore.toFixed(1)})</span>
                    </div>
                  </div>

                  <div className="relative rounded-xl overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src="/samples/sample_survey_sharp.jpg"
                      alt="Simulated Blurry Frame"
                      className="w-full h-full object-contain"
                      style={{ filter: `blur(${blurPreviewLevel}px)` }}
                    />
                    <div className="absolute top-2 sm:top-3 left-2 sm:left-3 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs text-zinc-200 flex items-center gap-1.5 sm:gap-2 shadow-xl">
                      <span className={`w-1.5 h-1.5 rounded-full ${isSimulatedBlurFlagged ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                      <span className="font-medium">Simulated ({simulatedBlurScore.toFixed(1)})</span>
                      <span className={`text-[10px] sm:text-xs font-semibold ${isSimulatedBlurFlagged ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {isSimulatedBlurFlagged ? '• Defect' : '• Passed'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* ------------------------------------------------------------- */}
            {/* TAB 2: LENS OBSTRUCTION & GLITCH VIEWPORT */}
            {/* ------------------------------------------------------------- */}
            {activeDefectTab === 'obstruction' && (
              isComparingSplitObstruction ? (
                /* Interactive Split Comparison View for Glitch/Obstruction */
                <div className="relative w-full h-full overflow-hidden">
                  {/* Underlying Glitched / Occluded Layer */}
                  <div className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center transition-all duration-75">
                    {/* Sharp Baseline Base */}
                    <div
                      className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center"
                      style={{
                        backgroundImage: `url('/samples/sample_survey_sharp.jpg')`,
                        filter: obstructionSimMode === 'blackout'
                          ? `brightness(${Math.max(0.04, blackoutSimLevel / 120)})`
                          : obstructionSimMode === 'glare'
                            ? `brightness(${1 + (glareSimLevel - 180) / 75 * 1.8}) contrast(${1 - (glareSimLevel - 180) / 75 * 0.3})`
                            : 'none'
                      }}
                    />

                    {/* Glitch Overlay */}
                    {obstructionSimMode === 'glitch' && (
                      <div
                        className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center transition-opacity duration-75"
                        style={{
                          backgroundImage: `url('/samples/sample_survey_glitch.jpg')`,
                          opacity: glitchIntensity / 100
                        }}
                      />
                    )}
                  </div>

                  {/* Overlay Clean Baseline Layer (Clipped by Split Slider) */}
                  <div
                    className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center border-r-2 border-zinc-400 pointer-events-none"
                    style={{
                      backgroundImage: `url('/samples/sample_survey_sharp.jpg')`,
                      clipPath: `polygon(0 0, ${splitPositionObstruction}% 0, ${splitPositionObstruction}% 100%, 0 100%)`
                    }}
                  />

                  {/* HUD Cards */}
                  <div className="absolute top-2 sm:top-4 left-2 sm:left-4 px-2.5 sm:px-3.5 py-1 sm:py-2 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs shadow-2xl flex items-center gap-1.5 sm:gap-2.5 z-10">
                    <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" />
                    <span className="text-zinc-300 font-medium">Nominal Sensor</span>
                    <span className="font-mono text-zinc-100 font-bold text-xs sm:text-sm tabular-nums">132.0</span>
                  </div>

                  <div className="absolute top-2 sm:top-4 right-2 sm:right-4 px-2.5 sm:px-3.5 py-1 sm:py-2 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs shadow-2xl flex items-center gap-1.5 sm:gap-2.5 z-10">
                    <span className={`w-2 h-2 rounded-full ${isObstructionFlagged ? 'bg-rose-400' : 'bg-emerald-400'} shrink-0`} />
                    <span className="text-zinc-300 font-medium hidden xs:inline">
                      {obstructionSimMode === 'glitch' && `Glitch (${glitchIntensity}%)`}
                      {obstructionSimMode === 'blackout' && `Luma ${blackoutSimLevel}`}
                      {obstructionSimMode === 'glare' && `Luma ${glareSimLevel}`}
                    </span>
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] sm:text-[11px] font-semibold ${isObstructionFlagged
                        ? 'bg-rose-950 text-rose-300 border border-rose-700/80'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-700/80'
                      }`}>
                      {isObstructionFlagged ? 'Defect' : 'Passed'}
                    </span>
                  </div>

                  {/* Split Drag Range Input */}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={splitPositionObstruction}
                    onChange={(e) => setSplitPositionObstruction(Number(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                  />

                  {/* Split Divider Bar */}
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10 flex items-center justify-center -translate-x-1/2"
                    style={{ left: `${splitPositionObstruction}%` }}
                  >
                    <div className="w-0.5 h-full bg-zinc-400 shadow-md" />
                    <div className="absolute w-7 h-7 rounded-full bg-zinc-900 border border-zinc-500 text-zinc-200 flex items-center justify-center shadow-2xl text-xs font-mono font-bold">
                      ↔
                    </div>
                  </div>

                  {/* Center Helper Text */}
                  <div className="hidden sm:block absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-zinc-950/95 border border-zinc-700/80 text-xs text-zinc-300 font-sans pointer-events-none shadow-2xl whitespace-nowrap">
                    Drag split divider horizontally to compare Nominal (Left) vs Glitched/Occluded (Right)
                  </div>
                </div>
              ) : (
                /* Side-by-Side Dual View */
                <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3.5 p-2 sm:p-3.5">
                  <div className="relative rounded-xl overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src="/samples/sample_survey_sharp.jpg"
                      alt="Nominal Clean Frame"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2 sm:top-3 left-2 sm:left-3 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs text-zinc-200 flex items-center gap-1.5 sm:gap-2 shadow-xl">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                      <span className="font-medium">Nominal (Clear)</span>
                    </div>
                    <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[10px] sm:text-xs font-mono text-zinc-400 tabular-nums shadow-xl">
                      Luma: 132.0 • Passed
                    </div>
                  </div>

                  <div className="relative rounded-xl overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <div
                      className="w-full h-full bg-contain bg-no-repeat bg-center"
                      style={{
                        backgroundImage: `url('/samples/sample_survey_sharp.jpg')`,
                        filter: obstructionSimMode === 'blackout'
                          ? `brightness(${Math.max(0.04, blackoutSimLevel / 120)})`
                          : obstructionSimMode === 'glare'
                            ? `brightness(${1 + (glareSimLevel - 180) / 75 * 1.8}) contrast(${1 - (glareSimLevel - 180) / 75 * 0.3})`
                            : 'none'
                      }}
                    />

                    {obstructionSimMode === 'glitch' && (
                      <div
                        className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center transition-opacity duration-75"
                        style={{
                          backgroundImage: `url('/samples/sample_survey_glitch.jpg')`,
                          opacity: glitchIntensity / 100
                        }}
                      />
                    )}

                    <div className="absolute top-2 sm:top-3 left-2 sm:left-3 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs text-zinc-200 flex items-center gap-1.5 sm:gap-2 shadow-xl">
                      <span className={`w-1.5 h-1.5 rounded-full ${isObstructionFlagged ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                      <span className="font-medium text-[11px] sm:text-xs">
                        {obstructionSimMode === 'glitch' && `Glitch (${glitchIntensity}%)`}
                        {obstructionSimMode === 'blackout' && `Blackout (Luma ${blackoutSimLevel})`}
                        {obstructionSimMode === 'glare' && `Glare (Luma ${glareSimLevel})`}
                      </span>
                    </div>

                    <div className="absolute bottom-2 sm:bottom-3 left-2 sm:left-3 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[10px] sm:text-xs font-mono text-zinc-200 shadow-xl">
                      {isObstructionFlagged ? (
                        <span className="text-rose-400 font-semibold">• Defect</span>
                      ) : (
                        <span className="text-emerald-400 font-semibold">• Passed</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            )}

            {/* ------------------------------------------------------------- */}
            {/* TAB 3: GPS JUMP TELEMETRY VIEWPORT */}
            {/* ------------------------------------------------------------- */}
            {activeDefectTab === 'gps' && (
              <div className="w-full h-full flex flex-col items-center justify-center p-3 sm:p-6 overflow-y-auto">
                <div className="w-full max-w-3xl flex flex-col items-center justify-center space-y-4 sm:space-y-6">

                  {/* Top Pace Indicator Badge */}
                  <div className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl bg-zinc-950/95 border border-zinc-700/80 text-[11px] sm:text-xs font-sans text-zinc-200 flex items-center gap-2 shadow-2xl">
                    <span className="w-2 h-2 rounded-full bg-zinc-400 shrink-0" />
                    <span>Nominal Pace: <strong className="text-zinc-100 font-semibold font-mono">2.5m – 4.5m / step</strong></span>
                  </div>

                  {/* SVG Trajectory Diagram */}
                  <div className="w-full overflow-x-auto no-scrollbar flex justify-center">
                    <svg className="w-full min-w-[500px] sm:min-w-[650px] max-w-[740px] h-36 sm:h-44" viewBox="0 0 740 180">
                      <rect x="20" y="70" width="700" height="40" rx="6" fill="#18181b" stroke="#27272a" strokeWidth="1" />
                      <line x1="30" y1="90" x2="710" y2="90" stroke="#3f3f46" strokeWidth="2" strokeDasharray="12 10" />

                      <path
                        d="M 60,90 L 170,90 L 280,90 L 390,90"
                        stroke="#a1a1aa"
                        strokeWidth="2.5"
                        fill="none"
                      />

                      <path
                        d="M 390,90 Q 520,0 650,90"
                        stroke="#f43f5e"
                        strokeWidth="2.5"
                        fill="none"
                        strokeDasharray="6 6"
                      />

                      {/* Station Nodes */}
                      <circle cx="60" cy="90" r="7" fill="#71717a" stroke="#ffffff" strokeWidth="2" />
                      <text x="60" y="130" fill="#a1a1aa" fontSize="12" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="500">Stn 1</text>
                      <text x="60" y="146" fill="#71717a" fontSize="11" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">(3.1m)</text>

                      <circle cx="170" cy="90" r="7" fill="#71717a" stroke="#ffffff" strokeWidth="2" />
                      <text x="170" y="130" fill="#a1a1aa" fontSize="12" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="500">Stn 2</text>
                      <text x="170" y="146" fill="#71717a" fontSize="11" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">(3.2m)</text>

                      <circle cx="280" cy="90" r="7" fill="#71717a" stroke="#ffffff" strokeWidth="2" />
                      <text x="280" y="130" fill="#a1a1aa" fontSize="12" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="500">Stn 3</text>
                      <text x="280" y="146" fill="#71717a" fontSize="11" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">(3.0m)</text>

                      <circle cx="390" cy="90" r="8" fill="#ffffff" stroke="#71717a" strokeWidth="2" />
                      <text x="390" y="130" fill="#ffffff" fontSize="12" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="600">Stn 4</text>
                      <text x="390" y="146" fill="#a1a1aa" fontSize="11" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">Origin</text>

                      <circle cx="650" cy="90" r="9" fill="#f43f5e" stroke="#ffffff" strokeWidth="2" />
                      <text x="650" y="130" fill="#f43f5e" fontSize="12" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="600">Stn 5</text>
                      <text x="650" y="146" fill="#f43f5e" fontSize="11" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="600">78.4m Jump</text>

                      <g transform="translate(520, 36)">
                        <rect x="-80" y="-13" width="160" height="26" rx="13" fill="#18181b" stroke="#f43f5e" strokeWidth="1.5" />
                        <text x="0" y="4" fill="#f43f5e" fontSize="11" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="600">
                          GPS Jump &gt; {thresholds.gpsMaxJumpDistanceMeters}m (Defect)
                        </text>
                      </g>
                    </svg>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

      </main>

      {/* ========================================================================= */}
      {/* 2. RIGHT PARAMETERS DOCK CARD (FOLLOWS EXACT QA/QC BORDER RULES) */}
      {/* ========================================================================= */}
      <aside className="w-full lg:w-[380px] bg-card/90 backdrop-blur-md border border-subtle rounded-2xl flex flex-col shrink-0 overflow-hidden shadow-xl ring-1 ring-white/5 text-xs">

        {/* Dock Header */}
        <div className="h-14 px-4 border-b border-subtle flex items-center justify-between shrink-0 bg-card">
          <div className="flex items-center gap-2">
            <span className="font-bold text-xs text-text-base uppercase tracking-wider">
              {activeDefectTab === 'blur' && 'Focus Settings'}
              {activeDefectTab === 'obstruction' && 'Obstruction Settings'}
              {activeDefectTab === 'gps' && 'GPS Telemetry Settings'}
            </span>
          </div>

          {/* Quick Actions (Reset & Save) */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleReset}
              className="px-2.5 py-1.5 bg-inner hover:bg-inner/80 text-text-muted hover:text-text-base rounded-xl border border-subtle text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Reset parameters to calibrated defaults"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={showToast}
              className="px-3 py-1.5 bg-inner hover:bg-card text-text-base rounded-xl border border-subtle hover:border-zinc-500 text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95 flex items-center gap-1.5 disabled:opacity-80"
            >
              <Check size={13} className="text-zinc-300" />
              <span>{showToast ? 'Saved' : 'Apply & Save'}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Parameters Dock Body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">

          {/* TAB 1: BLUR PARAMETERS */}
          {activeDefectTab === 'blur' && (
            <>
              {/* Blur Defect Cutoff Card */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">Blur Defect Cutoff</span>
                  <span className="font-mono text-white font-bold text-sm tabular-nums">{thresholds.blurVarianceThreshold.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="90"
                  step="0.5"
                  value={thresholds.blurVarianceThreshold}
                  onChange={(e) => setThresholds(prev => ({ ...prev, blurVarianceThreshold: Number(e.target.value) }))}
                  className="w-full accent-zinc-200 cursor-pointer"
                />
                <div className="flex justify-between text-xs text-text-muted font-sans pt-0.5">
                  <span>45.0 (Lenient)</span>
                  <span className="text-text-base font-semibold">60.0 (Standard)</span>
                  <span>75.0 (Strict)</span>
                </div>
              </div>

              {/* Simulate Photo Blur Slider */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">Simulate Lens Blur</span>
                  <span className="font-mono text-white font-bold text-sm tabular-nums">{blurPreviewLevel.toFixed(1)}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="8"
                  step="0.2"
                  value={blurPreviewLevel}
                  onChange={(e) => setBlurPreviewLevel(Number(e.target.value))}
                  className="w-full accent-zinc-200 cursor-pointer"
                />
                <p className="text-xs text-text-muted leading-relaxed">
                  Adjust simulated blur to verify when out-of-focus frames trigger defects.
                </p>
              </div>

              {/* Presets */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Presets</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-inner border border-subtle text-xs">
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 45.0 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.blurVarianceThreshold === 45.0
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Lenient (45)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 60.0 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.blurVarianceThreshold === 60.0
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Standard (60)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 75.0 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.blurVarianceThreshold === 75.0
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Strict (75)
                  </button>
                </div>
              </div>

              {/* Evaluation Status Card */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle flex items-center justify-between text-xs">
                <div>
                  <span className="text-xs text-text-muted uppercase font-semibold tracking-wider block">Evaluation Verdict</span>
                  <span className="font-semibold text-text-base text-sm mt-0.5 block">
                    {isSimulatedBlurFlagged ? 'Flagged as Defect' : 'Passed Inspection'}
                  </span>
                </div>
                <span className={`font-mono font-bold text-sm tabular-nums ${isSimulatedBlurFlagged ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {simulatedBlurScore.toFixed(1)} {isSimulatedBlurFlagged ? '<' : '≥'} {thresholds.blurVarianceThreshold.toFixed(1)}
                </span>
              </div>

              {/* Technical Description */}
              <div className="p-3 rounded-xl bg-inner/60 border border-subtle text-xs text-text-muted leading-relaxed">
                Evaluates 32 horizon asset tiles (excluding blank sky and vehicle hood) for high-frequency edge variance.
              </div>
            </>
          )}

          {/* TAB 2: OBSTRUCTION PARAMETERS */}
          {activeDefectTab === 'obstruction' && (
            <>
              {/* Defect Mode Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Simulation Mode</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-inner border border-subtle text-xs">
                  <button
                    type="button"
                    onClick={() => setObstructionSimMode('glitch')}
                    className={`py-2 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs flex flex-col items-center gap-1 ${obstructionSimMode === 'glitch'
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    <Zap size={13} className="text-zinc-300" />
                    <span>Glitch</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setObstructionSimMode('blackout')}
                    className={`py-2 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs flex flex-col items-center gap-1 ${obstructionSimMode === 'blackout'
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    <EyeOff size={13} className="text-zinc-300" />
                    <span>Blackout</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setObstructionSimMode('glare')}
                    className={`py-2 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs flex flex-col items-center gap-1 ${obstructionSimMode === 'glare'
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    <Sun size={13} className="text-zinc-300" />
                    <span>Solar Glare</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Interactive Simulator Sliders Based on Active Mode */}
              {obstructionSimMode === 'glitch' && (
                <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-base font-medium">Glitch / Aberration Intensity</span>
                    <span className="font-mono text-white font-bold text-sm tabular-nums">{glitchIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={glitchIntensity}
                    onChange={(e) => setGlitchIntensity(Number(e.target.value))}
                    className="w-full accent-zinc-200 cursor-pointer"
                  />
                  <p className="text-xs text-text-muted leading-relaxed">
                    Slide to adjust hardware scanline split and chromatic aberration intensity.
                  </p>
                </div>
              )}

              {obstructionSimMode === 'blackout' && (
                <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-base font-medium">Simulate Darkness Luma</span>
                    <span className="font-mono text-white font-bold text-sm tabular-nums">{blackoutSimLevel}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    step="1"
                    value={blackoutSimLevel}
                    onChange={(e) => setBlackoutSimLevel(Number(e.target.value))}
                    className="w-full accent-zinc-200 cursor-pointer"
                  />
                  <p className="text-xs text-text-muted leading-relaxed">
                    Slide to simulate tunnel darkness and test blackout occlusion trigger.
                  </p>
                </div>
              )}

              {obstructionSimMode === 'glare' && (
                <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-base font-medium">Simulate Solar Flare Luma</span>
                    <span className="font-mono text-white font-bold text-sm tabular-nums">{glareSimLevel}</span>
                  </div>
                  <input
                    type="range"
                    min="200"
                    max="255"
                    step="1"
                    value={glareSimLevel}
                    onChange={(e) => setGlareSimLevel(Number(e.target.value))}
                    className="w-full accent-zinc-200 cursor-pointer"
                  />
                  <p className="text-xs text-text-muted leading-relaxed">
                    Slide to simulate blinding sun glare flare on the camera lens.
                  </p>
                </div>
              )}

              {/* Threshold Cutoff Setting 1: Occlusion Min Brightness */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">Occlusion Min Brightness</span>
                  <span className="font-mono text-white font-bold text-sm tabular-nums">{thresholds.obstructionMinBrightness}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={thresholds.obstructionMinBrightness}
                  onChange={(e) => setThresholds(prev => ({ ...prev, obstructionMinBrightness: Number(e.target.value) }))}
                  className="w-full accent-zinc-200 cursor-pointer"
                />
                <p className="text-xs text-text-muted leading-relaxed">
                  Frame average luminance &lt; <span className="text-text-base font-mono font-semibold">{thresholds.obstructionMinBrightness}</span> flags lens blackout (Default: 15).
                </p>
              </div>

              {/* Threshold Cutoff Setting 2: Glare Clipping Limit */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">Solar Glare Saturation Limit</span>
                  <span className="font-mono text-white font-bold text-sm tabular-nums">{thresholds.glareLuminanceThreshold}</span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="255"
                  step="1"
                  value={thresholds.glareLuminanceThreshold}
                  onChange={(e) => setThresholds(prev => ({ ...prev, glareLuminanceThreshold: Number(e.target.value) }))}
                  className="w-full accent-zinc-200 cursor-pointer"
                />
                <p className="text-xs text-text-muted leading-relaxed">
                  Overexposure clipping &ge; <span className="text-text-base font-mono font-semibold">{thresholds.glareLuminanceThreshold}</span> on &gt;95% of pixels flags direct sun glare (Default: 240).
                </p>
              </div>

              {/* Status Verdict Box */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle flex items-center justify-between text-xs">
                <div>
                  <span className="text-xs text-text-muted uppercase font-semibold tracking-wider block">Defect Verdict</span>
                  <span className="font-semibold text-text-base text-sm mt-0.5 block">
                    {isObstructionFlagged ? 'Flagged as Defect' : 'Passed Inspection'}
                  </span>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-lg ${isObstructionFlagged
                    ? 'text-rose-400 bg-rose-950 border border-rose-800'
                    : 'text-emerald-400 bg-emerald-950 border border-emerald-800'
                  }`}>
                  {isObstructionFlagged ? 'Defect' : 'Passed'}
                </span>
              </div>
            </>
          )}

          {/* TAB 3: GPS PARAMETERS */}
          {activeDefectTab === 'gps' && (
            <>
              {/* Max Jump Distance Slider */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">GPS Max Jump Cutoff</span>
                  <span className="font-mono text-white font-bold text-sm tabular-nums">{thresholds.gpsMaxJumpDistanceMeters}m</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="150"
                  step="5"
                  value={thresholds.gpsMaxJumpDistanceMeters}
                  onChange={(e) => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: Number(e.target.value) }))}
                  className="w-full accent-zinc-200 cursor-pointer"
                />
                <div className="flex justify-between text-xs text-text-muted font-sans pt-0.5">
                  <span>10m (Dense)</span>
                  <span className="text-text-base font-semibold">50m (Standard)</span>
                  <span>150m (Highway)</span>
                </div>
              </div>

              {/* Presets */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Survey Presets</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-inner border border-subtle text-xs">
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: 25 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.gpsMaxJumpDistanceMeters === 25
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Dense (25m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: 50 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.gpsMaxJumpDistanceMeters === 50
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Standard (50m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: 100 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.gpsMaxJumpDistanceMeters === 100
                        ? 'bg-card text-white shadow-sm font-semibold ring-1 ring-white/10'
                        : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Highway (100m)
                  </button>
                </div>
              </div>

              {/* Summary Card */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-1.5 text-xs">
                <span className="text-xs text-text-muted uppercase font-semibold tracking-wider">Active Configuration</span>
                <p className="text-zinc-200 font-medium leading-relaxed">
                  Sequential distance jump &gt; <span className="text-white font-mono font-bold">{thresholds.gpsMaxJumpDistanceMeters}m</span> triggers a GPS Defect.
                </p>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};
