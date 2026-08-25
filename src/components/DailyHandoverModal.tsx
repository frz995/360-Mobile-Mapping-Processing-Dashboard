import React, { useState, useMemo } from 'react';
import {
    Clock,
    HardDrive,
    ShieldAlert,
    ArrowRight,
    CheckCircle2,
    X,
    RotateCcw,
    ExternalLink,
    Play,
    Layers
} from 'lucide-react';

export interface DailyHandoverModalProps {
    isOpen: boolean;
    onClose: () => void;
    dailyData: any[];
    batchLogs: any[];
    currentUser?: string;
    onSelectSubgrid?: (subgridKey: string) => void;
    onOpenQAQCWorkbench?: (subgridKey?: string) => void;
    onOpenDefectsGallery?: (subgridKey?: string) => void;
    onOpenBatchProcessing?: () => void;
}

// Clean helper to format username (e.g. "fariz.farhan95" -> "Fariz Farhan")
function formatDisplayName(rawName?: string): string {
    if (!rawName) return 'Operations Engineer';
    const base = rawName.split('@')[0];
    const parts = base.replace(/[0-9]/g, '').split(/[._-]/).filter(Boolean);
    if (parts.length === 0) return base;
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

export const DailyHandoverModal: React.FC<DailyHandoverModalProps> = ({
    isOpen,
    onClose,
    dailyData = [],
    batchLogs = [],
    currentUser = 'Fariz Farhan',
    onSelectSubgrid,
    onOpenQAQCWorkbench,
    onOpenDefectsGallery,
    onOpenBatchProcessing
}) => {
    const [dontShowToday, setDontShowToday] = useState(false);

    // Save dismissal preference
    const handleDismiss = () => {
        if (dontShowToday) {
            const todayStr = new Date().toISOString().slice(0, 10);
            localStorage.setItem('geosphere360_handover_dismissed_date', todayStr);
        }
        onClose();
    };

    // Calculate pending handover metrics dynamically
    const analysis = useMemo(() => {
        // 1. Storage Discrepancies (Grouped by unique subgrid)
        const storageMap = new Map<string, { subgrid: string; totalPoi: number; availableFrames: number }>();
        dailyData.forEach((item) => {
            const sg = (item.subgrid || '').toUpperCase().trim();
            if (!sg) return;
            const poi = Number(item.poiCount || item.imagesProcessed || 0);
            const frames = Number(item.availableImagesCount || (item.panoramas ? item.panoramas.length : 0) || 0);
            const existing = storageMap.get(sg);
            if (existing) {
                existing.totalPoi += poi;
                existing.availableFrames += frames;
            } else {
                storageMap.set(sg, { subgrid: sg, totalPoi: poi, availableFrames: frames });
            }
        });

        const storageDiscrepancies = Array.from(storageMap.values()).filter(
            item => item.totalPoi > 0 && item.availableFrames < item.totalPoi
        );

        // 2. Pending QA Audits
        const pendingAudits = dailyData.filter((item) => {
            const status = (item.qaqcStatus || '').toLowerCase();
            const publish = (item.publishToWebGIS || '').toLowerCase();
            return status.includes('pending') || publish === 'in process' || publish === 'need to recheck';
        });

        // 3. Flagged Optical & Positioning Defects
        const defectSubgridsMap = new Map<string, number>();
        dailyData.forEach((item) => {
            const sg = (item.subgrid || '').toUpperCase().trim();
            const defs = Number(item.imagesDefected || item.defectCount || 0);
            if (sg && defs > 0) {
                defectSubgridsMap.set(sg, (defectSubgridsMap.get(sg) || 0) + defs);
            }
        });

        const totalDefectFrames = Array.from(defectSubgridsMap.values()).reduce((a, b) => a + b, 0);

        // 4. Staged Daily Batches awaiting publication to WebGIS
        const stagingBatches = dailyData.filter((d) => {
            const pub = (d.publishToWebGIS || (d as any).publishToUSVPRO || '').toLowerCase();
            return pub !== 'yes' && pub !== 'published';
        });

        // Last worked subgrid bookmark
        const lastSubgrid = localStorage.getItem('geosphere360_last_active_subgrid') ||
            (dailyData.length > 0 ? dailyData[0].subgrid : null);

        const totalPendingItems = storageDiscrepancies.length + pendingAudits.length + (totalDefectFrames > 0 ? 1 : 0) + stagingBatches.length;

        return {
            storageDiscrepancies,
            pendingAudits,
            defectSubgridsCount: defectSubgridsMap.size,
            totalDefectFrames,
            stagingBatches,
            lastSubgrid,
            totalPendingItems
        };
    }, [dailyData, batchLogs]);

    if (!isOpen) return null;

    const todayFormatted = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(new Date());

    const operatorName = formatDisplayName(currentUser);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-fadeIn select-none font-sans">
            <div className="relative w-full max-w-4xl max-h-[92vh] bg-card border border-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden text-text-base transition-all">

                {/* 1. Header Section (Clean Monochrome Slate Foundation) */}
                <div className="p-5 border-b border-subtle flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-sm sm:text-base font-bold text-text-base flex items-center gap-2">
                            <Layers size={16} className="text-text-muted" />
                            <span>Daily Operations Briefing</span>
                        </h3>
                        <p className="text-xs text-text-muted mt-0.5">
                            Welcome back, <strong className="text-text-base font-semibold">{operatorName}</strong> &bull; Spatial trajectory tracking, photogrammetric QA, and storage health diagnostics.
                        </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-inner border border-subtle rounded-lg text-xs font-mono text-text-muted">
                            <Clock size={13} className="text-text-muted" />
                            <span>{todayFormatted}</span>
                        </div>
                        <button
                            onClick={handleDismiss}
                            className="text-text-muted hover:text-text-base p-1.5 rounded-lg hover:bg-inner transition-colors cursor-pointer"
                            title="Close Briefing"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* 2. Scrollable Body Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-5">

                    {/* Operational Telemetry Matrix (Uniform Calm KPI Cards) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">

                        {/* Storage Audit */}
                        <div className="p-4 rounded-xl border border-subtle bg-inner space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-400">Storage Audit (MMS_PIC)</span>
                                <span className={`w-2 h-2 rounded-full ${analysis.storageDiscrepancies.length > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                            </div>
                            <div className="text-2xl font-bold font-mono text-text-base">
                                {analysis.storageDiscrepancies.length}
                                <span className="text-xs font-normal text-text-muted ml-1">subgrids</span>
                            </div>
                            <p className="text-[10px] text-text-muted font-mono truncate">
                                {analysis.storageDiscrepancies.length > 0 ? 'Pending S3 frame uploads' : 'All S3 frames verified OK'}
                            </p>
                        </div>

                        {/* QA Conformance */}
                        <div className="p-4 rounded-xl border border-subtle bg-inner space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-400">QA Conformance</span>
                                <span className="w-2 h-2 rounded-full bg-slate-500" />
                            </div>
                            <div className="text-2xl font-bold font-mono text-text-base">
                                {analysis.pendingAudits.length}
                                <span className="text-xs font-normal text-text-muted ml-1">runs</span>
                            </div>
                            <p className="text-[10px] text-text-muted font-mono truncate">
                                Tenengrad inspection queued
                            </p>
                        </div>

                        {/* Optical Defects */}
                        <div className="p-4 rounded-xl border border-subtle bg-inner space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-400">Optical Defects</span>
                                <span className={`w-2 h-2 rounded-full ${analysis.totalDefectFrames > 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                            </div>
                            <div className="text-2xl font-bold font-mono text-text-base">
                                {analysis.totalDefectFrames}
                                <span className="text-xs font-normal text-text-muted ml-1">flags</span>
                            </div>
                            <p className="text-[10px] text-text-muted font-mono truncate">
                                Across {analysis.defectSubgridsCount} survey subgrids
                            </p>
                        </div>

                        {/* Staging Gate */}
                        <div className="p-4 rounded-xl border border-subtle bg-inner space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-medium text-slate-400">Staging Gate (PostGIS)</span>
                                <span className="w-2 h-2 rounded-full bg-slate-500" />
                            </div>
                            <div className="text-2xl font-bold font-mono text-text-base">
                                {analysis.stagingBatches.length}
                                <span className="text-xs font-normal text-text-muted ml-1">batches</span>
                            </div>
                            <p className="text-[10px] text-text-muted font-mono truncate">
                                Pending publish to WebGIS
                            </p>
                        </div>

                    </div>

                    {/* Action Items List Section */}
                    <div className="space-y-3 pt-1">
                        <div className="flex items-center justify-between pb-1">
                            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                                Prioritized Operational Action Items
                            </h4>
                            <span className="text-[11px] font-mono text-text-muted">
                                {analysis.totalPendingItems} active pipelines requiring review
                            </span>
                        </div>

                        <div className="space-y-2.5">

                            {/* Item 1: Resume Previous Session (IMPORTANT CONTENT: Primary Accent Highlight) */}
                            {analysis.lastSubgrid && (
                                <div className="p-4 rounded-xl border border-sky-500/40 bg-inner flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-sky-500/70 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-card border border-subtle flex items-center justify-center shrink-0 mt-0.5">
                                            <RotateCcw size={15} className="text-sky-400" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs font-bold text-text-base">
                                                    Resume Yesterday's Session ({analysis.lastSubgrid})
                                                </span>
                                                <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
                                                    Active Bookmark
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-text-muted font-mono">
                                                Jump directly into the 360° photogrammetric QA workspace at your saved inspection node.
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (onSelectSubgrid && analysis.lastSubgrid) onSelectSubgrid(analysis.lastSubgrid);
                                            if (onOpenQAQCWorkbench) onOpenQAQCWorkbench(analysis.lastSubgrid);
                                            onClose();
                                        }}
                                        className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all active:scale-95 shrink-0"
                                    >
                                        <span>Resume Inspection</span>
                                        <ArrowRight size={14} />
                                    </button>
                                </div>
                            )}

                            {/* Item 2: Storage Reconciliation */}
                            {analysis.storageDiscrepancies.length > 0 && (
                                <div className="p-4 rounded-xl border border-subtle bg-inner flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-card border border-subtle flex items-center justify-center shrink-0 mt-0.5">
                                            <HardDrive size={15} className="text-text-muted" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs font-bold text-text-base">
                                                    Incomplete S3 Storage Verification
                                                </span>
                                                <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-card border border-subtle text-slate-300 font-medium">
                                                    {analysis.storageDiscrepancies.length} subgrids
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-text-muted font-mono">
                                                {analysis.storageDiscrepancies.map(d => `${d.subgrid} (${d.availableFrames}/${d.totalPoi} frames)`).slice(0, 3).join(', ')}
                                                {analysis.storageDiscrepancies.length > 3 && ` +${analysis.storageDiscrepancies.length - 3} more`} require physical panorama uploads.
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (onOpenBatchProcessing) onOpenBatchProcessing();
                                            onClose();
                                        }}
                                        className="px-3.5 py-2 bg-inner hover:bg-slate-700 border border-subtle text-text-base rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-colors shrink-0"
                                    >
                                        <span>Reconcile Storage</span>
                                        <ExternalLink size={13} className="text-text-muted" />
                                    </button>
                                </div>
                            )}

                            {/* Item 3: Defect Remediation */}
                            {analysis.totalDefectFrames > 0 && (
                                <div className="p-4 rounded-xl border border-subtle bg-inner flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-card border border-subtle flex items-center justify-center shrink-0 mt-0.5">
                                            <ShieldAlert size={15} className="text-text-muted" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs font-bold text-text-base">
                                                    Flagged Defect Remediation
                                                </span>
                                                <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-card border border-subtle text-slate-300 font-medium">
                                                    {analysis.totalDefectFrames} flags
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-text-muted font-mono">
                                                Review motion blur, solar flare, and lens obstruction tags before signing off milestones.
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (onOpenDefectsGallery) onOpenDefectsGallery(analysis.lastSubgrid || undefined);
                                            onClose();
                                        }}
                                        className="px-3.5 py-2 bg-inner hover:bg-slate-700 border border-subtle text-text-base rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-colors shrink-0"
                                    >
                                        <span>Open Defect Gallery</span>
                                        <ExternalLink size={13} className="text-text-muted" />
                                    </button>
                                </div>
                            )}

                            {/* Item 4: Pending Automated QA Audits */}
                            {analysis.pendingAudits.length > 0 && (
                                <div className="p-4 rounded-xl border border-subtle bg-inner flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-slate-700 transition-colors">
                                    <div className="flex items-start gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-card border border-subtle flex items-center justify-center shrink-0 mt-0.5">
                                            <Play size={15} className="text-text-muted" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-xs font-bold text-text-base">
                                                    Trajectory QA Conformance Pipeline
                                                </span>
                                                <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-card border border-subtle text-slate-300 font-medium">
                                                    {analysis.pendingAudits.length} runs queued
                                                </span>
                                            </div>
                                            <p className="text-[11px] text-text-muted font-mono">
                                                Execute automated Tenengrad sharpness convolutions across newly ingested trajectory runs.
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (onOpenQAQCWorkbench) onOpenQAQCWorkbench(analysis.pendingAudits[0]?.subgrid);
                                            onClose();
                                        }}
                                        className="px-3.5 py-2 bg-inner hover:bg-slate-700 border border-subtle text-text-base rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-colors shrink-0"
                                    >
                                        <span>Launch QA Runner</span>
                                        <Play size={13} className="text-text-muted" />
                                    </button>
                                </div>
                            )}

                            {/* Clean Conformance State */}
                            {analysis.totalPendingItems === 0 && (
                                <div className="p-4 rounded-xl border border-subtle bg-inner flex items-center gap-3 text-emerald-400">
                                    <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                                    <div className="text-xs font-mono">
                                        <span className="font-bold text-text-base block">All Trajectories &amp; Subgrids are Fully Reconciled</span>
                                        <span className="text-text-muted text-[11px]">Zero storage discrepancies or unresolved defect flags detected.</span>
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>

                </div>

                {/* 3. Footer Controls */}
                <div className="p-4 border-t border-subtle flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                    <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={dontShowToday}
                            onChange={(e) => setDontShowToday(e.target.checked)}
                            className="rounded border-subtle bg-card text-sky-400 focus:ring-0 cursor-pointer"
                        />
                        <span>Don't show briefing automatically today</span>
                    </label>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                            onClick={handleDismiss}
                            className="w-full sm:w-auto px-4 py-2 bg-inner hover:bg-slate-700 border border-subtle text-text-base rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                        >
                            Dismiss Briefing
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
