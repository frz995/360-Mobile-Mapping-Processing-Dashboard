import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  RotateCcw,
  Check,
  Zap,
  EyeOff,
  Sun,
  Eye,
  Navigation,
  SlidersHorizontal,
  Columns
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [isWideLayout, setIsWideLayout] = useState<boolean>(false);

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

  // Dynamic layout observer: smoothly switches between stacked (drawer docked) and side-by-side (fullscreen / wide modal)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsWideLayout(entry.contentRect.width >= 860);
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    <div
      ref={containerRef}
      className={`w-full h-full min-h-0 p-2 sm:p-2.5 gap-2.5 bg-app text-text-base ${
        isWideLayout ? 'flex flex-row overflow-hidden' : 'flex flex-col overflow-y-auto'
      }`}
    >
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[100000] px-3 py-1.5 rounded-lg bg-card border border-subtle text-text-base text-xs font-medium shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <Check size={13} className="text-emerald-400 shrink-0" />
          <span>Threshold settings saved successfully.</span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 1. MAIN INSPECTION CANVAS */}
      {/* ========================================================================= */}
      <main className={`bg-card border border-subtle rounded-xl flex flex-col overflow-hidden shadow-sm relative min-w-0 ${
        isWideLayout ? 'flex-1 h-full min-h-0' : 'w-full shrink-0'
      }`}>

        {/* Canvas Top Bar: Category Selector & View Switcher */}
        <div className="px-3 py-2 border-b border-subtle flex flex-wrap items-center justify-between gap-2 shrink-0 bg-card z-10">

          {/* Left: Defect Category Switcher Tabs */}
          <div className="flex items-center p-0.5 rounded-lg bg-inner border border-subtle gap-0.5 overflow-x-auto no-scrollbar max-w-full">
            <button
              type="button"
              onClick={() => setActiveDefectTab('blur')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeDefectTab === 'blur'
                  ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                  : 'text-text-muted hover:text-text-base'
              }`}
            >
              <Eye size={12} className="shrink-0" />
              <span>Blur Focus</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveDefectTab('obstruction')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeDefectTab === 'obstruction'
                  ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                  : 'text-text-muted hover:text-text-base'
              }`}
            >
              <Zap size={12} className="shrink-0" />
              <span>Lens &amp; Glitch</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveDefectTab('gps')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeDefectTab === 'gps'
                  ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                  : 'text-text-muted hover:text-text-base'
              }`}
            >
              <Navigation size={12} className="shrink-0" />
              <span>GPS Telemetry</span>
            </button>
          </div>

          {/* Right: View Toggle (Split / Dual) */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {activeDefectTab !== 'gps' ? (
              <button
                type="button"
                onClick={() => {
                  if (activeDefectTab === 'blur') setIsComparingSplit(!isComparingSplit);
                  else setIsComparingSplitObstruction(!isComparingSplitObstruction);
                }}
                className="px-2.5 py-1 rounded-md bg-inner hover:bg-card border border-subtle text-[11px] font-medium text-text-base transition-all cursor-pointer shadow-sm active:scale-95 flex items-center gap-1.5"
                title="Toggle between Split slider and Side-by-Side comparison"
              >
                {(activeDefectTab === 'blur' ? isComparingSplit : isComparingSplitObstruction) ? (
                  <>
                    <Columns size={11} className="text-text-muted" />
                    <span>Dual View</span>
                  </>
                ) : (
                  <>
                    <SlidersHorizontal size={11} className="text-text-muted" />
                    <span>Split Slider</span>
                  </>
                )}
              </button>
            ) : (
              <span className="text-[10px] text-text-muted font-mono px-2 py-0.5 rounded bg-inner border border-subtle">
                Haversine Geodesic
              </span>
            )}
          </div>
        </div>

        {/* Viewport Frame */}
        <div className={`relative bg-zinc-950 flex flex-col p-2 overflow-hidden select-none ${
          isWideLayout ? 'flex-1 h-full min-h-[360px]' : 'aspect-[16/9] min-h-[220px] max-h-[340px] w-full'
        }`}>
          <div className="relative w-full h-full flex-1 rounded-lg overflow-hidden border border-subtle/80 bg-black flex items-center justify-center">

            {/* ------------------------------------------------------------- */}
            {/* TAB 1: BLUR PREVIEW VIEWPORT */}
            {/* ------------------------------------------------------------- */}
            {activeDefectTab === 'blur' && (
              isComparingSplit ? (
                /* Interactive Split Comparison View with Real <img> Elements */
                <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                  {/* Baseline Sharp Image (Bottom Layer) */}
                  <img
                    src={sampleBlurImage}
                    alt="Sharp Reference Baseline"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                  />

                  {/* Simulated Blurry Layer (Clipped to Right Side by Slider) */}
                  <div
                    className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none flex items-center justify-center"
                    style={{
                      clipPath: `polygon(${splitPosition}% 0, 100% 0, 100% 100%, ${splitPosition}% 100%)`
                    }}
                  >
                    <img
                      src={sampleBlurImage}
                      alt="Simulated Blurry Layer"
                      className="absolute inset-0 w-full h-full object-contain"
                      style={{ filter: `blur(${blurPreviewLevel * 1.5}px)` }}
                    />
                  </div>

                  {/* High-Contrast Dark HUD Cards */}
                  {/* Left HUD: Baseline Sharp */}
                  <div className="absolute top-2.5 left-2.5 px-2 py-1 rounded-md backdrop-blur-md bg-black/85 border border-white/15 text-xs shadow-md flex items-center gap-1.5 z-10 pointer-events-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                    <span className="text-zinc-200 text-[10px] font-medium">Sharp Base</span>
                    <span className="font-mono text-white font-bold text-[11px] tabular-nums">{simulatedSharpScore.toFixed(1)}</span>
                  </div>

                  {/* Right HUD: Test Scan */}
                  <div className="absolute top-2.5 right-2.5 px-2 py-1 rounded-md backdrop-blur-md bg-black/85 border border-white/15 text-xs shadow-md flex items-center gap-1.5 z-10 pointer-events-none">
                    <span className={`w-1.5 h-1.5 rounded-full ${isSimulatedBlurFlagged ? 'bg-rose-400' : 'bg-emerald-400'} shrink-0`} />
                    <span className="text-zinc-200 text-[10px] font-medium hidden xs:inline">Simulated</span>
                    <span className="font-mono font-bold text-white text-[11px] tabular-nums">{simulatedBlurScore.toFixed(1)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      isSimulatedBlurFlagged
                        ? 'bg-rose-950/90 text-rose-300 border border-rose-700/80'
                        : 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/80'
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
                    aria-label="Blur comparison split slider"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                  />

                  {/* Split Divider Bar */}
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10 flex items-center justify-center -translate-x-1/2"
                    style={{ left: `${splitPosition}%` }}
                  >
                    <div className="w-0.5 h-full bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                    <div className="absolute w-6 h-6 rounded-full bg-zinc-900 border border-white/30 text-white flex items-center justify-center shadow-xl text-[10px] font-mono font-bold">
                      ↔
                    </div>
                  </div>

                  {/* Bottom Scan Zone Badge */}
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded backdrop-blur-md bg-black/85 border border-white/15 text-[10px] text-zinc-300 font-mono shadow-md flex items-center gap-1.5 z-10 pointer-events-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                    <span>Scan: {(thresholds.deliverableModel || 'masked_car') === 'generative_fill' ? '15% – 80% (Full Frame)' : '10% – 52% (Upper ROI)'}</span>
                  </div>

                  {/* Center Helper Text */}
                  <div className="hidden md:block absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full backdrop-blur-md bg-black/85 border border-white/15 text-[10px] text-zinc-300 font-sans pointer-events-none shadow-md whitespace-nowrap">
                    Drag split divider horizontally to compare Sharp (Left) vs Blurry (Right)
                  </div>
                </div>
              ) : (
                /* Side-by-Side Dual View */
                <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-2 p-2">
                  <div className="relative rounded-lg overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src={sampleBlurImage}
                      alt="Sharp Reference"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded backdrop-blur-md bg-black/85 border border-white/15 text-xs text-white flex items-center gap-1.5 shadow-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <span className="text-[10px] font-medium">Sharp Base ({simulatedSharpScore.toFixed(1)})</span>
                    </div>
                  </div>

                  <div className="relative rounded-lg overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src={sampleBlurImage}
                      alt="Simulated Blurry Frame"
                      className="w-full h-full object-contain"
                      style={{ filter: `blur(${blurPreviewLevel * 1.5}px)` }}
                    />
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded backdrop-blur-md bg-black/85 border border-white/15 text-xs text-white flex items-center gap-1.5 shadow-md">
                      <span className={`w-1.5 h-1.5 rounded-full ${isSimulatedBlurFlagged ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                      <span className="text-[10px] font-medium">Simulated ({simulatedBlurScore.toFixed(1)})</span>
                      <span className={`text-[9px] font-bold ${isSimulatedBlurFlagged ? 'text-rose-400' : 'text-emerald-400'}`}>
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
                <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                  {/* Clean Baseline Base (Left Side) */}
                  <img
                    src="/samples/sample_survey_sharp.jpg"
                    alt="Nominal Baseline Sensor"
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                  />

                  {/* Simulated Occluded/Glitched Layer (Right Side) */}
                  <div
                    className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none flex items-center justify-center"
                    style={{
                      clipPath: `polygon(${splitPositionObstruction}% 0, 100% 0, 100% 100%, ${splitPositionObstruction}% 100%)`
                    }}
                  >
                    {obstructionSimMode === 'glitch' ? (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <img
                          src="/samples/sample_survey_sharp.jpg"
                          alt="Base"
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                        <img
                          src="/samples/sample_survey_glitch.jpg"
                          alt="Glitch Overlay"
                          className="absolute inset-0 w-full h-full object-contain transition-opacity duration-75"
                          style={{ opacity: glitchIntensity / 100 }}
                        />
                      </div>
                    ) : (
                      <img
                        src="/samples/sample_survey_sharp.jpg"
                        alt="Simulated Filtered Sensor"
                        className="absolute inset-0 w-full h-full object-contain"
                        style={{
                          filter: obstructionSimMode === 'blackout'
                            ? `brightness(${Math.max(0.04, blackoutSimLevel / 120)})`
                            : `brightness(${1 + (glareSimLevel - 180) / 75 * 1.8}) contrast(${1 - (glareSimLevel - 180) / 75 * 0.3})`
                        }}
                      />
                    )}
                  </div>

                  {/* HUD Cards */}
                  <div className="absolute top-2.5 left-2.5 px-2 py-1 rounded-md backdrop-blur-md bg-black/85 border border-white/15 text-xs shadow-md flex items-center gap-1.5 z-10 pointer-events-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                    <span className="text-zinc-200 text-[10px] font-medium">Nominal Sensor</span>
                    <span className="font-mono text-white font-bold text-[11px] tabular-nums">132.0</span>
                  </div>

                  <div className="absolute top-2.5 right-2.5 px-2 py-1 rounded-md backdrop-blur-md bg-black/85 border border-white/15 text-xs shadow-md flex items-center gap-1.5 z-10 pointer-events-none">
                    <span className={`w-1.5 h-1.5 rounded-full ${isObstructionFlagged ? 'bg-rose-400' : 'bg-emerald-400'} shrink-0`} />
                    <span className="text-zinc-200 text-[10px] font-medium hidden xs:inline">
                      {obstructionSimMode === 'glitch' && `Glitch (${glitchIntensity}%)`}
                      {obstructionSimMode === 'blackout' && `Luma ${blackoutSimLevel}`}
                      {obstructionSimMode === 'glare' && `Luma ${glareSimLevel}`}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      isObstructionFlagged
                        ? 'bg-rose-950/90 text-rose-300 border border-rose-700/80'
                        : 'bg-emerald-950/90 text-emerald-300 border border-emerald-700/80'
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
                    aria-label="Obstruction comparison split slider"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                  />

                  {/* Split Divider Bar */}
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10 flex items-center justify-center -translate-x-1/2"
                    style={{ left: `${splitPositionObstruction}%` }}
                  >
                    <div className="w-0.5 h-full bg-white/80 shadow-[0_0_8px_rgba(255,255,255,0.6)]" />
                    <div className="absolute w-6 h-6 rounded-full bg-zinc-900 border border-white/30 text-white flex items-center justify-center shadow-xl text-[10px] font-mono font-bold">
                      ↔
                    </div>
                  </div>

                  {/* Center Helper Text */}
                  <div className="hidden md:block absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full backdrop-blur-md bg-black/85 border border-white/15 text-[10px] text-zinc-300 font-sans pointer-events-none shadow-md whitespace-nowrap">
                    Drag split divider horizontally to compare Nominal (Left) vs Glitched/Occluded (Right)
                  </div>
                </div>
              ) : (
                /* Side-by-Side Dual View */
                <div className="w-full h-full grid grid-cols-1 sm:grid-cols-2 gap-2 p-2">
                  <div className="relative rounded-lg overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    <img
                      src="/samples/sample_survey_sharp.jpg"
                      alt="Nominal Clean Frame"
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded backdrop-blur-md bg-black/85 border border-white/15 text-xs text-white flex items-center gap-1.5 shadow-md">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      <span className="text-[10px] font-medium">Nominal Sensor (132.0)</span>
                    </div>
                  </div>

                  <div className="relative rounded-lg overflow-hidden border border-subtle bg-black flex items-center justify-center min-h-[140px]">
                    {obstructionSimMode === 'glitch' ? (
                      <div className="relative w-full h-full flex items-center justify-center">
                        <img
                          src="/samples/sample_survey_sharp.jpg"
                          alt="Base Frame"
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                        <img
                          src="/samples/sample_survey_glitch.jpg"
                          alt="Glitch Frame"
                          className="absolute inset-0 w-full h-full object-contain"
                          style={{ opacity: glitchIntensity / 100 }}
                        />
                      </div>
                    ) : (
                      <img
                        src="/samples/sample_survey_sharp.jpg"
                        alt="Filtered Occlusion Frame"
                        className="w-full h-full object-contain"
                        style={{
                          filter: obstructionSimMode === 'blackout'
                            ? `brightness(${Math.max(0.04, blackoutSimLevel / 120)})`
                            : `brightness(${1 + (glareSimLevel - 180) / 75 * 1.8}) contrast(${1 - (glareSimLevel - 180) / 75 * 0.3})`
                        }}
                      />
                    )}
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded backdrop-blur-md bg-black/85 border border-white/15 text-xs text-white flex items-center gap-1.5 shadow-md">
                      <span className={`w-1.5 h-1.5 rounded-full ${isObstructionFlagged ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                      <span className="text-[10px] font-medium">
                        {obstructionSimMode === 'glitch' ? 'Glitched Frame' : obstructionSimMode === 'blackout' ? 'Occluded/Dark' : 'Glare/Solar Flare'}
                      </span>
                      <span className={`text-[9px] font-bold ${isObstructionFlagged ? 'text-rose-400' : 'text-emerald-400'}`}>
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
              <div className="w-full h-full flex items-center justify-center p-3 relative overflow-hidden bg-black">
                {/* SVG Visual Map Track Simulation */}
                <div className="w-full max-w-2xl bg-card border border-subtle rounded-xl p-3 sm:p-4 flex flex-col justify-center shadow-sm">
                  <svg viewBox="0 0 700 160" className="w-full h-auto max-h-[220px]">
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
                    <text x="60" y="130" fill="#a1a1aa" fontSize="11" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="500">Stn 1</text>
                    <text x="60" y="145" fill="#71717a" fontSize="10" textAnchor="middle" fontFamily="Inter, sans-serif">(3.1m)</text>

                    <circle cx="170" cy="90" r="6" fill="#a1a1aa" />
                    <text x="170" y="130" fill="#a1a1aa" fontSize="11" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="500">Stn 2</text>
                    <text x="170" y="145" fill="#71717a" fontSize="10" textAnchor="middle" fontFamily="Inter, sans-serif">(2.9m)</text>

                    <circle cx="280" cy="90" r="6" fill="#a1a1aa" />
                    <text x="280" y="130" fill="#a1a1aa" fontSize="11" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="500">Stn 3</text>
                    <text x="280" y="145" fill="#71717a" fontSize="10" textAnchor="middle" fontFamily="Inter, sans-serif">(3.0m)</text>

                    <circle cx="390" cy="90" r="7" fill="#ffffff" stroke="#71717a" strokeWidth="2" />
                    <text x="390" y="130" fill="#ffffff" fontSize="11" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="600">Stn 4</text>
                    <text x="390" y="145" fill="#a1a1aa" fontSize="10" textAnchor="middle" fontFamily="Inter, sans-serif">Origin</text>

                    <circle cx="650" cy="90" r="8" fill="#f43f5e" stroke="#ffffff" strokeWidth="2" />
                    <text x="650" y="130" fill="#f43f5e" fontSize="11" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="600">Stn 5</text>
                    <text x="650" y="145" fill="#f43f5e" fontSize="10" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="600">78.4m Jump</text>

                    <g transform="translate(520, 36)">
                      <rect x="-75" y="-12" width="150" height="24" rx="12" fill="#18181b" stroke="#f43f5e" strokeWidth="1.5" />
                      <text x="0" y="4" fill="#f43f5e" fontSize="10" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="600">
                        GPS Jump &gt; {thresholds.gpsMaxJumpDistanceMeters}m (Defect)
                      </text>
                    </g>
                  </svg>
                </div>
              </div>
            )}

          </div>
        </div>

      </main>

      {/* ========================================================================= */}
      {/* 2. PARAMETERS CONFIGURATION PANEL */}
      {/* ========================================================================= */}
      <aside className={`bg-card border border-subtle rounded-xl flex flex-col shrink-0 shadow-sm text-xs ${
        isWideLayout ? 'w-[360px] h-full min-h-0 overflow-hidden' : 'w-full'
      }`}>

        {/* Panel Header with Action Buttons */}
        <div className="h-11 px-3 border-b border-subtle flex items-center justify-between shrink-0 bg-card">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[11px] text-text-base uppercase tracking-wider">
              {activeDefectTab === 'blur' && 'Focus Settings'}
              {activeDefectTab === 'obstruction' && 'Obstruction Settings'}
              {activeDefectTab === 'gps' && 'GPS Telemetry Settings'}
            </span>
          </div>

          {/* Quick Actions (Reset & Save) */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleReset}
              className="px-2 py-0.5 bg-inner hover:bg-inner/80 text-text-muted hover:text-text-base rounded border border-subtle text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 shadow-sm active:scale-95"
              title="Reset parameters to calibrated defaults"
            >
              <RotateCcw size={11} />
              <span>Reset</span>
            </button>

            <button
              type="button"
              onClick={handleApply}
              disabled={showToast}
              className="px-2.5 py-0.5 bg-text-base hover:opacity-90 text-app rounded text-[11px] font-semibold transition-all cursor-pointer shadow-sm active:scale-95 flex items-center gap-1 disabled:opacity-75"
            >
              <Check size={11} className="stroke-[2.5]" />
              <span>{showToast ? 'Saved' : 'Apply & Save'}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Parameters Body */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">

          {/* TAB 1: BLUR PARAMETERS */}
          {activeDefectTab === 'blur' && (
            <>
              {/* Deliverable Image Model Selector Card */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-base font-semibold text-[11px]">Deliverable Image Model</span>
                  <span className="font-mono text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-card border border-subtle">
                    {(thresholds.deliverableModel || 'masked_car') === 'generative_fill' ? 'Full 80% ROI' : 'Top 52% ROI'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-card border border-subtle">
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, deliverableModel: 'masked_car' }))}
                    className={`py-1.5 px-2 rounded text-left transition-all cursor-pointer ${
                      (thresholds.deliverableModel || 'masked_car') === 'masked_car'
                        ? 'bg-inner text-text-base shadow-sm font-semibold border border-subtle ring-1 ring-white/5'
                        : 'text-text-muted hover:text-text-base'
                    }`}
                  >
                    <span className="font-semibold text-[11px] text-text-base block leading-tight">Masked Vehicle</span>
                    <span className="text-[10px] text-text-muted mt-0.5 block truncate">Top 52% (excludes nadir)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, deliverableModel: 'generative_fill' }))}
                    className={`py-1.5 px-2 rounded text-left transition-all cursor-pointer ${
                      thresholds.deliverableModel === 'generative_fill'
                        ? 'bg-inner text-text-base shadow-sm font-semibold border border-subtle ring-1 ring-white/5'
                        : 'text-text-muted hover:text-text-base'
                    }`}
                  >
                    <span className="font-semibold text-[11px] text-text-base block leading-tight">Generative Fill</span>
                    <span className="text-[10px] text-text-muted mt-0.5 block truncate">Full scene (80% ROI)</span>
                  </button>
                </div>
                <p className="text-[10px] text-text-muted leading-relaxed">
                  {(thresholds.deliverableModel || 'masked_car') === 'masked_car'
                    ? 'Excludes the lower nadir vehicle silhouette to avoid false edge spikes.'
                    : 'Evaluates continuous road textures and vertical assets across the full scene.'}
                </p>
              </div>

              {/* Blur Defect Cutoff Card */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-base font-semibold text-[11px]">Blur Defect Cutoff</span>
                  <span className="font-mono text-text-base font-bold text-[11px] tabular-nums">
                    {thresholds.blurVarianceThreshold.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="78"
                  step="0.5"
                  value={thresholds.blurVarianceThreshold}
                  onChange={(e) => setThresholds(prev => ({ ...prev, blurVarianceThreshold: Number(e.target.value) }))}
                  aria-label="Blur defect cutoff threshold"
                  className="studio-slider"
                />
                <div className="flex justify-between text-[10px] text-text-muted font-mono pt-0.5">
                  <span>55.0 (Lenient)</span>
                  <span className="text-text-base font-semibold">68.0 (Standard)</span>
                  <span>75.0 (Strict)</span>
                </div>
                <p className="text-[10px] text-text-muted leading-relaxed pt-1 border-t border-subtle/70">
                  Logic: Frames scoring <strong className="text-text-base font-semibold">≥ {thresholds.blurVarianceThreshold.toFixed(1)}</strong> pass. Below cutoff flags <strong className="text-rose-400 font-semibold">Defect</strong>.
                </p>
              </div>

              {/* Simulate Photo Blur Slider */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-base font-semibold text-[11px]">Simulate Lens Blur</span>
                  <span className="font-mono text-text-base font-bold text-[11px] tabular-nums">
                    {blurPreviewLevel.toFixed(1)}px
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.2"
                  value={blurPreviewLevel}
                  onChange={(e) => setBlurPreviewLevel(Number(e.target.value))}
                  aria-label="Simulate lens blur level"
                  className="studio-slider"
                />
                <div className="flex items-center justify-between pt-0.5">
                  <span className="text-[10px] text-text-muted">Simulated Status:</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono ${
                    isSimulatedBlurFlagged
                      ? 'bg-rose-950/40 text-rose-300 border border-rose-800/60'
                      : 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/60'
                  }`}>
                    {isSimulatedBlurFlagged ? 'Defect (Blurry)' : 'Passed (Sharp)'}
                  </span>
                </div>
              </div>

              {/* Presets */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Calibration Presets</label>
                <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-inner border border-subtle">
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 55.0 }))}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] ${
                      thresholds.blurVarianceThreshold === 55.0
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    Lenient (55)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 68.0 }))}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] ${
                      thresholds.blurVarianceThreshold === 68.0
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    Standard (68)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 75.0 }))}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] ${
                      thresholds.blurVarianceThreshold === 75.0
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    Strict (75)
                  </button>
                </div>
              </div>

              {/* Evaluation Status Card */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-text-muted uppercase font-bold tracking-wider block">Evaluation Verdict</span>
                  <span className="font-semibold text-text-base text-[11px] mt-0.5 block">
                    {isSimulatedBlurFlagged ? 'Flagged as Defect' : 'Passed Inspection'}
                  </span>
                </div>
                <span className={`font-mono font-bold text-[11px] tabular-nums ${isSimulatedBlurFlagged ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {simulatedBlurScore.toFixed(1)} {isSimulatedBlurFlagged ? '<' : '≥'} {thresholds.blurVarianceThreshold.toFixed(1)}
                </span>
              </div>

              {/* Suggested Cutoff by Survey Type Note */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider block">
                  Suggested Cutoff by Survey Type
                </span>
                <div className="space-y-1">
                  <div
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 75.0 }))}
                    className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                      thresholds.blurVarianceThreshold >= 72.0 && thresholds.blurVarianceThreshold <= 75.0
                        ? 'bg-card border-subtle text-text-base shadow-sm ring-1 ring-white/5'
                        : 'bg-card/40 border-subtle hover:bg-card text-text-muted hover:text-text-base'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-[11px] text-text-base block">Utility Asset Audit</span>
                      <span className="text-[10px] text-text-muted block truncate">Pole numbers, cables, meter boxes</span>
                    </div>
                    <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-inner border border-subtle text-text-muted shrink-0">
                      72 – 75
                    </span>
                  </div>

                  <div
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 68.0 }))}
                    className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                      thresholds.blurVarianceThreshold === 68.0
                        ? 'bg-card border-subtle text-text-base shadow-sm ring-1 ring-white/5'
                        : 'bg-card/40 border-subtle hover:bg-card text-text-muted hover:text-text-base'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-[11px] text-text-base block">Standard Urban Mapping</span>
                      <span className="text-[10px] text-text-muted block truncate">Balanced pass/fail SLA rate</span>
                    </div>
                    <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-inner border border-subtle text-text-muted shrink-0">
                      68
                    </span>
                  </div>

                  <div
                    onClick={() => setThresholds(prev => ({ ...prev, blurVarianceThreshold: 60.0 }))}
                    className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                      thresholds.blurVarianceThreshold >= 55.0 && thresholds.blurVarianceThreshold <= 60.0
                        ? 'bg-card border-subtle text-text-base shadow-sm ring-1 ring-white/5'
                        : 'bg-card/40 border-subtle hover:bg-card text-text-muted hover:text-text-base'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-[11px] text-text-base block">Highway &amp; Rural Captures</span>
                      <span className="text-[10px] text-text-muted block truncate">Open sky, vegetation &amp; fields</span>
                    </div>
                    <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-inner border border-subtle text-text-muted shrink-0">
                      55 – 60
                    </span>
                  </div>
                </div>
              </div>

              {/* Technical Note */}
              <div className="p-2 rounded-lg bg-inner/60 border border-subtle text-[10px] text-text-muted leading-relaxed">
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
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Simulation Mode</label>
                <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-inner border border-subtle">
                  <button
                    type="button"
                    onClick={() => setObstructionSimMode('glitch')}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] flex flex-col items-center gap-0.5 ${
                      obstructionSimMode === 'glitch'
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    <Zap size={12} className="text-text-muted" />
                    <span>Glitch</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setObstructionSimMode('blackout')}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] flex flex-col items-center gap-0.5 ${
                      obstructionSimMode === 'blackout'
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    <EyeOff size={12} className="text-text-muted" />
                    <span>Blackout</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setObstructionSimMode('glare')}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] flex flex-col items-center gap-0.5 ${
                      obstructionSimMode === 'glare'
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    <Sun size={12} className="text-text-muted" />
                    <span>Solar Glare</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Interactive Simulator Sliders Based on Active Mode */}
              {obstructionSimMode === 'glitch' && (
                <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-text-base font-semibold text-[11px]">Glitch / Aberration Intensity</span>
                    <span className="font-mono text-text-base font-bold text-[11px] tabular-nums">{glitchIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={glitchIntensity}
                    onChange={(e) => setGlitchIntensity(Number(e.target.value))}
                    aria-label="Glitch intensity level"
                    className="studio-slider"
                  />
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    Slide to adjust hardware scanline split and chromatic aberration intensity.
                  </p>
                </div>
              )}

              {obstructionSimMode === 'blackout' && (
                <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-text-base font-semibold text-[11px]">Simulate Darkness Luma</span>
                    <span className="font-mono text-text-base font-bold text-[11px] tabular-nums">{blackoutSimLevel}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="40"
                    step="1"
                    value={blackoutSimLevel}
                    onChange={(e) => setBlackoutSimLevel(Number(e.target.value))}
                    aria-label="Blackout luma level"
                    className="studio-slider"
                  />
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    Slide to simulate tunnel darkness and test blackout occlusion trigger.
                  </p>
                </div>
              )}

              {obstructionSimMode === 'glare' && (
                <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-text-base font-semibold text-[11px]">Simulate Solar Flare Luma</span>
                    <span className="font-mono text-text-base font-bold text-[11px] tabular-nums">{glareSimLevel}</span>
                  </div>
                  <input
                    type="range"
                    min="200"
                    max="255"
                    step="1"
                    value={glareSimLevel}
                    onChange={(e) => setGlareSimLevel(Number(e.target.value))}
                    aria-label="Solar flare luma level"
                    className="studio-slider"
                  />
                  <p className="text-[10px] text-text-muted leading-relaxed">
                    Slide to simulate blinding sun glare flare on the camera lens.
                  </p>
                </div>
              )}

              {/* Threshold Cutoff Setting 1: Occlusion Min Brightness */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-base font-semibold text-[11px]">Occlusion Min Brightness</span>
                  <span className="font-mono text-text-base font-bold text-[11px] tabular-nums">{thresholds.obstructionMinBrightness}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="60"
                  step="1"
                  value={thresholds.obstructionMinBrightness}
                  onChange={(e) => setThresholds(prev => ({ ...prev, obstructionMinBrightness: Number(e.target.value) }))}
                  aria-label="Occlusion min brightness threshold"
                  className="studio-slider"
                />
                <p className="text-[10px] text-text-muted leading-relaxed">
                  Frame average luminance &lt; <span className="text-text-base font-mono font-semibold">{thresholds.obstructionMinBrightness}</span> flags lens blackout (Default: 15).
                </p>
              </div>

              {/* Threshold Cutoff Setting 2: Glare Clipping Limit */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-base font-semibold text-[11px]">Solar Glare Saturation Limit</span>
                  <span className="font-mono text-text-base font-bold text-[11px] tabular-nums">{thresholds.glareLuminanceThreshold}</span>
                </div>
                <input
                  type="range"
                  min="200"
                  max="255"
                  step="1"
                  value={thresholds.glareLuminanceThreshold}
                  onChange={(e) => setThresholds(prev => ({ ...prev, glareLuminanceThreshold: Number(e.target.value) }))}
                  aria-label="Solar glare saturation limit threshold"
                  className="studio-slider"
                />
                <p className="text-[10px] text-text-muted leading-relaxed">
                  Overexposure clipping &ge; <span className="text-text-base font-mono font-semibold">{thresholds.glareLuminanceThreshold}</span> on &gt;95% of pixels flags direct sun glare (Default: 240).
                </p>
              </div>

              {/* Status Verdict Box */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-text-muted uppercase font-bold tracking-wider block">Defect Verdict</span>
                  <span className="font-semibold text-text-base text-[11px] mt-0.5 block">
                    {isObstructionFlagged ? 'Flagged as Defect' : 'Passed Inspection'}
                  </span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  isObstructionFlagged
                    ? 'text-rose-300 bg-rose-950/50 border border-rose-700/80'
                    : 'text-emerald-300 bg-emerald-950/50 border border-emerald-700/80'
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
              <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-text-base font-semibold text-[11px]">GPS Max Jump Cutoff</span>
                  <span className="font-mono text-text-base font-bold text-[11px] tabular-nums">{thresholds.gpsMaxJumpDistanceMeters}m</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="150"
                  step="5"
                  value={thresholds.gpsMaxJumpDistanceMeters}
                  onChange={(e) => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: Number(e.target.value) }))}
                  aria-label="GPS max jump distance cutoff"
                  className="studio-slider"
                />
                <div className="flex justify-between text-[10px] text-text-muted font-mono pt-0.5">
                  <span>10m (Dense)</span>
                  <span className="text-text-base font-semibold">50m (Standard)</span>
                  <span>150m (Highway)</span>
                </div>
              </div>

              {/* Presets */}
              <div className="space-y-1">
                <label className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Survey Presets</label>
                <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-inner border border-subtle">
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: 25 }))}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] ${
                      thresholds.gpsMaxJumpDistanceMeters === 25
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    Dense (25m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: 50 }))}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] ${
                      thresholds.gpsMaxJumpDistanceMeters === 50
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    Standard (50m)
                  </button>
                  <button
                    type="button"
                    onClick={() => setThresholds(prev => ({ ...prev, gpsMaxJumpDistanceMeters: 100 }))}
                    className={`py-1 px-1 rounded text-center transition-all cursor-pointer text-[11px] ${
                      thresholds.gpsMaxJumpDistanceMeters === 100
                        ? 'bg-card text-text-base shadow-sm font-semibold border border-subtle'
                        : 'text-text-muted hover:text-text-base font-medium'
                    }`}
                  >
                    Highway (100m)
                  </button>
                </div>
              </div>

              {/* Summary Card */}
              <div className="p-2.5 rounded-lg bg-inner border border-subtle space-y-1">
                <span className="text-[9px] text-text-muted uppercase font-bold tracking-wider block">Active Configuration</span>
                <p className="text-text-base font-medium text-[11px] leading-relaxed">
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
