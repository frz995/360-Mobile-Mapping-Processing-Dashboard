import type React from 'react';

export interface SectionHotspot {
    id: string;
    x: number; // percentage (0 - 100)
    y: number; // percentage (0 - 100)
    title: string;
    tag: string;
    description: string;
    tip: string;
    stepNumber?: number;
}

export interface WorkflowStep {
    step: string;
    action: string;
}

export interface SystemModule {
    id: string;
    category: string;
    title: string;
    subtitle: string;
    description: string;
    metricLabel: string;
    metricValue: string;
    statusBadge: string;
    images: string[];
    icon: React.ElementType;
    /** Optional raster module icon (favored over `icon` when set). */
    iconImage?: string;
    workflow: WorkflowStep[];
    specs: { label: string; value: string }[];
    hotspots: SectionHotspot[];
}
