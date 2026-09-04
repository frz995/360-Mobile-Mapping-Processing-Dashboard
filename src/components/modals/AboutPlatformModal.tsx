import React from 'react';
import { Info, X } from 'lucide-react';

export interface AboutPlatformModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectSettings?: any;
}

export const AboutPlatformModal: React.FC<AboutPlatformModalProps> = ({
  isOpen,
  onClose,
  projectSettings
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 top-0 left-0 right-0 bottom-0 w-full h-full bg-app backdrop-blur-md z-[99999] flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-card border border-subtle rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col overflow-hidden text-text-base">

        {/* Modal Header */}
        <div className="p-5 bg-card border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-inner border border-subtle text-text-base shadow-sm">
              <Info size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-base tracking-wide">
                Mobile Mapping Data Management System
              </h2>
              <p className="text-xs text-sky-400 font-medium">
                Spatial Trajectory Processing &amp; Quality Assurance Pipeline
              </p>
              <p className="text-[11px] text-text-muted font-sans mt-0.5">
                Version 2.4.0 (Executive Enterprise Build)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-base p-1.5 rounded-lg hover:bg-inner transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="p-6 space-y-5 text-xs text-text-base leading-relaxed overflow-y-auto max-h-[75vh]">

          {/* 1. System Purpose & Domain Overview */}
          <div className="p-4 rounded-xl bg-card border border-subtle space-y-2">
            <h3 className="font-bold text-text-base text-xs uppercase tracking-wider flex items-center gap-2">
              <span>System Purpose &amp; Domain Architecture</span>
            </h3>
            <p className="text-text-base text-[11.5px] leading-relaxed">
              Engineered specifically for <strong>TNB 360° Mobile Mapping Operations</strong>, this WebGIS processing platform provides unified spatial trajectory analytics, automated subgrid deduplication, live Supabase PostGIS synchronization, and interactive 360° StreetView quality control inspection.
            </p>
            <p className="text-text-base text-[11.5px] leading-relaxed">
              The platform runs on <strong>two tracks</strong>: the <strong>WebGIS · Published View</strong> (what TNB sees live on the map — the dashboard, published panoramas, survey analytics and reports) and the <strong>Production Pipeline</strong> (the internal processing that builds it — RAW intake → blur → stitch → enhance → mask → acceptance QA → deliverable pack → published to WebGIS). Operators work in the Production Pipeline; the WebGIS view is the public, published result.
            </p>
          </div>

          {/* 2. Technical Specifications & GIS Core */}
          <div className="space-y-2">
            <h4 className="font-bold text-text-base text-xs uppercase tracking-wider">
              Technical Specifications &amp; GIS Core
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-sans text-[11px]">
              <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                <span className="text-text-muted block text-[10px] uppercase">GIS Mapping Engine</span>
                <span className="text-text-base font-bold">PostGIS 3.4 + Leaflet 1.9 + WebGL</span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                <span className="text-text-muted block text-[10px] uppercase">Database Architecture</span>
                <span className="text-text-base font-bold">Supabase PostgreSQL (Realtime Listener)</span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                <span className="text-text-muted block text-[10px] uppercase">Coordinate Reference Systems</span>
                <span className="text-text-base font-bold">EPSG:4326, 3857, 3375 (Kertau RSO)</span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                <span className="text-text-muted block text-[10px] uppercase">360° Inspection Engine</span>
                <span className="text-text-base font-bold">
                  {projectSettings?.useMultiRes
                    ? 'PhotoSphereViewer (Multi-Res Tile Engine)'
                    : 'PhotoSphereViewer (Equirectangular)'}
                </span>
                <span className="text-text-muted text-[9px] font-sans">
                  {projectSettings?.storageProvider?.toUpperCase() || 'DYNAMIC'} · {projectSettings?.imageStorageStrategy || 'single_equirectangular'}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Core Workflow Capabilities */}
          <div className="space-y-2.5">
            <h4 className="font-bold text-text-base text-xs uppercase tracking-wider">
              Core Workflow Capabilities &amp; Features
            </h4>
            <div className="space-y-2 text-text-base text-[11.5px] leading-relaxed">
              <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                <div className="font-bold text-text-base">1. Subgrid Trajectory Deduplication Strategy</div>
                <p className="text-text-muted text-[11px]">
                  Auto-normalizes subgrid keys (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">XX-YY &rarr; XXYY</code>). Offers choice between Masterlist clean merge or preserved daily survey runs.
                </p>
              </div>

              <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                <div className="font-bold text-text-base">2. Interactive 360° QA Inspector &amp; SLA Benchmarks</div>
                <p className="text-text-muted text-[11px]">
                  Supports AI defect threshold benchmarks (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">95%, 85%, 75%, 60%</code>) with custom flag labels (<code className="bg-inner px-1 py-0.5 rounded text-text-base font-sans text-[10px]">Blurry Frame, Lens Obstruction, Bad GPS</code>).
                </p>
              </div>

              <div className="p-3 rounded-xl bg-card border border-subtle space-y-1">
                <div className="font-bold text-text-base">3. Executive PDF Summary Report Generator</div>
                <p className="text-text-muted text-[11px]">
                  Generates client-ready QA PDF deliverables with automated pass/fail calculations and survey metrics.
                </p>
              </div>
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-card border-t border-subtle flex justify-between items-center text-[11px] text-text-muted shrink-0 font-sans">
          <span>© 2026 Mobile Mapping Data Management System</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-inner hover:bg-inner text-text-base font-medium rounded-lg border border-subtle transition-all cursor-pointer shadow-sm"
          >
            Close System Info
          </button>
        </div>

      </div>
    </div>
  );
};
