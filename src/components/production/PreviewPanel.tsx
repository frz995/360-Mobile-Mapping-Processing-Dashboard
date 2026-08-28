import React, { useEffect, useMemo, useState } from 'react';
import { Eye, Images, Loader2, Image as ImageIcon, FolderOpen } from 'lucide-react';
import type { ProductionApiClient } from '../../services/productionApi';
import type { NasFolderListing, DatasetRecord } from '../../types/production';
import { PhotoSphereViewerComponent } from '../PhotoSphereViewerComponent';
import { productionNasUrlFor, formatBytes } from './common';

export interface PreviewPanelProps {
  datasets: DatasetRecord[];
  api: ProductionApiClient;
  projectSettings: any;
  translate: (key: string) => string;
}

type FolderSide = 'source' | 'output';

const FILENAME_RE = /^(.*?)-(\d{5})\.jpg$/;

function extractSubgrid(name: string): string {
  const m = name.replace(/\\/g, '/').split('/').pop()?.match(FILENAME_RE);
  return m ? m[1] : (name.split('/').pop() || name).replace(/\.[A-Za-z0-9]+$/, '');
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  datasets,
  api,
  projectSettings
}) => {
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [sourceListing, setSourceListing] = useState<NasFolderListing | null>(null);
  const [outputListing, setOutputListing] = useState<NasFolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState('');
  const [side, setSide] = useState<FolderSide>('source');
  const [page, setPage] = useState(0);
  const [viewerKey, setViewerKey] = useState(0);

  const selected = datasets.find((d) => d.id === selectedDatasetId);

  useEffect(() => {
    setSourceListing(null);
    setOutputListing(null);
    setSelectedFile('');
    setPage(0);
    if (!selected) return;
    setLoading(true);
    api
      .listFolder(selected.source_folder || '')
      .then((l) => setSourceListing(l))
      .catch(() => setSourceListing(null))
      .finally(() => setLoading(false));
    if (selected.output_folder) {
      api
        .listFolder(selected.output_folder)
        .then((l) => setOutputListing(l))
        .catch(() => setOutputListing(null));
    }
  }, [selectedDatasetId, selected?.id, api]);

  const activeListing = useMemo(
    () => (side === 'source' ? sourceListing : outputListing),
    [side, sourceListing, outputListing]
  );

  const files = useMemo(
    () => (activeListing?.entries || []).filter((e) => !e.isDirectory),
    [activeListing]
  );

  const pageSize = 18;
  const pageCount = Math.max(1, Math.ceil(files.length / pageSize));
  const pageFiles = files.slice(page * pageSize, (page + 1) * pageSize);

  const folderUrl = () =>
    productionNasUrlFor(
      projectSettings,
      side === 'source' ? selected?.source_folder : selected?.output_folder,
      selectedFile
    );

  useEffect(() => {
    if (files.length > 0 && !files.some((f) => f.name === selectedFile)) {
      setSelectedFile(files[0].name);
    }
  }, [files, selectedFile]);

  const subgridAutofill = selected?.subgrid || (selectedFile ? extractSubgrid(selectedFile) : '');

  return (
    <div className="flex flex-col gap-4 min-h-0">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-inner rounded-xl border border-subtle text-sky-400">
          <Eye size={20} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-text-base tracking-wide">Preview &amp; Compare</h2>
          <span className="text-[11px] text-text-muted">Browse NAS folder contents and inspect frames with the 360 viewer (thumbnail-first, then immersive).</span>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <select className="bg-inner border border-subtle rounded-lg px-3 py-2 text-xs text-text-base outline-none focus:border-sky-500/60"
          value={selectedDatasetId} onChange={(e) => setSelectedDatasetId(e.target.value)}>
          <option value="">— select a dataset —</option>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>{d.name} {d.subgrid ? `(${d.subgrid})` : ''}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 bg-inner border border-subtle rounded-lg p-0.5">
          {(['source', 'output'] as FolderSide[]).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              disabled={s === 'output' && !selected?.output_folder}
              className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                side === s
                  ? 'bg-sky-500/25 text-sky-300'
                  : 'text-text-muted hover:text-text-base'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {s === 'source' ? '⬅ Source' : 'Processed ➡'}
            </button>
          ))}
        </div>

        {loading && <Loader2 size={14} className="animate-spin text-sky-400" />}
        {activeListing && (
          <span className="text-[11px] text-text-muted font-mono">
            {activeListing.path || 'root'} · {activeListing.fileCount.toLocaleString()} files · {formatBytes(activeListing.sizeBytes)}
          </span>
        )}
      </div>

      {selected && activeListing && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
          <div className="bg-card border border-subtle rounded-xl p-3 flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-base flex items-center gap-2">
                <ImageIcon size={14} className="text-sky-400" /> {selectedFile || '—'}
              </span>
              <span className="text-[10px] text-text-muted">{subgridAutofill}</span>
            </div>
            <div className="h-[340px] rounded-lg overflow-hidden border border-subtle bg-black/40">
              {selectedFile ? (
                <PhotoSphereViewerComponent
                  key={`${viewerKey}-${side}-${selectedFile}`}
                  panoramaUrl={folderUrl()}
                  caption={selectedFile}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[11px] text-text-muted">No file selected</div>
              )}
            </div>
            <p className="text-[10px] text-text-muted font-mono break-all">{folderUrl() || '—'}</p>
          </div>

          <div className="bg-card border border-subtle rounded-xl p-3 flex flex-col gap-2 min-h-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-base flex items-center gap-2">
                <Images size={14} className="text-sky-400" /> Frames
              </span>
              <span className="flex gap-1">
                <button disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="px-2 py-1 rounded-md bg-inner border border-subtle hover:bg-sky-500/15 text-xs text-text-base disabled:opacity-40 cursor-pointer">‹</button>
                <span className="text-[10px] text-text-muted px-1 self-center">{page + 1}/{pageCount}</span>
                <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="px-2 py-1 rounded-md bg-inner border border-subtle hover:bg-sky-500/15 text-xs text-text-base disabled:opacity-40 cursor-pointer">›</button>
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 gap-2 overflow-y-auto max-h-[340px]">
              {pageFiles.map((f) => {
                const active = f.name === selectedFile;
                return (
                  <button key={f.path} onClick={() => { setSelectedFile(f.name); setViewerKey((k) => k + 1); }}
                    className={`relative rounded-lg overflow-hidden border focus:outline-none transition-all cursor-pointer ${
                      active ? 'border-sky-400 ring-1 ring-sky-400' : 'border-subtle hover:border-sky-500/40'
                    }`}>
                    <img key={f.path} src={productionNasUrlFor(projectSettings, side === 'source' ? selected?.source_folder : selected?.output_folder, f.name)}
                      alt={f.name} loading="lazy"
                      className="w-full h-14 object-cover" />
                    <span className="absolute bottom-0 left-0 right-0 px-1 py-0.5 bg-black/70 text-[8px] font-mono text-slate-300 truncate">
                      {f.name}
                    </span>
                  </button>
                );
              })}
              {files.length === 0 && (
                <div className="col-span-full py-10 text-center text-[11px] text-text-muted flex flex-col items-center gap-2">
                  <FolderOpen size={20} className="opacity-50" />
                  No files listed for this folder.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!selected && (
        <div className="bg-card border border-subtle rounded-xl py-12 flex flex-col items-center justify-center gap-3 text-center">
          <Eye size={24} className="text-text-muted/50" />
          <p className="text-[11px] text-text-muted max-w-md">
            Select a dataset to browse its NAS folders. Use the Source / Processed toggle to compare the original stitch+blur frame against the generative-fill + enhancement output.
          </p>
        </div>
      )}
    </div>
  );
};