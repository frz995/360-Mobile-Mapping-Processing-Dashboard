import React from 'react';

interface WorkflowNodeGraphProps {
    onJumpToModule?: (index: number) => void;
}

interface WorkflowStage {
    id: number;
    moduleIdx: number;
    title: string;
    items: string[];
    transferLabel?: string;
}

/**
 * Systems Architecture & Data Lifecycle Workflow Diagram.
 * 3 Top, 3 Bottom layout (6 modules):
 * Uses transparent card styling matching the showcase quick-jump tiles
 * (rounded-xl, border-white/[0.07], bg-white/[0.02]), with strictly uniform
 * box dimensions, centered connectors, and clear inter-tier flow.
 */
export const WorkflowNodeGraph: React.FC<WorkflowNodeGraphProps> = ({ onJumpToModule }) => {
    const stages: WorkflowStage[] = [
        {
            id: 1,
            moduleIdx: 0,
            title: '1. Project Setup & Field Capture',
            items: [
                'Regional boundary polygons & CRS projection',
                'Subgrid partitioning & survey area limits',
                'Equipment profile assignment (vehicle & backpack)',
                'Raw equirectangular 360° imagery & GNSS capture',
            ],
            transferLabel: 'Raw Telemetry & Spatial Bounds',
        },
        {
            id: 2,
            moduleIdx: 3,
            title: '2. Multi-Station Live Trace',
            items: [
                'End-to-end trace tracking (external pipeline)',
                'System monitors live tracking (no local processing)',
                'Station 1: Blur & Station 2: Stitch (PTGui Pro)',
                'Station 3: Lightroom & Station 4: Nadir Cap (PS)',
            ],
            transferLabel: 'Monitored 4-Station Datasets',
        },
        {
            id: 3,
            moduleIdx: 4,
            title: '3. NAS Storage & Telemetry',
            items: [
                'NAS working structure (/00_Raw to /05_Final)',
                'Real-time station daemon metrics (CPU/GPU/RAM)',
                'Directory capacity, volume health & integrity',
                'Offline failover & critical hardware alert triggers',
            ],
            transferLabel: 'Verified NAS 05_Final Datasets',
        },
        {
            id: 4,
            moduleIdx: 1,
            title: '4. WebGIS & Multi-Cloud Gates',
            items: [
                'Multi-provider cloud bucket storage (S3, Supabase)',
                'Cloud Bucket Gate & WebGIS Release Gate promotion',
                'MapLibre GL 3D vector engine & 360° HUD viewer',
                'Subgrid Masterlist reconciliation & Action Center',
            ],
            transferLabel: 'Published Trajectories & Panoramas',
        },
        {
            id: 5,
            moduleIdx: 2,
            title: '5. Road Analysis & Coverage Trace',
            items: [
                'GIS road network plan alignment & spatial chainage',
                'Buffer-based GPS trace pairing & coverage rate',
                'Street-by-street completion & gap/missed detection',
                'Spatial anomaly flags & survey re-run planning',
            ],
            transferLabel: 'Verified Road Coverage & Gap Audits',
        },
        {
            id: 6,
            moduleIdx: 5,
            title: '6. Analytics & Governance',
            items: [
                'Cross-project production velocity & KPI analytics',
                'Defect vs acceptance distribution metrics',
                'Automated executive reports & GIS spatial exports',
                'Role-based access control (RBAC) & audit log',
            ],
        },
    ];

    const renderCard = (stage: WorkflowStage) => {
        const isInteractive = typeof onJumpToModule === 'function';
        return (
            <div
                key={stage.id}
                role={isInteractive ? 'button' : undefined}
                tabIndex={isInteractive ? 0 : undefined}
                onClick={() => onJumpToModule?.(stage.moduleIdx)}
                onKeyDown={(e) => {
                    if (isInteractive && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onJumpToModule?.(stage.moduleIdx);
                    }
                }}
                className={`w-full h-full text-left rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20 p-4 sm:p-5 transition-all flex flex-col justify-between select-none min-h-[190px] sm:min-h-[200px] ${
                    isInteractive ? 'cursor-pointer active:scale-[0.99] group' : ''
                }`}
                title={isInteractive ? `Jump to Module: ${stage.title}` : undefined}
            >
                {/* Card Top: Header & Items */}
                <div className="flex flex-col h-full justify-between">
                    {/* Card Header with no truncation and uniform height */}
                    <div className="pb-2.5 mb-2.5 border-b border-white/[0.07] flex items-center justify-between gap-1.5 min-h-[34px]">
                        <span className="font-mono text-xs sm:text-[13px] font-semibold text-neutral-100 group-hover:text-sky-300 transition-colors leading-tight">
                            {stage.title}
                        </span>
                        {isInteractive && (
                            <span className="text-[10px] font-mono text-neutral-400 group-hover:text-sky-400 transition-colors shrink-0 opacity-80 group-hover:opacity-100 flex items-center gap-0.5 whitespace-nowrap">
                                Jump &rarr;
                            </span>
                        )}
                    </div>

                    {/* Card Body / Specification List */}
                    <div className="space-y-1.5 text-[11px] sm:text-[12px] font-mono text-neutral-300 leading-snug flex-1 flex flex-col justify-start">
                        {stage.items.map((item, i) => (
                            <div key={i} className="flex items-start gap-1.5">
                                <span className="text-neutral-500 shrink-0 select-none">-</span>
                                <span className="leading-tight">{item}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderHorizontalConnector = (label?: string) => (
        <div className="hidden lg:flex flex-col items-center justify-center shrink-0 px-2 sm:px-3 w-28 sm:w-32 text-center self-center">
            {/* Pure White Text with NO text box */}
            <span className="text-[10px] sm:text-[11px] font-mono text-white text-center leading-tight mb-1.5 select-none">
                {label}
            </span>
            <div className="flex items-center w-full">
                <div className="h-px w-full bg-white/25" />
                <div className="w-0 h-0 border-y-[3.5px] border-y-transparent border-l-[5px] border-l-white/60 shrink-0" />
            </div>
        </div>
    );

    const renderVerticalMobileConnector = (label?: string) => (
        <div className="flex lg:hidden flex-col items-center justify-center my-2 text-center">
            {/* Pure White Text with NO text box */}
            <span className="text-[10px] sm:text-[11px] font-mono text-white text-center mb-1">
                {label}
            </span>
            <div className="w-px h-3.5 bg-white/25" />
            <div className="w-0 h-0 border-x-[3.5px] border-x-transparent border-t-[5px] border-t-white/60" />
        </div>
    );

    return (
        <div className="w-full max-w-6xl mx-auto flex flex-col gap-2 sm:gap-3">
            {/* TOP TIER: Stages 01, 02, 03 */}
            <div className="flex flex-col lg:flex-row items-stretch w-full gap-2 lg:gap-0">
                {/* Stage 01 */}
                <div className="flex-1 flex flex-col min-w-0">
                    {renderCard(stages[0])}
                </div>

                {/* Connector between 01 and 02 */}
                {renderHorizontalConnector(stages[0].transferLabel)}
                {renderVerticalMobileConnector(stages[0].transferLabel)}

                {/* Stage 02 */}
                <div className="flex-1 flex flex-col min-w-0">
                    {renderCard(stages[1])}
                </div>

                {/* Connector between 02 and 03 */}
                {renderHorizontalConnector(stages[1].transferLabel)}
                {renderVerticalMobileConnector(stages[1].transferLabel)}

                {/* Stage 03 */}
                <div className="flex-1 flex flex-col min-w-0">
                    {renderCard(stages[2])}
                </div>
            </div>

            {/* Transition Connector between Top Tier and Bottom Tier (Stage 03 -> Stage 04) */}
            <div className="hidden lg:flex items-center justify-between w-full px-6 sm:px-10 py-2 sm:py-2.5">
                {/* Arrow pointing down into Stage 04 */}
                <div className="flex items-center gap-2">
                    <div className="flex flex-col items-center">
                        <div className="w-px h-4 bg-sky-400/80" />
                        <div className="w-0 h-0 border-x-[3.5px] border-x-transparent border-t-[5px] border-t-sky-400" />
                    </div>
                    <span className="text-[10.5px] font-mono text-sky-300 font-medium select-none">
                        Stage 04: Intake & WebGIS
                    </span>
                </div>

                {/* Middle Connecting Line & Transfer Badge */}
                <div className="flex items-center gap-3 flex-1 mx-6">
                    <div className="h-px flex-1 bg-gradient-to-r from-sky-400/40 via-white/20 to-white/10" />
                    <span className="text-[10px] sm:text-[11px] font-mono text-neutral-200 px-3 py-1 rounded-full border border-white/10 bg-white/[0.04] select-none whitespace-nowrap shadow-sm">
                        {stages[2].transferLabel}
                    </span>
                    <div className="h-px flex-1 bg-gradient-to-l from-white/30 via-white/20 to-white/10" />
                </div>

                {/* Exit indicator from Stage 03 */}
                <div className="flex items-center gap-2">
                    <span className="text-[10.5px] font-mono text-neutral-400 select-none">
                        From Stage 03
                    </span>
                    <div className="flex flex-col items-center">
                        <div className="w-px h-4 bg-white/40" />
                        <div className="w-0 h-0 border-x-[3.5px] border-x-transparent border-t-[5px] border-t-white/60" />
                    </div>
                </div>
            </div>

            {/* Mobile Vertical Transition Connector (between Stage 03 and Stage 04) */}
            {renderVerticalMobileConnector(stages[2].transferLabel)}

            {/* BOTTOM TIER: Stages 04, 05, 06 */}
            <div className="flex flex-col lg:flex-row items-stretch w-full gap-2 lg:gap-0">
                {/* Stage 04 */}
                <div className="flex-1 flex flex-col min-w-0">
                    {renderCard(stages[3])}
                </div>

                {/* Connector between 04 and 05 */}
                {renderHorizontalConnector(stages[3].transferLabel)}
                {renderVerticalMobileConnector(stages[3].transferLabel)}

                {/* Stage 05 */}
                <div className="flex-1 flex flex-col min-w-0">
                    {renderCard(stages[4])}
                </div>

                {/* Connector between 05 and 06 */}
                {renderHorizontalConnector(stages[4].transferLabel)}
                {renderVerticalMobileConnector(stages[4].transferLabel)}

                {/* Stage 06 */}
                <div className="flex-1 flex flex-col min-w-0">
                    {renderCard(stages[5])}
                </div>
            </div>
        </div>
    );
};
