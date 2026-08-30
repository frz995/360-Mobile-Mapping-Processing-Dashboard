import { useState, useEffect, useCallback, type FC } from 'react';
import {
    Play,
    Pause,
    SkipBack,
    SkipForward,
    Compass,
    Navigation,
    ZoomIn,
    ZoomOut,
    Maximize2,
} from 'lucide-react';

export interface WebGISHUDOverlayProps {
    imageName: string;
    currentIndex: number;
    totalFrames: number;
    coordinates: { lat: number; lng: number };
    heading?: number;
    gpsAccuracy?: string;
    equipType?: string;
    showPlayback?: boolean;
    onIndexChange: (newIndex: number) => void;
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onFullscreen?: () => void;
    playSpeedMs?: number;
}

export const WebGISHUDViewerOverlay: FC<WebGISHUDOverlayProps> = ({
    imageName,
    currentIndex,
    totalFrames,
    coordinates,
    heading = 0,
    gpsAccuracy = '0.0m',
    equipType = 'MMS',
    showPlayback = true,
    onIndexChange,
    onZoomIn,
    onZoomOut,
    onFullscreen,
    playSpeedMs = 850,
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isTrackLocked, setIsTrackLocked] = useState(true);

    // Playback timer loop
    useEffect(() => {
        let timer: number | null = null;
        if (isPlaying) {
            timer = window.setInterval(() => {
                onIndexChange(currentIndex >= totalFrames - 1 ? 0 : currentIndex + 1);
            }, playSpeedMs);
        }
        return () => {
            if (timer !== null) clearInterval(timer);
        };
    }, [isPlaying, currentIndex, totalFrames, playSpeedMs, onIndexChange]);

    const handlePrev = useCallback(() => {
        if (currentIndex > 0) onIndexChange(currentIndex - 1);
    }, [currentIndex, onIndexChange]);

    const handleNext = useCallback(() => {
        if (currentIndex < totalFrames - 1) onIndexChange(currentIndex + 1);
    }, [currentIndex, totalFrames, onIndexChange]);

    // Keyboard navigation shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === 'ArrowLeft') handlePrev();
            if (e.key === 'ArrowRight') handleNext();
            if (e.key === ' ') {
                e.preventDefault();
                setIsPlaying((prev) => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handlePrev, handleNext]);

    return (
        <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-2 select-none font-sans overflow-hidden">
            {/* Top Telemetry Floating Deck */}
            <div className="flex justify-between items-start w-full gap-1.5">
                <div
                    style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-subtle)',
                        boxShadow: 'var(--card-shadow)',
                    }}
                    className="pointer-events-auto backdrop-blur-md border px-2 py-0.5 rounded-lg transition-colors duration-200"
                >
                    <div className="flex items-center gap-1.5">
                        <span
                            style={{ backgroundColor: 'var(--accent)' }}
                            className="w-1.5 h-1.5 rounded-full animate-pulse shadow-sm shrink-0"
                        />
                        <span style={{ color: 'var(--text-primary)' }} className="font-sans text-[10px] font-bold tracking-tight truncate max-w-[120px] sm:max-w-[160px]">
                            {imageName || `Station-${currentIndex + 1}`}
                        </span>
                    </div>
                    <div style={{ color: 'var(--text-muted)' }} className="text-[9px] font-sans leading-none mt-0.5">
                        Station <span style={{ color: 'var(--text-primary)' }} className="font-semibold">{currentIndex + 1}</span> of {totalFrames}
                    </div>
                </div>

                <div
                    style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-subtle)',
                        boxShadow: 'var(--card-shadow)',
                    }}
                    className="pointer-events-auto backdrop-blur-md border px-2 py-0.5 rounded-lg text-right font-sans transition-colors duration-200"
                >
                    <div className="text-[9.5px] leading-tight">
                        <span style={{ color: 'var(--text-muted)' }}>GPS: </span>
                        <span style={{ color: 'var(--accent)' }} className="font-bold">{gpsAccuracy}</span>
                    </div>
                    <div className="text-[9px] leading-tight mt-0.5">
                        <span style={{ color: 'var(--text-muted)' }}>Equip: </span>
                        <span style={{ color: 'var(--text-primary)' }} className="font-semibold">{equipType}</span>
                    </div>
                </div>
            </div>

            {/* Bottom Floating Bar */}
            <div className="relative w-full flex items-center justify-between min-h-[30px]">
                {/* Left: Pure Spatial Coordinates Badge */}
                <div
                    style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-subtle)',
                        boxShadow: 'var(--card-shadow)',
                    }}
                    className="pointer-events-auto backdrop-blur-md border px-2 py-1 rounded-lg font-sans text-[9.5px] flex items-center gap-1.5 transition-colors duration-200 shrink-0 z-0"
                >
                    <Navigation style={{ color: 'var(--accent)' }} className="w-2.5 h-2.5 rotate-45 shrink-0" />
                    <span style={{ color: 'var(--text-primary)' }} className="font-semibold whitespace-nowrap">
                        {coordinates.lat.toFixed(4)}°, {coordinates.lng.toFixed(4)}°
                    </span>
                </div>

                {/* Center: Absolute Dead-Center Playback Dock */}
                {showPlayback && (
                    <div
                        style={{
                            backgroundColor: 'var(--bg-card)',
                            borderColor: 'var(--border-subtle)',
                            boxShadow: 'var(--card-shadow)',
                        }}
                        className="pointer-events-auto absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-0.5 px-1.5 py-0.5 backdrop-blur-md border rounded-lg transition-all shrink-0 z-10"
                    >
                        {/* Prev Frame */}
                        <button
                            type="button"
                            onClick={handlePrev}
                            disabled={currentIndex === 0}
                            aria-label="Previous Frame"
                            style={{ color: 'var(--text-muted)' }}
                            className="p-1 rounded transition hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg)] disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                        >
                            <SkipBack className="w-3 h-3" />
                        </button>

                        {/* Play/Pause */}
                        <button
                            type="button"
                            onClick={() => setIsPlaying((prev) => !prev)}
                            aria-label={isPlaying ? 'Pause' : 'Play'}
                            style={{ backgroundColor: 'var(--accent)' }}
                            className="w-5 h-5 rounded flex items-center justify-center text-white transition-all shadow-sm hover:brightness-110 active:scale-95 cursor-pointer"
                        >
                            {isPlaying ? (
                                <Pause className="w-2.5 h-2.5 fill-white" />
                            ) : (
                                <Play className="w-2.5 h-2.5 fill-white translate-x-0.2" />
                            )}
                        </button>

                        {/* Next Frame */}
                        <button
                            type="button"
                            onClick={handleNext}
                            disabled={currentIndex >= totalFrames - 1}
                            aria-label="Next Frame"
                            style={{ color: 'var(--text-muted)' }}
                            className="p-1 rounded transition hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg)] disabled:opacity-20 disabled:hover:bg-transparent cursor-pointer"
                        >
                            <SkipForward className="w-3 h-3" />
                        </button>

                        <div style={{ backgroundColor: 'var(--border-subtle)' }} className="h-2.5 w-[1px] mx-0.5" />

                        {/* Frame Counter */}
                        <div className="flex items-center gap-0.5 px-0.5 font-sans text-[9.5px] font-bold whitespace-nowrap">
                            <span style={{ color: 'var(--text-primary)' }}>{totalFrames > 0 ? currentIndex + 1 : 0}</span>
                            <span style={{ color: 'var(--text-muted)' }}>/</span>
                            <span style={{ color: 'var(--text-muted)' }}>{totalFrames}</span>
                        </div>
                    </div>
                )}

                {/* Right: Merged Canvas Tools & Compass Bearing */}
                <div
                    style={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-subtle)',
                        boxShadow: 'var(--card-shadow)',
                    }}
                    className="pointer-events-auto backdrop-blur-md border px-1.5 py-0.5 rounded-lg flex items-center gap-1.5 transition-colors duration-200 shrink-0 z-0"
                >
                    {/* Zoom & Fullscreen Tools */}
                    <div className="flex items-center gap-0.5">
                        <button
                            type="button"
                            onClick={onZoomIn}
                            title="Zoom In"
                            style={{ color: 'var(--text-muted)' }}
                            className="p-0.5 rounded hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg)] transition cursor-pointer"
                        >
                            <ZoomIn className="w-2.5 h-2.5" />
                        </button>
                        <button
                            type="button"
                            onClick={onZoomOut}
                            title="Zoom Out"
                            style={{ color: 'var(--text-muted)' }}
                            className="p-0.5 rounded hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg)] transition cursor-pointer"
                        >
                            <ZoomOut className="w-2.5 h-2.5" />
                        </button>
                        <button
                            type="button"
                            onClick={onFullscreen}
                            title="Toggle Fullscreen"
                            style={{ color: 'var(--text-muted)' }}
                            className="p-0.5 rounded hover:text-[var(--text-primary)] hover:bg-[var(--accent-bg)] transition cursor-pointer"
                        >
                            <Maximize2 className="w-2.5 h-2.5" />
                        </button>
                    </div>

                    <div style={{ backgroundColor: 'var(--border-subtle)' }} className="h-2.5 w-[1px]" />

                    {/* Compass & Track Mode */}
                    <button
                        type="button"
                        onClick={() => setIsTrackLocked((prev) => !prev)}
                        title="Toggle Trajectory Bearing Lock"
                        className="flex items-center gap-1 font-sans text-[9px] hover:text-[var(--accent)] transition-all cursor-pointer"
                    >
                        <Compass className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                        <span style={{ color: 'var(--text-primary)' }} className="font-bold whitespace-nowrap">
                            {Math.round(heading)}°
                        </span>
                        <span style={{ color: isTrackLocked ? 'var(--accent)' : 'var(--text-muted)' }} className="text-[8px] font-semibold">
                            {isTrackLocked ? 'Lock' : 'Free'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WebGISHUDViewerOverlay;