import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  FileText,
  RefreshCw,
  Loader2,
  Eye,
  FolderPlus,
  Home
} from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import { saveDatasetToSupabase } from '../../../services/supabase';
import type { NasFolderEntry, NasFolderListing } from '../../../types/production';
import { formatBytes, guessSubgridFromPath } from './storageCommon';

export interface BrowserPanelProps {
  api: ProductionApiClient;
  projectSettings: any;
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  userLabel: string;
}

const PREVIEW_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp']);

function isPreviewable(name: string): boolean {
  const lower = name.toLowerCase();
  return PREVIEW_EXT.has('.' + lower.split('.').pop());
}

export const BrowserPanel: React.FC<BrowserPanelProps> = ({
  api,
  projectSettings,
  isGuestUser,
  onAddNotification,
  onAddAuditLog,
  userLabel
}) => {
  const [stack, setStack] = useState<string[]>([]);
  const [listing, setListing] = useState<NasFolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<NasFolderEntry | null>(null);
  const [registering, setRegistering] = useState(false);

  const currentPath = stack.join('/');

  const navigate = useCallback(
    async (path: string) => {
      setLoading(true);
      setError('');
      const res = await api.listFolder(path);
      setLoading(false);
      if (!res) {
        setError('Unable to list folder — worker unreachable or folder missing.');
        return;
      }
      setListing(res);
    },
    [api]
  );

  useEffect(() => {
    navigate(currentPath);
  }, [currentPath, navigate]);

  const goBreadcrumb = (index: number) => {
    setStack(stack.slice(0, index));
  };

  const openDir = (entry: NasFolderEntry) => {
    setStack((s) => [...s, entry.name]);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(`${stack.join('/')}/${entry.name}`.replace(/^\/+/, ''));
      return next;
    });
    setSelected(null);
  };

  const previewUrl = selected?.isDirectory
    ? ''
    : (() => {
        const base = (
          projectSettings?.nasServerUrl ||
          import.meta.env.VITE_NAS_SERVER_URL ||
          ''
        ).replace(/\/+$/, '');
        const pfx = [currentPath, selected?.name]
          .filter(Boolean)
          .join('/')
          .replace(/^\/+/, '');
        return base ? `${base}/${pfx}` : pfx;
      })();

  const handleRegister = async (entry: NasFolderEntry) => {
    if (isGuestUser || registering) return;
    setRegistering(true);
    const subgrid = guessSubgridFromPath(entry.path);
    const isRawPath = entry.path.toUpperCase().includes('/RAW') || entry.path.toUpperCase().startsWith('RAW');
    const dataset = await saveDatasetToSupabase({
      dataset_type: isRawPath ? 'RAW' : 'PROCESSED',
      pipeline_stage: 'STITCH',
      name: entry.name,
      subgrid: subgrid || undefined,
      provider: isRawPath ? 'MMS Field Intake' : 'NAS Storage Manager',
      source_folder: entry.path,
      storage_provider: projectSettings?.storageProvider || 'nas',
      file_count: entry.fileCount,
      size_bytes: entry.sizeBytes,
      status: 'REGISTERED',
      created_by: userLabel,
      metadata: { source: 'folder-register', path: entry.path, intakeTier: isRawPath ? 'RAW' : 'PROCESSED' }
    });
    setRegistering(false);
    if (dataset) {
      onAddNotification?.({ title: `Dataset registered`, message: `${entry.name} [${dataset.dataset_type}] (${subgrid || 'no subgrid'}) indexed from ${entry.path}.`, category: 'SYSTEM' });
      onAddAuditLog?.('CREATE', `Dataset ${entry.name}`, `Registered ${dataset.dataset_type} from ${entry.path} (${entry.fileCount || 0} files)`, 'COMPLETED');
    } else {
      onAddNotification?.({ title: `Register failed`, message: `Could not register ${entry.name}.`, category: 'ERROR' });
    }
  };

  const toggleExpand = (entry: NasFolderEntry) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const p = `${stack.join('/')}/${entry.name}`.replace(/^\/+/, '');
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };  return (
    <div className="space-y-4 animate-in fade-in font-sans">
      {/* Header with bottom divider line matching RBAC */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-subtle">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Breadcrumbs */}
          <button
            onClick={() => goBreadcrumb(0)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-inner hover:bg-card border border-subtle rounded-lg text-xs font-semibold text-text-base transition-colors cursor-pointer"
          >
            <Home size={12} className="text-zinc-400" />
            <span>{api.baseUrl || 'NAS Mount'}</span>
          </button>
          {stack.map((seg, i) => (
            <React.Fragment key={i}>
              <ChevronRight size={12} className="text-text-muted" />
              <button
                onClick={() => goBreadcrumb(i + 1)}
                className="px-2.5 py-1.5 bg-inner hover:bg-card border border-subtle rounded-lg text-xs font-semibold text-text-base transition-colors cursor-pointer"
              >
                {seg}
              </button>
            </React.Fragment>
          ))}
        </div>
        <button
          onClick={() => navigate(currentPath)}
          disabled={loading}
          className="px-3 py-1.5 bg-inner hover:bg-card border border-subtle rounded-lg text-xs font-semibold text-text-base flex items-center gap-1.5 cursor-pointer transition-all shadow-sm"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Directory</span>
        </button>
      </div>

      {error && <p className="text-xs text-amber-300">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-3">
        {/* Folder listing table */}
        <div className="border border-subtle rounded-lg overflow-hidden flex flex-col min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-text-muted py-16">
              <Loader2 size={14} className="animate-spin" /> Scanning NAS folder…
            </div>
          ) : (
            <div className="overflow-auto max-h-[520px] flex-1">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="sticky top-0 bg-app text-text-muted uppercase text-[10px] tracking-wider border-b border-subtle z-10 shadow-sm">
                  <tr>
                    <th className="px-3.5 py-2.5">Name</th>
                    <th className="px-3.5 py-2.5 text-right w-24">Files</th>
                    <th className="px-3.5 py-2.5 text-right w-28">Total Size</th>
                    <th className="px-3.5 py-2.5 text-right w-24">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle/80">
                  {listing?.entries.map((entry) => {
                    const isSel = selected?.path === entry.path;
                    const p = `${stack.join('/')}/${entry.name}`.replace(/^\/+/, '');
                    const isExp = expanded.has(p);
                    return (
                      <tr
                        key={entry.path}
                        onClick={() => setSelected(entry)}
                        className={`cursor-pointer transition-colors ${
                          isSel ? 'bg-card' : 'hover:bg-inner'
                        }`}
                      >
                        <td className="px-3.5 py-2.5">
                          {entry.isDirectory ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(entry);
                              }}
                              className="flex items-center gap-1.5 text-left cursor-pointer transition-colors"
                            >
                              {isExp ? <ChevronDown size={12} className="text-text-muted" /> : <ChevronRight size={12} className="text-text-muted" />}
                              <FolderOpen size={13} className="text-zinc-400" />
                              <span className="font-semibold text-text-base">{entry.name}/</span>
                            </button>
                          ) : isPreviewable(entry.name) ? (
                            <span className="flex items-center gap-1.5">
                              <ImageIcon size={13} className="text-zinc-400" />
                              <span className="text-text-base font-mono text-[11px]">{entry.name}</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <FileText size={13} className="text-text-muted" />
                              <span className="text-text-muted font-mono text-[11px]">{entry.name}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono text-text-muted">
                          {entry.fileCount?.toLocaleString?.() || entry.fileCount || (entry.isDirectory ? '' : 1)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right font-mono text-text-muted">
                          {formatBytes(entry.sizeBytes)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right">
                          {entry.isDirectory && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDir(entry);
                                }}
                                className="px-2 py-1 rounded bg-inner hover:bg-card border border-subtle text-text-base text-[10px] font-semibold uppercase cursor-pointer transition-colors"
                              >
                                Open
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {listing && listing.entries.length === 0 && (
                    <tr><td colSpan={4} className="py-12 text-center text-xs text-text-muted">Empty folder.</td></tr>
                  )}
                  {!listing && !loading && (
                    <tr><td colSpan={4} className="py-12 text-center text-xs text-text-muted">No directory listing available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {listing && (
            <div className="px-3.5 py-2 border-t border-subtle text-[10px] text-text-muted bg-inner/40 flex items-center justify-between font-mono">
              <span>{listing.fileCount?.toLocaleString?.() || listing.fileCount || 0} files in <span className="text-zinc-200">{listing.path || '/'}</span></span>
              <span>{formatBytes(listing.sizeBytes)}</span>
            </div>
          )}
        </div>

        {/* Selection / preview pane */}
        <div className="flex flex-col gap-2">
          {selected?.isDirectory ? (
            <div className="border border-subtle rounded-lg overflow-hidden bg-inner/40 p-4">
              <div className="text-xs font-bold text-text-base flex items-center gap-2">
                <Folder size={14} className="text-zinc-400" />
                <span>{selected.name}/</span>
              </div>
              <p className="text-[11px] text-text-muted mt-1 font-mono break-all">{selected.path}</p>
              <div className="text-[11px] text-text-muted mt-2 font-mono">
                {selected.fileCount?.toLocaleString?.() || selected.fileCount || 0} files · {formatBytes(selected.sizeBytes)}
              </div>
              {!isGuestUser && (
                <button
                  onClick={() => handleRegister(selected)}
                  disabled={registering}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 px-3.5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {registering ? <Loader2 size={12} className="animate-spin" /> : <FolderPlus size={12} />}
                  <span>Register as Dataset</span>
                </button>
              )}
              {isGuestUser && (
                <p className="text-[10px] text-amber-300 mt-2">Guest read-only: registration disabled.</p>
              )}
            </div>
          ) : selected ? (
            <div className="border border-subtle rounded-lg overflow-hidden bg-inner/40 p-4">
              <div className="text-xs font-bold text-text-base flex items-center gap-2">
                <ImageIcon size={14} className="text-zinc-400" />
                <span className="truncate">{selected.name}</span>
              </div>
              <p className="text-[11px] text-text-muted mt-1 font-mono break-all">{selected.path}</p>
              <div className="text-[11px] text-text-muted mt-1 font-mono">{formatBytes(selected.sizeBytes)}</div>
              {previewUrl ? (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex items-center justify-center gap-1.5 px-3.5 py-2 bg-inner hover:bg-card border border-subtle text-text-base text-xs font-semibold rounded-lg transition-colors cursor-pointer shadow-sm"
                >
                  <Eye size={12} />
                  <span>Open Preview</span>
                </a>
              ) : (
                <p className="text-[10px] text-text-muted mt-3">Configure NAS server URL for browser previews.</p>
              )}
            </div>
          ) : (
            <div className="border border-subtle rounded-lg overflow-hidden bg-inner/40 p-4 text-xs text-text-muted">
              Select a file or folder to inspect properties or register as a dataset.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};