import React, { useState } from 'react';
import {
  Globe,
  Copy,
  Check,
  FileSpreadsheet,
  Terminal,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  HardDrive
} from 'lucide-react';
import type { SubgridLifecycleStatus } from '../../utils/dataLifecycle';
import { generateUploadScript } from '../../utils/dataLifecycle';

interface WebGISHandoffCardProps {
  lifecycle: SubgridLifecycleStatus;
  bucketName?: string;
  onNavigateToDataManagement?: (subgrid: string) => void;
  onDirectUploadImages?: (files: FileList | File[]) => void;
}

export const WebGISHandoffCard: React.FC<WebGISHandoffCardProps> = ({
  lifecycle,
  bucketName = 'MMS_PIC',
  onNavigateToDataManagement
}) => {
  const [copied, setCopied] = useState(false);
  const [scriptType, setScriptType] = useState<'r2' | 's3' | 'supabase'>('r2');

  const { subgrid, stageMeta, handoffGuidance, bucketImages, deliverableDataset, publishedPoints } = lifecycle;
  const totalImages = deliverableDataset?.file_count || lifecycle.rawFrames || 0;
  const isBucketSynced = totalImages > 0 && bucketImages >= totalImages;

  const currentScript = generateUploadScript(
    subgrid,
    handoffGuidance.nasFolder,
    scriptType,
    bucketName.toLowerCase()
  );

  const handleCopyScript = () => {
    navigator.clipboard.writeText(currentScript);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="bg-card border border-subtle rounded-2xl p-5 shadow-lg flex flex-col gap-4 transition-all">
      {/* Header with Lifecycle Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
            <Globe size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-text-base">
                WebGIS Handoff Pipeline • <span className="font-mono text-sky-400">{subgrid}</span>
              </h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${stageMeta.color.badgeClass}`}>
                {stageMeta.shortLabel}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Production complete on NAS. Follow the 3-step handoff to publish to live WebGIS map.
            </p>
          </div>
        </div>

        {publishedPoints > 0 ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20">
            <CheckCircle2 size={14} />
            Live in WebGIS ({publishedPoints} points)
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted bg-inner px-2.5 py-1 rounded-lg border border-subtle">
            <HardDrive size={13} className="text-sky-400" />
            NAS: {handoffGuidance.nasFolder}
          </span>
        )}
      </div>

      {/* 3-Step Procedure */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* STEP 1: Bucket Image Sync */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${isBucketSynced ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-inner/50 border-subtle'}`}>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-sky-400">Step 1</span>
              {isBucketSynced ? (
                <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Synced
                </span>
              ) : (
                <span className="text-[11px] text-amber-400 font-medium flex items-center gap-1">
                  <AlertCircle size={12} /> Pending Upload
                </span>
              )}
            </div>
            <h4 className="text-xs font-bold text-text-base">Upload Images to Bucket</h4>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Transfer master 360 equirectangular images from local NAS to cloud object bucket ({bucketName}).
            </p>
          </div>

          <div className="pt-2 border-t border-subtle flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">Bucket Verification:</span>
              <span className="font-mono font-bold text-text-base">
                {bucketImages} / {totalImages > 0 ? totalImages : '—'} images
              </span>
            </div>
          </div>
        </div>

        {/* STEP 2: Trajectory CSV */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${handoffGuidance.csvReady ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-inner/50 border-subtle'}`}>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-sky-400">Step 2</span>
              {handoffGuidance.csvReady ? (
                <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> CSV Staged
                </span>
              ) : (
                <span className="text-[11px] text-amber-400 font-medium flex items-center gap-1">
                  <AlertCircle size={12} /> Awaiting CSV
                </span>
              )}
            </div>
            <h4 className="text-xs font-bold text-text-base">Ingest Trajectory CSV</h4>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Import GPS camera coordinates (lat, lon, heading/bearing) in WebGIS Data Management.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigateToDataManagement?.(subgrid)}
            className="w-full py-1.5 px-3 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
          >
            <FileSpreadsheet size={13} />
            <span>Open Data Management</span>
            <ChevronRight size={13} />
          </button>
        </div>

        {/* STEP 3: Publish to WebGIS */}
        <div className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${publishedPoints > 0 ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-inner/50 border-subtle'}`}>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wider uppercase text-sky-400">Step 3</span>
              {publishedPoints > 0 ? (
                <span className="text-[11px] font-bold text-cyan-400 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Published
                </span>
              ) : (
                <span className="text-[11px] text-text-muted font-medium">Ready when 1 & 2 done</span>
              )}
            </div>
            <h4 className="text-xs font-bold text-text-base">Publish Live on Map</h4>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Verify 100% storage match between CSV trajectory and cloud bucket, then commit to live map.
            </p>
          </div>

          {publishedPoints > 0 ? (
            <div className="text-[11px] text-cyan-400 font-medium flex items-center gap-1">
              <Check size={12} /> Active in WebGIS PostGIS DB
            </div>
          ) : (
            <div className="text-[11px] text-text-muted">
              Click Publish inside Data Management
            </div>
          )}
        </div>
      </div>

      {/* Recommended Sync Command Box */}
      <div className="bg-inner/60 border border-subtle rounded-xl p-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-sky-400" />
            <span className="text-xs font-bold text-text-base">Fast NAS-to-Bucket Sync Command</span>
            <span className="text-[10px] text-text-muted hidden sm:inline">(Recommended for large 8K image batches)</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setScriptType('r2')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors ${scriptType === 'r2' ? 'bg-sky-500 text-white' : 'bg-inner text-text-muted hover:text-text-base'}`}
            >
              Cloudflare R2
            </button>
            <button
              type="button"
              onClick={() => setScriptType('s3')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors ${scriptType === 's3' ? 'bg-sky-500 text-white' : 'bg-inner text-text-muted hover:text-text-base'}`}
            >
              AWS S3
            </button>
            <button
              type="button"
              onClick={() => setScriptType('supabase')}
              className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-colors ${scriptType === 'supabase' ? 'bg-sky-500 text-white' : 'bg-inner text-text-muted hover:text-text-base'}`}
            >
              Supabase CLI
            </button>
          </div>
        </div>

        <div className="relative">
          <pre className="font-mono text-[11px] p-2.5 bg-black/40 rounded-lg text-emerald-400 overflow-x-auto whitespace-pre leading-relaxed border border-subtle/50">
            {currentScript}
          </pre>
          <button
            type="button"
            onClick={handleCopyScript}
            className="absolute top-2 right-2 px-2.5 py-1 bg-card/80 hover:bg-card border border-subtle rounded-md text-[11px] font-medium text-text-base flex items-center gap-1 cursor-pointer transition-colors"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            <span>{copied ? 'Copied!' : 'Copy Command'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
