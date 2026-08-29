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
  deliverableModel?: 'masked_car' | 'generative_fill';
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

  // Dynamic sample image based on active deliverable model
  const sampleBlurImage = (thresholds.deliverableModel || 'masked_car') === 'generative_fill'
    ? '/samples/sample_survey_generative.jpg'
    : '/samples/sample_survey_sharp.jpg';

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
        blurVarianceThreshold: 68.0,
        gpsMaxJumpDistanceMeters: 50.0,
        obstructionMinBrightness: 15.0,
        glareLuminanceThreshold: 240.0,
        deliverableModel: 'masked_car'
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
    <div className="flex-1 p-2 sm:p-3 gap-2 sm:gap-3 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-app min-h-0">

      {/* Toast Notification (Professional, non-colorful) */}
      {showToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100000] px-4 py-2.5 rounded-xl bg-card border border-subtle text-text-base text-xs font-medium shadow-2xl flex items-center gap-2.5 animate-in fade-in slide-in-from-top-2 duration-150">
          <Check size={14} className="text-text-base shrink-0" />
          <span>Threshold settings applied and saved successfully.</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. LEFT MAIN CARD: INSPECTION CANVAS (FOLLOWS SYSTEM BORDER RULES) */}
      {/* ========================================================================= */}
      <main className="flex-1 bg-card border border-subtle rounded-2xl flex flex-col overflow-hidden shadow-sm relative min-w-0">

        {/* Canvas Top Bar: Benchmark Context, Centered Defect Switcher, View Toggles */}
        <div className="min-h-14 py-2 sm:py-0 px-4 border-b border-subtle flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5 shrink-0 bg-card relative z-10">

          {/* Left: Benchmark Identifier */}
          <div className="flex items-center gap-2 text-xs min-w-0">
            <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
            <span className="font-semibold text-text-base truncate">
              {activeDefectTab === 'blur' && 'Blur Focus Calibration'}
              {activeDefectTab === 'obstruction' && 'Sensor Glitch & Obstruction'}
              {activeDefectTab === 'gps' && 'GPS Jump Telemetry'}
            </span>
          </div>

          {/* Center: Defect Sub-Tabs Switcher — Centered with Canvas Inspection! */}
          <div className="flex items-center p-1 rounded-xl bg-inner border border-subtle overflow-x-auto no-scrollbar gap-1">
            <button
              type="button"
              onClick={() => setActiveDefectTab('blur')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${activeDefectTab === 'blur'
                ? 'bg-card text-text-base shadow-sm border border-subtle'
                : 'text-text-muted hover:text-text-base'
                }`}
            >
              Blur Detection
            </button>
            <button
              type="button"
              onClick={() => setActiveDefectTab('obstruction')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${activeDefectTab === 'obstruction'
                ? 'bg-card text-text-base shadow-sm border border-subtle'
                : 'text-text-muted hover:text-text-base'
                }`}
            >
              Lens &amp; Glitch
            </button>
            <button
              type="button"
              onClick={() => setActiveDefectTab('gps')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${activeDefectTab === 'gps'
                ? 'bg-card text-text-base shadow-sm border border-subtle'
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
                className="w-full md:w-auto px-3.5 py-1.5 rounded-xl bg-inner hover:bg-inner border border-subtle text-xs font-medium text-text-base transition-all cursor-pointer shadow-sm active:scale-95 text-center"
              >
                {(activeDefectTab === 'blur' ? isComparingSplit : isComparingSplitObstruction)
                  ? 'Side-by-Side'
                  : 'Split Slider'}
              </button>
            ) : (
              <span className="text-[10px] sm:text-[11px] text-text-muted font-mono">Haversine Geodesic</span>
            )}
          </div>
        </div>

        {/* Viewport Frame */}
        <div className="flex-1 bg-black relative flex flex-col p-2.5 sm:p-3 overflow-hidden select-none min-h-[260px]">
          <div className="flex-1 relative w-full h-full rounded-xl overflow-hidden border border-subtle bg-black flex items-center justify-center">

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
                      backgroundImage: `url('${sampleBlurImage}')`,
                      filter: `blur(${blurPreviewLevel}px)`
                    }}
                  />

                  {/* Overlay Sharp Layer (Clipped by Split Slider) */}
                  <div
                    className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center border-r-2 border-slate-400 pointer-events-none"
                    style={{
                      backgroundImage: `url('${sampleBlurImage}')`,
                      clipPath: `polygon(0 0, ${splitPosition}% 0, ${splitPosition}% 100%, 0 100%)`
                    }}
                  />

                  {/* High-Contrast Dark HUD Cards */}
                  {/* Left HUD: Baseline Sharp */}
                  <div className="absolute top-3 left-3 px-3 py-2 rounded-xl bg-black/85 border border-white/10 text-xs shadow-md flex items-center gap-2 z-10">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                    <span className="text-text-base font-medium">Sharp Base</span>
                    <span className="font-mono text-white font-bold text-xs tabular-nums">{simulatedSharpScore.toFixed(1)}</span>
                  </div>

                  {/* Right HUD: Test Scan */}
                  <div className="absolute top-3 right-3 px-3 py-2 rounded-xl bg-black/85 border border-white/10 text-xs shadow-md flex items-center gap-2 z-10">
                    <span className={`w-1.5 h-1.5 rounded-full ${isSimulatedBlurFlagged ? 'bg-rose-400' : 'bg-emerald-400'} shrink-0`} />
                    <span className="text-text-base font-medium hidden xs:inline">Simulated</span>
                    <span className="font-mono font-bold text-white text-xs tabular-nums">{simulatedBlurScore.toFixed(1)}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${isSimulatedBlurFlagged
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
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
                    <div className="w-0.5 h-full bg-slate-400" />
                    <div className="absolute w-7 h-7 rounded-full bg-card border border-subtle text-text-base flex items-center justify-center shadow-lg text-xs font-mono font-bold">
                      ↔
                    </div>
                  </div>

                  {/* Scan Zone Badge */}
                  <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-black/85 border border-white/10 text-[11px] text-slate-300 font-sans shadow-md flex items-center gap-1.5 z-10 pointer-events-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    <span>Scan Zone: {(thresholds.deliverableModel || 'masked_car') === 'generative_fill' ? '15% - 80% (Full Frame)' : '10% - 52% (Upper Half)'}</span>
                  </div>

                  {/* Center Helper Text */}
                  <div className="hidden sm:block absolute bottom-3.5 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-black/85 border border-white/10 text-xs text-slate-300 font-sans pointer-events-none shadow-md whitespace-nowrap">
                    Drag split divider horizontally to compare Sharp (Left) vs Blurry (Right)
                  </div>
                </div>
              ) : (
                /* Side-by-Side Dual View */
                <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-2.5">
                  <div className="relative rounded-xl overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src={sampleBlurImage}
                      alt="Sharp Reference"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2.5 left-2.5 px-3 py-1 rounded-xl bg-black/85 border border-white/10 text-xs text-white flex items-center gap-1.5 shadow-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <span className="font-medium">Sharp Base ({simulatedSharpScore.toFixed(1)})</span>
                    </div>
                  </div>

                  <div className="relative rounded-xl overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src={sampleBlurImage}
                      alt="Simulated Blurry Frame"
                      className="w-full h-full object-contain"
                      style={{ filter: `blur(${blurPreviewLevel}px)` }}
                    />
                    <div className="absolute top-2.5 left-2.5 px-3 py-1 rounded-xl bg-black/85 border border-white/10 text-xs text-white flex items-center gap-1.5 shadow-md">
                      <span className={`w-1.5 h-1.5 rounded-full ${isSimulatedBlurFlagged ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                      <span className="font-medium">Simulated ({simulatedBlurScore.toFixed(1)})</span>
                      <span className={`text-[10px] font-semibold ${isSimulatedBlurFlagged ? 'text-rose-400' : 'text-emerald-400'}`}>
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
                    className="absolute inset-0 w-full h-full bg-contain bg-no-repeat bg-center border-r-2 border-slate-400 pointer-events-none"
                    style={{
                      backgroundImage: `url('/samples/sample_survey_sharp.jpg')`,
                      clipPath: `polygon(0 0, ${splitPositionObstruction}% 0, ${splitPositionObstruction}% 100%, 0 100%)`
                    }}
                  />

                  {/* HUD Cards */}
                  <div className="absolute top-3 left-3 px-3 py-2 rounded-xl bg-black/85 border border-white/10 text-xs shadow-md flex items-center gap-2 z-10">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                    <span className="text-text-base font-medium">Nominal Sensor</span>
                    <span className="font-mono text-white font-bold text-xs tabular-nums">132.0</span>
                  </div>

                  <div className="absolute top-3 right-3 px-3 py-2 rounded-xl bg-black/85 border border-white/10 text-xs shadow-md flex items-center gap-2 z-10">
                    <span className={`w-1.5 h-1.5 rounded-full ${isObstructionFlagged ? 'bg-rose-400' : 'bg-emerald-400'} shrink-0`} />
                    <span className="text-text-base font-medium hidden xs:inline">
                      {obstructionSimMode === 'glitch' && `Glitch (${glitchIntensity}%)`}
                      {obstructionSimMode === 'blackout' && `Luma ${blackoutSimLevel}`}
                      {obstructionSimMode === 'glare' && `Luma ${glareSimLevel}`}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${isObstructionFlagged
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
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
                    <div className="w-0.5 h-full bg-slate-400" />
                    <div className="absolute w-7 h-7 rounded-full bg-card border border-subtle text-text-base flex items-center justify-center shadow-lg text-xs font-mono font-bold">
                      ↔
                    </div>
                  </div>

                  {/* Center Helper Text */}
                  <div className="hidden sm:block absolute bottom-3.5 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-black/85 border border-white/10 text-xs text-slate-300 font-sans pointer-events-none shadow-md whitespace-nowrap">
                    Drag split divider horizontally to compare Nominal (Left) vs Glitched/Occluded (Right)
                  </div>
                </div>
              ) : (
                /* Side-by-Side Dual View */
                <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-2.5">
                  <div className="relative rounded-xl overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src="/samples/sample_survey_sharp.jpg"
                      alt="Nominal Clean Frame"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2.5 left-2.5 px-3 py-1 rounded-xl bg-black/85 border border-white/10 text-xs text-white flex items-center gap-1.5 shadow-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <span className="font-medium">Nominal Sensor (132.0)</span>
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
                    <div className="absolute top-2.5 left-2.5 px-3 py-1 rounded-xl bg-black/85 border border-white/10 text-xs text-white flex items-center gap-1.5 shadow-md">
                      <span className={`w-1.5 h-1.5 rounded-full ${isObstructionFlagged ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                      <span className="font-medium">
                        {obstructionSimMode === 'glitch' ? 'Glitched Frame' : obstructionSimMode === 'blackout' ? 'Occluded/Dark' : 'Glare/Solar Flare'}
                      </span>
                      <span className={`text-[10px] font-semibold ${isObstructionFlagged ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {isObstructionFlagged ? '• Defect' : '• Passed'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* ------------------------------------------------------------- */}
            {/* TAB 3: GPS TELEMETRY VIEWPORT */}
            {/* ------------------------------------------------------------- */}
            {activeDefectTab === 'gps' && (
              <div className="w-full h-full flex flex-col justify-between p-3.5 relative overflow-hidden bg-black">
                {/* SVG Visual Map Track Simulation */}
                <div className="flex-1 w-full relative flex items-center justify-center">
                  <div className="w-full max-w-2xl h-48 bg-card border border-subtle rounded-xl p-4 flex flex-col justify-center shadow-sm">
                    <svg viewBox="0 0 700 160" className="w-full h-full">
                      {/* Normal Trajectory Line */}
                      <path
                        d="M 50,90 L 160,90 L 270,90 L 380,90"
                        fill="none"
                        stroke="#71717a"
                        strokeWidth="2.5"
                        strokeDasharray="4 2"
                      />

                      {/* Jump Trajectory Line (Red Defect) */}
                      <path
                        d="M 380,90 L 640,90"
                        fill="none"
                        stroke="#f43f5e"
                        strokeWidth="2.5"
                        strokeDasharray="6 3"
                      />

                      {/* Station Nodes */}
                      <circle cx="60" cy="90" r="6" fill="#a1a1aa" />
                      <text x="60" y="130" fill="#a1a1aa" fontSize="12" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="500">Stn 1</text>
                      <text x="60" y="146" fill="#71717a" fontSize="11" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">(3.1m)</text>

                      <circle cx="170" cy="90" r="6" fill="#a1a1aa" />
                      <text x="170" y="130" fill="#a1a1aa" fontSize="12" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="500">Stn 2</text>
                      <text x="170" y="146" fill="#71717a" fontSize="11" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif">(2.9m)</text>

                      <circle cx="280" cy="90" r="6" fill="#a1a1aa" />
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
      {/* 2. RIGHT PARAMETERS DOCK CARD (FOLLOWS SYSTEM BORDER RULES) */}
      {/* ========================================================================= */}
      <aside className="w-full lg:w-[380px] bg-card border border-subtle rounded-2xl flex flex-col shrink-0 overflow-hidden shadow-sm text-xs">

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
              className="px-3 py-1.5 bg-inner hover:bg-inner text-text-muted hover:text-text-base rounded-xl border border-subtle text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95"
              title="Reset parameters to calibrated defaults"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={showToast}
              className="px-3.5 py-1.5 bg-card hover:bg-inner text-text-base rounded-xl border border-subtle text-xs font-medium transition-all cursor-pointer shadow-sm active:scale-95 flex items-center gap-1.5 disabled:opacity-80"
            >
              <Check size={13} className="text-text-base" />
              <span>{showToast ? 'Saved' : 'Apply & Save'}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Parameters Dock Body */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">

          {/* TAB 1: BLUR PARAMETERS */}
          {activeDefectTab === 'blur' && (
            <>
              {/* Deliverable Image Model Selector Card */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">Deliverable Image Model</span>
                  <span className="font-mono text-xs text-text-muted">
                    {(thresholds.deliverableModel || 'masked_car') === 'generative_fill' ? 'Full 80% ROI' : 'Top 52% ROI'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-card border border-subtle text-xs">
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, deliverableModel: 'masked_car' }))}
                    className={`py-2 px-2.5 rounded-lg text-left transition-all cursor-pointer ${
                      (thresholds.deliverableModel || 'masked_car') === 'masked_car'
                        ? 'bg-inner text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base'
                    }`}
                  >
                    <span className="font-semibold text-xs text-text-base block">Masked Vehicle</span>
                    <span className="text-[10px] text-text-muted mt-0.5 block">Scans top 52% (excludes car mask)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, deliverableModel: 'generative_fill' }))}
                    className={`py-2 px-2.5 rounded-lg text-left transition-all cursor-pointer ${
                      thresholds.deliverableModel === 'generative_fill'
                        ? 'bg-inner text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base'
                    }`}
                  >
                    <span className="font-semibold text-xs text-text-base block">Generative Fill</span>
                    <span className="text-[10px] text-text-muted mt-0.5 block">Scans full scene & road (80% ROI)</span>
                  </button>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  {(thresholds.deliverableModel || 'masked_car') === 'masked_car'
                    ? 'Excludes the lower nadir black vehicle silhouette to avoid false edge spikes.'
                    : 'Evaluates continuous road textures and vertical assets across the full scene.'}
                </p>
              </div>

              {/* Blur Defect Cutoff Card */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">Blur Defect Cutoff</span>
                  <span className="font-mono text-text-base font-bold text-sm tabular-nums">{thresholds.blurVarianceThreshold.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="78"
                  step="0.5"
                  value={thresholds.blurVarianceThreshold}
                  onChange={(e) => setThresholds(prev => ({ ...prev, blurVarianceThreshold: Number(e.target.value) }))}
                  className="w-full accent-slate-400 cursor-pointer"
                />
                <div className="flex justify-between text-xs text-text-muted font-sans pt-0.5">
                  <span>55.0 (Lenient)</span>
                  <span className="text-text-base font-semibold">68.0 (Standard)</span>
                  <span>75.0 (Strict)</span>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed pt-1 border-t border-subtle">
                  Logic: Frames scoring <strong className="text-text-base font-semibold">≥ {thresholds.blurVarianceThreshold.toFixed(1)}</strong> pass inspection. Frames below cutoff are flagged as <strong className="text-rose-400 font-semibold">Defects</strong>.
                </p>
              </div>

              {/* Simulate Photo Blur Slider */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">Simulate Lens Blur</span>
                  <span className="font-mono text-text-base font-bold text-sm tabular-nums">{blurPreviewLevel.toFixed(1)}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.2"
                  value={blurPreviewLevel}
                  onChange={(e) => setBlurPreviewLevel(Number(e.target.value))}
                  className="w-full accent-slate-400 cursor-pointer"
                />
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-text-muted">Simulated Status:</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold font-mono ${
                    isSimulatedBlurFlagged
                      ? 'bg-inner text-rose-400 border border-subtle'
                      : 'bg-card text-text-muted border border-subtle'
                  }`}>
                    {isSimulatedBlurFlagged ? 'Defect (Blurry)' : 'Passed (Sharp)'}
                  </span>
                </div>
              </div>

              {/* Presets */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Presets</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-inner border border-subtle text-xs">
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 55.0 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.blurVarianceThreshold === 55.0
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                      : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Lenient (55)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 68.0 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.blurVarianceThreshold === 68.0
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                      : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Standard (68)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 75.0 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.blurVarianceThreshold === 75.0
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
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

              {/* Suggested Cutoff by Survey Type Note */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2">
                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">
                  Suggested Cutoff by Survey Type
                </span>
                <div className="space-y-1.5">
                  <div
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 75.0 }))}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      thresholds.blurVarianceThreshold >= 72.0 && thresholds.blurVarianceThreshold <= 75.0
                        ? 'bg-card border-subtle text-text-base shadow-sm'
                        : 'bg-card/40 border-subtle hover:bg-card text-text-muted hover:text-text-base'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-xs text-text-base block">Utility Asset Audit</span>
                      <span className="text-[10px] text-text-muted mt-0.5 block truncate">Pole numbers, cables, meter boxes</span>
                    </div>
                    <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-inner border border-subtle text-text-muted shrink-0">
                      72 – 75
                    </span>
                  </div>

                  <div
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 68.0 }))}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      thresholds.blurVarianceThreshold === 68.0
                        ? 'bg-card border-subtle text-text-base shadow-sm'
                        : 'bg-card/40 border-subtle hover:bg-card text-text-muted hover:text-text-base'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-xs text-text-base block">Standard Urban Mapping</span>
                      <span className="text-[10px] text-text-muted mt-0.5 block truncate">Balanced pass/fail SLA rate</span>
                    </div>
                    <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-inner border border-subtle text-text-muted shrink-0">
                      68
                    </span>
                  </div>

                  <div
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 60.0 }))}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      thresholds.blurVarianceThreshold >= 55.0 && thresholds.blurVarianceThreshold <= 60.0
                        ? 'bg-card border-subtle text-text-base shadow-sm'
                        : 'bg-card/40 border-subtle hover:bg-card text-text-muted hover:text-text-base'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-xs text-text-base block">Highway & Rural Captures</span>
                      <span className="text-[10px] text-text-muted mt-0.5 block truncate">Open sky, vegetation & fields</span>
                    </div>
                    <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-inner border border-subtle text-text-muted shrink-0">
                      55 – 60
                    </span>
                  </div>
                </div>
              </div>

              {/* Technical Description */}
              <div className="p-3 rounded-xl bg-inner/60 border border-subtle text-xs text-text-muted leading-relaxed">
                {(thresholds.deliverableModel || 'masked_car') === 'generative_fill'
                  ? 'Evaluates 32 horizon and road tiles (15% to 80% height) for high-frequency edge variance.'
                  : 'Evaluates 32 upper horizon asset tiles (10% to 52% height, excluding vehicle nadir mask) for high-frequency edge variance.'}
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
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                      : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    <Zap size={13} className="text-text-muted" />
                    <span>Glitch</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setObstructionSimMode('blackout')}
                    className={`py-2 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs flex flex-col items-center gap-1 ${obstructionSimMode === 'blackout'
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                      : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    <EyeOff size={13} className="text-text-muted" />
                    <span>Blackout</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setObstructionSimMode('glare')}
                    className={`py-2 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs flex flex-col items-center gap-1 ${obstructionSimMode === 'glare'
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                      : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    <Sun size={13} className="text-text-muted" />
                    <span>Solar Glare</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Interactive Simulator Sliders Based on Active Mode */}
              {obstructionSimMode === 'glitch' && (
                <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-text-base font-medium">Glitch / Aberration Intensity</span>
                    <span className="font-mono text-text-base font-bold text-sm tabular-nums">{glitchIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={glitchIntensity}
                    onChange={(e) => setGlitchIntensity(Number(e.target.value))}
                    className="w-full accent-slate-400 cursor-pointer"
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
                    <span className="font-mono text-text-base font-bold text-sm tabular-nums">{blackoutSimLevel}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    step="1"
                    value={blackoutSimLevel}
                    onChange={(e) => setBlackoutSimLevel(Number(e.target.value))}
                    className="w-full accent-slate-400 cursor-pointer"
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
                    <span className="font-mono text-text-base font-bold text-sm tabular-nums">{glareSimLevel}</span>
                  </div>
                  <input
                    type="range"
                    min="200"
                    max="255"
                    step="1"
                    value={glareSimLevel}
                    onChange={(e) => setGlareSimLevel(Number(e.target.value))}
                    className="w-full accent-slate-400 cursor-pointer"
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
                  <span className="font-mono text-text-base font-bold text-sm tabular-nums">{thresholds.obstructionMinBrightness}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={thresholds.obstructionMinBrightness}
                  onChange={(e) => setThresholds(prev => ({ ...prev, obstructionMinBrightness: Number(e.target.value) }))}
                  className="w-full accent-slate-400 cursor-pointer"
                />
                <p className="text-xs text-text-muted leading-relaxed">
                  Frame average luminance &lt; <span className="text-text-base font-mono font-semibold">{thresholds.obstructionMinBrightness}</span> flags lens blackout (Default: 15).
                </p>
              </div>

              {/* Threshold Cutoff Setting 2: Glare Clipping Limit */}
              <div className="p-3.5 rounded-xl bg-inner border border-subtle space-y-2.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-text-base font-medium">Solar Glare Saturation Limit</span>
                  <span className="font-mono text-text-base font-bold text-sm tabular-nums">{thresholds.glareLuminanceThreshold}</span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="255"
                  step="1"
                  value={thresholds.glareLuminanceThreshold}
                  onChange={(e) => setThresholds(prev => ({ ...prev, glareLuminanceThreshold: Number(e.target.value) }))}
                  className="w-full accent-slate-400 cursor-pointer"
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
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${isObstructionFlagged
                  ? 'text-rose-400 bg-inner border border-subtle'
                  : 'text-emerald-400 bg-inner border border-subtle'
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
                  <span className="font-mono text-text-base font-bold text-sm tabular-nums">{thresholds.gpsMaxJumpDistanceMeters}m</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="150"
                  step="5"
                  value={thresholds.gpsMaxJumpDistanceMeters}
                  onChange={(e) => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: Number(e.target.value) }))}
                  className="w-full accent-slate-400 cursor-pointer"
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
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                      : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Dense (25m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: 50 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.gpsMaxJumpDistanceMeters === 50
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                      : 'text-text-muted hover:text-text-base'
                      }`}
                  >
                    Standard (50m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: 100 }))}
                    className={`py-1.5 px-1 rounded-lg text-center font-medium transition-all cursor-pointer text-xs ${thresholds.gpsMaxJumpDistanceMeters === 100
                      ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
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
                <p className="text-text-base font-medium leading-relaxed">
                  Sequential distance jump &gt; <span className="text-text-base font-mono font-bold">{thresholds.gpsMaxJumpDistanceMeters}m</span> triggers a GPS Defect.
                </p>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};
