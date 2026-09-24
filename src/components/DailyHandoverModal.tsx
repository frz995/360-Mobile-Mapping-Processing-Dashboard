import React, { useState, useMemo } from 'react';
import {
    Clock,
    X,
    ArrowRight,
    CheckCircle2,
    ClipboardList,
    Bookmark,
    HardDrive,
    Flag,
    ScanLine,
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

// Clean helper to format a username (e.g. "ali.bin" -> "Ali Bin")
function formatDisplayName(rawName?: string): string {
    if (!rawName) return 'Operations Engineer';
    const base = rawName.split('@')[0];
    const parts = base.replace(/[0-9]/g, '').split(/[._-]/).filter(Boolean);
    if (parts.length === 0) return base;
    return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

interface BriefingItemProps {
    icon: React.ReactNode;
    title: string;
    badge?: string;
    description: string;
    actionLabel: string;
    onAction: () => void;
}

const BriefingItem: React.FC<BriefingItemProps> = ({
    icon,
    title,
    badge,
    description,
    actionLabel,
    onAction
}) => (
    <div className="p-3.5 flex items-center gap-3 transition-colors hover:bg-card">
        <div className="hidden sm:flex w-8 h-8 rounded-lg bg-inner border border-subtle items-center justify-center text-text-muted shrink-0">
            {icon}
        </div>
        <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs font-semibold text-text-base">{title}</span>
                {badge && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md border border-subtle bg-app text-text-muted whitespace-nowrap">
                        {badge}
                    </span>
                )}
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">{description}</p>
        </div>
        <button
            onClick={onAction}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-subtle bg-app hover:bg-inner text-text-base text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
        >
            <span>{actionLabel}</span>
            <ArrowRight size={13} className="text-text-muted" />
        </button>
    </div>
);

export const DailyHandoverModal: React.FC<DailyHandoverModalProps> = ({
    isOpen,
    onClose,
    dailyData = [],
    batchLogs = [],
    currentUser = 'Operator',
    onSelectSubgrid,
    onOpenQAQCWorkbench,
    onOpenDefectsGallery,
    onOpenBatchProcessing
}) => {
    const [dontShowAgainToday, setDontShowAgainToday] = useState(false);

    // Save dismissal preference: if ticked, suppress for today; resets day by day
    const handleDismiss = () => {
        if (dontShowAgainToday) {
            const todayStr = new Date().toISOString().slice(0, 10);
            localStorage.setItem('geosphere360_briefing_suppressed_date', todayStr);
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

    const kpis = [
        {
            label: 'Storage',
            icon: HardDrive,
            value: analysis.storageDiscrepancies.length > 0
                ? plural(analysis.storageDiscrepancies.length, 'subgrid')
                : 'All clear',
            sub: analysis.storageDiscrepancies.length > 0 ? 'pending upload' : 'fully reconciled'
        },
        {
            label: 'QA Conformance',
            icon: ScanLine,
            value: plural(analysis.pendingAudits.length, 'run'),
            sub: analysis.pendingAudits.length > 0 ? 'queued for audit' : 'all audits passed'
        },
        {
            label: 'Defects',
            icon: Flag,
            value: plural(analysis.totalDefectFrames, 'flag'),
            sub: analysis.defectSubgridsCount > 0
                ? `${plural(analysis.defectSubgridsCount, 'subgrid')} affected`
                : 'none flagged'
        },
        {
            label: 'Staging',
            icon: Layers,
            value: plural(analysis.stagingBatches.length, 'batch'),
            sub: 'awaiting WebGIS publish'
        }
    ];

    const briefingItems = [
        analysis.lastSubgrid && {
            key: 'resume-session',
            icon: <Bookmark size={14} />,
            title: `Resume Yesterday's Session (${analysis.lastSubgrid})`,
            badge: 'Active Bookmark',
            description: 'Jump directly into the 360° photogrammetric QA workspace at your saved inspection node.',
            actionLabel: 'Resume Inspection',
            onAction: () => {
                if (onSelectSubgrid && analysis.lastSubgrid) onSelectSubgrid(analysis.lastSubgrid);
                if (onOpenQAQCWorkbench) onOpenQAQCWorkbench(analysis.lastSubgrid);
                onClose();
            }
        },
        analysis.storageDiscrepancies.length > 0 && {
            key: 'storage-reconcile',
            icon: <HardDrive size={14} />,
            title: 'Storage Verification Discrepancy',
            badge: plural(analysis.storageDiscrepancies.length, 'subgrid'),
            description: `${analysis.storageDiscrepancies
                .map(d => `${d.subgrid} (${d.availableFrames}/${d.totalPoi} frames)`)
                .slice(0, 3)
                .join(', ')}${analysis.storageDiscrepancies.length > 3 ? ` +${analysis.storageDiscrepancies.length - 3} more` : ''} require physical panorama uploads.`,
            actionLabel: 'Reconcile Storage',
            onAction: () => {
                if (onOpenBatchProcessing) onOpenBatchProcessing();
                onClose();
            }
        },
        analysis.totalDefectFrames > 0 && {
            key: 'defect-remediation',
            icon: <Flag size={14} />,
            title: 'Flagged Defect Remediation',
            badge: plural(analysis.totalDefectFrames, 'flag'),
            description: 'Review motion blur, solar flare, and lens obstruction tags before signing off milestones.',
            actionLabel: 'Open Defect Gallery',
            onAction: () => {
                if (onOpenDefectsGallery) onOpenDefectsGallery(analysis.lastSubgrid || undefined);
                onClose();
            }
        },
        analysis.pendingAudits.length > 0 && {
            key: 'qa-conformance',
            icon: <ScanLine size={14} />,
            title: 'Trajectory QA Conformance Pipeline',
            badge: `${analysis.pendingAudits.length} queued`,
            description: 'Execute automated Tenengrad sharpness convolutions across newly ingested trajectory runs.',
            actionLabel: 'Launch QA Runner',
            onAction: () => {
                if (onOpenQAQCWorkbench) onOpenQAQCWorkbench(analysis.pendingAudits[0]?.subgrid);
                onClose();
            }
        }
    ].filter(Boolean) as Array<BriefingItemProps & { key: string }>;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fadeIn select-none font-sans">
            <div className="relative w-full max-w-3xl max-h-[82vh] sm:max-h-[90vh] bg-card border border-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden text-text-base transition-all">

                {/* 1. Header Section */}
                <div className="px-4 py-3.5 sm:px-5 sm:py-4 border-b border-subtle flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="hidden sm:flex w-8 h-8 rounded-lg bg-inner border border-subtle items-center justify-center shrink-0">
                            <ClipboardList size={15} className="text-text-muted" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-sm sm:text-base font-bold text-text-base leading-tight">
                                Daily Operations Briefing
                            </h3>
                            <p className="text-[11px] sm:text-xs text-text-muted mt-0.5 truncate">
                                Operator: <span className="text-text-base font-medium">{operatorName}</span> &bull; Photogrammetric processing &amp; pipeline diagnostics
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                        <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-inner border border-subtle rounded-lg text-xs text-text-muted">
                            <Clock size={12} />
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
                <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">

                    {/* Operational Telemetry Summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
                        {kpis.map((kpi) => (
                            <div key={kpi.label} className="bg-inner border border-subtle rounded-xl px-3 py-2.5 min-w-0">
                                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                                    <kpi.icon size={11} className="shrink-0" />
                                    <span className="truncate">{kpi.label}</span>
                                </div>
                                <div className="mt-1.5 text-sm font-bold text-text-base truncate" title={kpi.value}>
                                    {kpi.value}
                                </div>
                                <div className="text-[10px] text-text-muted truncate">{kpi.sub}</div>
                            </div>
                        ))}
                    </div>

                    {/* Action Items List Section */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between px-0.5">
                            <h4 className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                                Prioritized Operational Action Items
                            </h4>
                            <span className="text-xs text-text-muted whitespace-nowrap">
                                {analysis.totalPendingItems} requiring review
                            </span>
                        </div>

                        <div className="border border-subtle rounded-xl overflow-hidden divide-y divide-subtle">

                            {briefingItems.map((item) => (
                                <BriefingItem
                                    key={item.key}
                                    icon={item.icon}
                                    title={item.title}
                                    badge={item.badge}
                                    description={item.description}
                                    actionLabel={item.actionLabel}
                                    onAction={item.onAction}
                                />
                            ))}

                            {/* Clean Conformance State */}
                            {briefingItems.length === 0 && (
                                <div className="p-3.5 flex items-center gap-3">
                                    <div className="hidden sm:flex w-8 h-8 rounded-lg bg-inner border border-subtle items-center justify-center shrink-0">
                                        <CheckCircle2 size={14} className="text-text-muted" />
                                    </div>
                                    <div className="min-w-0">
                                        <span className="text-xs font-semibold text-text-base block">
                                            All Trajectories &amp; Subgrids are Fully Reconciled
                                        </span>
                                        <span className="text-[11px] text-text-muted">
                                            Zero storage discrepancies or unresolved defect flags detected.
                                        </span>
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>

                </div>

                {/* 3. Footer Controls */}
                <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-t border-subtle flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                    <label className="flex items-center gap-2 text-xs text-text-muted hover:text-text-base cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={dontShowAgainToday}
                            onChange={(e) => setDontShowAgainToday(e.target.checked)}
                            className="h-3.5 w-3.5 rounded border-subtle bg-inner accent-accent focus:ring-0 cursor-pointer"
                        />
                        <span>Don't show again today</span>
                    </label>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                            onClick={handleDismiss}
                            className="w-full sm:w-auto px-4 py-1.5 rounded-lg border border-subtle bg-app hover:bg-inner text-text-base text-xs font-medium transition-colors cursor-pointer"
                        >
                            Dismiss Briefing
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
