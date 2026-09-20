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
 * Uses the exact transparent card styling matching the showcase quick-jump tiles
 * (rounded-xl, border-white/[0.07], bg-white/[0.02]), with no outer container box,
 * allowing the 3D globe to be clearly visible behind the cards.
 */
export const WorkflowNodeGraph: React.FC<WorkflowNodeGraphProps> = () => {
    const stages: WorkflowStage[] = [
        {
            id: 1,
            moduleIdx: 0,
            title: '1. Field Data Acquisition',
            items: [
                'MMS vehicle survey rig (360 array)',
                'MMS backpack mobile unit (GNSS/IMU)',
                'Raw equirectangular imagery & GNSS CSVs',
            ],
            transferLabel: 'Raw Imagery & GNSS CSVs',
        },
        {
            id: 2,
            moduleIdx: 2,
            title: '2. On-Premises GPU Worker',
            items: [
                'FastAPI daemon + PyTorch / YOLOv8',
                'Face & license plate blurring',
                'Nadir vehicle & tripod masking',
                'Photogrammetric CLAHE & WebGL tiling',
            ],
            transferLabel: 'Blurred & Tiled Cubemaps',
        },
        {
            id: 3,
            moduleIdx: 5,
            title: '3. Cloud Database & Storage',
            items: [
                'PostgreSQL 15 + PostGIS 3.3 (Supabase)',
                'Ingestion to staging_panoramas',
                'Spatial validation & GPS sanitization',
                'Object storage sync (/MMS_PIC/ bucket)',
            ],
            transferLabel: 'staging_panoramas Records & Storage URIs',
        },
        {
            id: 4,
            moduleIdx: 1,
            title: '4. Quality Assurance (QA/QC)',
            items: [
                'PhotoSphereViewer v5 WebGL inspector',
                'Frame-by-frame visual defect audit',
                'Tenengrad edge sharpness thresholding',
                'Approval gate: Promotion to public',
            ],
            transferLabel: 'Approved Panoramas',
        },
        {
            id: 5,
            moduleIdx: 4,
            title: '5. Published WebGIS',
            items: [
                'Leaflet & MapLibre GL workspace',
                'Spatial trajectory & heading alignment',
                'Vector layers: Shapefile, GeoJSON, KML',
                'Road snapping & pavement distress analysis',
            ],
            transferLabel: 'Spatial Layers & BBOX Extents',
        },
        {
            id: 6,
            moduleIdx: 5,
            title: '6. Data Management & Delivery',
            items: [
                'Project datasets & ledger maintenance',
                'NAS drive (/RAW/, /BLURRED/) reconciliation',
                'Subgrid masterlist & daily run aggregation',
                'BBOX GIS exports & client deliverables',
            ],
        },
    ];

    const renderCard = (stage: WorkflowStage) => {
        return (
            <div
                key={stage.id}
                className="w-full text-left rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04] p-4 sm:p-5 transition-colors flex flex-col justify-between select-none"
            >
                {/* Card Header */}
                <div className="pb-2.5 mb-2.5 border-b border-white/[0.07]">
                    <span className="font-mono text-xs sm:text-[13px] font-semibold text-neutral-100 block truncate">
                        {stage.title}
                    </span>
                </div>

                {/* Card Body / Specification List */}
                <div className="space-y-1.5 text-[11px] sm:text-[12px] font-mono text-neutral-300 leading-snug min-h-[85px] sm:min-h-[95px] flex flex-col justify-start">
                    {stage.items.map((item, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                            <span className="text-neutral-500 shrink-0 select-none">-</span>
                            <span>{item}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderHorizontalConnector = (label?: string) => (
        <div className="hidden lg:flex flex-col items-center justify-center shrink-0 px-2.5 w-28 sm:w-32 text-center">
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
        <div className="w-full max-w-6xl mx-auto flex flex-col gap-3.5 sm:gap-4">
            {/* TOP TIER: Stages 01, 02, 03 */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center w-full">
                {/* Stage 01 */}
                <div className="flex-1 flex flex-col">
                    {renderCard(stages[0])}
                </div>

                {/* Connector between 01 and 02 */}
                {renderHorizontalConnector(stages[0].transferLabel)}
                {renderVerticalMobileConnector(stages[0].transferLabel)}

                {/* Stage 02 */}
                <div className="flex-1 flex flex-col">
                    {renderCard(stages[1])}
                </div>

                {/* Connector between 02 and 03 */}
                {renderHorizontalConnector(stages[1].transferLabel)}
                {renderVerticalMobileConnector(stages[1].transferLabel)}

                {/* Stage 03 */}
                <div className="flex-1 flex flex-col">
                    {renderCard(stages[2])}
                </div>
            </div>

            {/* Transition Connector between Top Tier and Bottom Tier (Stage 03 -> Stage 04) */}
            <div className="flex items-center justify-center lg:justify-end lg:pr-14 py-1.5 sm:py-2">
                <div className="flex items-center gap-2">
                    {/* Pure White Text with NO text box */}
                    <span className="text-[10.5px] sm:text-[11px] font-mono text-white text-center">
                        {stages[2].transferLabel}
                    </span>
                    {/* Downward Direction Arrow */}
                    <div className="flex flex-col items-center">
                        <div className="w-px h-3.5 bg-white/25" />
                        <div className="w-0 h-0 border-x-[3.5px] border-x-transparent border-t-[5px] border-t-white/60" />
                    </div>
                </div>
            </div>

            {/* BOTTOM TIER: Stages 04, 05, 06 */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center w-full">
                {/* Stage 04 */}
                <div className="flex-1 flex flex-col">
                    {renderCard(stages[3])}
                </div>

                {/* Connector between 04 and 05 */}
                {renderHorizontalConnector(stages[3].transferLabel)}
                {renderVerticalMobileConnector(stages[3].transferLabel)}

                {/* Stage 05 */}
                <div className="flex-1 flex flex-col">
                    {renderCard(stages[4])}
                </div>

                {/* Connector between 05 and 06 */}
                {renderHorizontalConnector(stages[4].transferLabel)}
                {renderVerticalMobileConnector(stages[4].transferLabel)}

                {/* Stage 06 */}
                <div className="flex-1 flex flex-col">
                    {renderCard(stages[5])}
                </div>
            </div>
        </div>
    );
};
