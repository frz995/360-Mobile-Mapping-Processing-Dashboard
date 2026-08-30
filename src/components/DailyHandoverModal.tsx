import React, { useState, useMemo } from 'react';
import {
    Clock,
    X,
    ArrowRight,
    CheckCircle2
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
            <div className="relative w-full max-w-3xl max-h-[90vh] bg-card border border-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden text-text-base transition-all">

                {/* 1. Header Section */}
                <div className="px-5 py-4 border-b border-subtle flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="text-sm sm:text-base font-bold text-text-base">
                            Daily Operations Briefing
                        </h3>
                        <p className="text-xs text-text-muted mt-0.5">
                            Operator: <span className="text-text-base font-medium">{operatorName}</span> &bull; Photogrammetric processing &amp; pipeline diagnostics
                        </p>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-inner border border-subtle rounded-lg text-xs text-text-muted">
                            <Clock size={12} className="text-text-muted" />
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
                <div className="flex-1 overflow-y-auto p-5 space-y-4">

                    {/* Operational Telemetry Summary Bar */}
                    <div className="bg-inner border border-subtle rounded-xl p-3 text-xs flex flex-wrap items-center justify-between gap-y-2 gap-x-4">
                        <div className="flex items-center gap-2">
                            <span className="text-text-muted font-medium">Storage:</span>
                            <span className="font-semibold text-text-base">
                                {analysis.storageDiscrepancies.length > 0 ? `${analysis.storageDiscrepancies.length} subgrids pending upload` : 'All verified OK'}
                            </span>
                        </div>
                        <div className="hidden md:block text-text-muted">&bull;</div>
                        <div className="flex items-center gap-2">
                            <span className="text-text-muted font-medium">QA Conformance:</span>
                            <span className="font-semibold text-text-base">
                                {analysis.pendingAudits.length} runs queued
                            </span>
                        </div>
                        <div className="hidden md:block text-text-muted">&bull;</div>
                        <div className="flex items-center gap-2">
                            <span className="text-text-muted font-medium">Defects:</span>
                            <span className="font-semibold text-text-base">
                                {analysis.totalDefectFrames} flags ({analysis.defectSubgridsCount} subgrids)
                            </span>
                        </div>
                        <div className="hidden md:block text-text-muted">&bull;</div>
                        <div className="flex items-center gap-2">
                            <span className="text-text-muted font-medium">Staging:</span>
                            <span className="font-semibold text-text-base">
                                {analysis.stagingBatches.length} batches pending
                            </span>
                        </div>
                    </div>

                    {/* Action Items List Section */}
                    <div className="space-y-2.5 pt-1">
                        <div className="flex items-center justify-between pb-0.5">
                            <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                                Prioritized Operational Action Items
                            </h4>
                            <span className="text-xs text-text-muted">
                                {analysis.totalPendingItems} items requiring review
                            </span>
                        </div>

                        <div className="divide-y divide-subtle border border-subtle rounded-xl overflow-hidden bg-inner/40">

                            {/* Item 1: Resume Previous Session */}
                            {analysis.lastSubgrid && (
                                <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-inner/70 transition-colors">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-text-base">
                                                Resume Yesterday's Session ({analysis.lastSubgrid})
                                            </span>
                                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-inner border border-subtle text-text-muted font-medium">
                                                Active Bookmark
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-text-muted">
                                            Jump directly into the 360° photogrammetric QA workspace at your saved inspection node.
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (onSelectSubgrid && analysis.lastSubgrid) onSelectSubgrid(analysis.lastSubgrid);
                                            if (onOpenQAQCWorkbench) onOpenQAQCWorkbench(analysis.lastSubgrid);
                                            onClose();
                                        }}
                                        className="px-3.5 py-1.5 bg-card hover:bg-inner border border-subtle text-text-base rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-all shrink-0"
                                    >
                                        <span>Resume Inspection</span>
                                        <ArrowRight size={13} className="text-text-muted" />
                                    </button>
                                </div>
                            )}

                            {/* Item 2: Storage Reconciliation */}
                            {analysis.storageDiscrepancies.length > 0 && (
                                <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-inner/70 transition-colors">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-text-base">
                                                Storage Verification Discrepancy
                                            </span>
                                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-inner border border-subtle text-text-muted font-medium">
                                                {analysis.storageDiscrepancies.length} subgrids
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-text-muted">
                                            {analysis.storageDiscrepancies.map(d => `${d.subgrid} (${d.availableFrames}/${d.totalPoi} frames)`).slice(0, 3).join(', ')}
                                            {analysis.storageDiscrepancies.length > 3 && ` +${analysis.storageDiscrepancies.length - 3} more`} require physical panorama uploads.
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (onOpenBatchProcessing) onOpenBatchProcessing();
                                            onClose();
                                        }}
                                        className="px-3.5 py-1.5 bg-card hover:bg-inner border border-subtle text-text-base rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-colors shrink-0"
                                    >
                                        <span>Reconcile Storage</span>
                                        <ArrowRight size={13} className="text-text-muted" />
                                    </button>
                                </div>
                            )}

                            {/* Item 3: Defect Remediation */}
                            {analysis.totalDefectFrames > 0 && (
                                <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-inner/70 transition-colors">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-text-base">
                                                Flagged Defect Remediation
                                            </span>
                                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-inner border border-subtle text-text-muted font-medium">
                                                {analysis.totalDefectFrames} flags
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-text-muted">
                                            Review motion blur, solar flare, and lens obstruction tags before signing off milestones.
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (onOpenDefectsGallery) onOpenDefectsGallery(analysis.lastSubgrid || undefined);
                                            onClose();
                                        }}
                                        className="px-3.5 py-1.5 bg-card hover:bg-inner border border-subtle text-text-base rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-colors shrink-0"
                                    >
                                        <span>Open Defect Gallery</span>
                                        <ArrowRight size={13} className="text-text-muted" />
                                    </button>
                                </div>
                            )}

                            {/* Item 4: Pending Automated QA Audits */}
                            {analysis.pendingAudits.length > 0 && (
                                <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-inner/70 transition-colors">
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-text-base">
                                                Trajectory QA Conformance Pipeline
                                            </span>
                                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-inner border border-subtle text-text-muted font-medium">
                                                {analysis.pendingAudits.length} queued
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-text-muted">
                                            Execute automated Tenengrad sharpness convolutions across newly ingested trajectory runs.
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            if (onOpenQAQCWorkbench) onOpenQAQCWorkbench(analysis.pendingAudits[0]?.subgrid);
                                            onClose();
                                        }}
                                        className="px-3.5 py-1.5 bg-card hover:bg-inner border border-subtle text-text-base rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-colors shrink-0"
                                    >
                                        <span>Launch QA Runner</span>
                                        <ArrowRight size={13} className="text-text-muted" />
                                    </button>
                                </div>
                            )}

                            {/* Clean Conformance State */}
                            {analysis.totalPendingItems === 0 && (
                                <div className="p-3.5 flex items-center gap-2.5 text-text-base text-xs">
                                    <CheckCircle2 size={16} className="text-text-muted shrink-0" />
                                    <div>
                                        <span className="font-semibold block">All Trajectories &amp; Subgrids are Fully Reconciled</span>
                                        <span className="text-text-muted text-[11px]">Zero storage discrepancies or unresolved defect flags detected.</span>
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>

                </div>

                {/* 3. Footer Controls */}
                <div className="px-5 py-3.5 border-t border-subtle flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                    <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={dontShowToday}
                            onChange={(e) => setDontShowToday(e.target.checked)}
                            className="rounded border-subtle bg-card text-text-base focus:ring-0 cursor-pointer"
                        />
                        <span>Don't show briefing automatically today</span>
                    </label>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                            onClick={handleDismiss}
                            className="w-full sm:w-auto px-4 py-1.5 bg-inner hover:bg-card border border-subtle text-text-base rounded-lg text-xs font-medium transition-colors cursor-pointer"
                        >
                            Dismiss Briefing
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
