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
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Breadcrumbs */}
        <button onClick={() => goBreadcrumb(0)}
          className="flex items-center gap-1 px-2 py-1.5 bg-inner border border-subtle rounded-lg text-[11px] font-semibold text-sky-300 hover:bg-sky-500/20 hover:border-sky-500/40 transition-colors cursor-pointer">
          <Home size={12} /> {api.baseUrl || 'NAS'}
        </button>
        {stack.map((seg, i) => (
          <React.Fragment key={i}>
            <ChevronRight size={12} className="text-text-muted" />
            <button onClick={() => goBreadcrumb(i + 1)}
              className="px-2 py-1.5 bg-inner border border-subtle rounded-lg text-[11px] font-semibold text-text-base hover:bg-sky-500/20 hover:border-sky-500/40 transition-colors cursor-pointer">
              {seg}
            </button>
          </React.Fragment>
        ))}
        <div className="flex-1" />
        <button onClick={() => navigate(currentPath)}
          className="flex items-center gap-1.5 px-3 py-2 bg-inner border border-subtle hover:bg-sky-500/20 hover:border-sky-500/40 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <p className="text-[11px] text-amber-300">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
        {/* Folder listing */}
        <div className="bg-inner border border-subtle rounded-xl overflow-hidden min-h-64">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-[11px] text-text-muted py-10">
              <Loader2 size={14} className="animate-spin" /> Listing folder…
            </div>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-text-muted uppercase tracking-wide text-[10px] border-b border-subtle">
                  <th className="py-2 px-3">Name</th>
                  <th className="py-2 px-3 text-right w-24">Files</th>
                  <th className="py-2 px-3 text-right w-28">Size</th>
                  <th className="py-2 px-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {listing?.entries.map((entry) => {
                  const isSel = selected?.path === entry.path;
                  const p = `${stack.join('/')}/${entry.name}`.replace(/^\/+/, '');
                  const isExp = expanded.has(p);
                  return (
                    <tr key={entry.path}
                      onClick={() => setSelected(entry)}
                      className={`border-b border-subtle/50 cursor-pointer transition-colors ${isSel ? 'bg-sky-500/10' : 'hover:bg-sky-500/5'}`}>
                      <td className="py-2 px-3">
                        {entry.isDirectory ? (
                          <span className="flex items-center gap-1.5">
                            {isExp ? <ChevronDown size={12} className="text-text-muted" /> : <ChevronRight size={12} className="text-text-muted" />}
                            <FolderOpen size={13} className="text-amber-300" />
                            <span className="font-semibold text-text-base">{entry.name}/</span>
                          </span>
                        ) : isPreviewable(entry.name) ? (
                          <span className="flex items-center gap-1.5">
                            <ImageIcon size={13} className="text-sky-300" />
                            <span className="text-text-base font-sans">{entry.name}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <FileText size={13} className="text-text-muted" />
                            <span className="text-text-muted font-sans">{entry.name}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-text-muted">{entry.fileCount?.toLocaleString?.() || entry.fileCount || (entry.isDirectory ? '' : 1)}</td>
                      <td className="py-2 px-3 text-right text-text-muted">{formatBytes(entry.sizeBytes)}</td>
                      <td className="py-2 px-3 text-right">
                        {entry.isDirectory && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(entry);
                              }}
                              title="Show counts"
                              className="p-1 rounded-md text-text-muted hover:text-sky-300 hover:bg-sky-500/10 cursor-pointer transition-colors">
                              <Folder size={13} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openDir(entry);
                              }}
                              className="px-2 py-1 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[10px] font-bold uppercase cursor-pointer hover:bg-sky-500/25 transition-colors">
                              Open
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {listing && listing.entries.length === 0 && (
                  <tr><td colSpan={4} className="py-8 text-center text-[11px] text-text-muted">Empty folder.</td></tr>
                )}
                {!listing && !loading && (
                  <tr><td colSpan={4} className="py-8 text-center text-[11px] text-text-muted">No listing.</td></tr>
                )}
              </tbody>
            </table>
          )}
          {listing && (
            <div className="px-3 py-2 border-t border-subtle text-[10px] text-text-muted">
              {listing.fileCount?.toLocaleString?.() || listing.fileCount || 0} files ·{" "}
              {formatBytes(listing.sizeBytes)} in <span className="font-sans">{listing.path || '/'}</span>
            </div>
          )}
        </div>

        {/* Selection / preview pane */}
        <div className="flex flex-col gap-2">
          {selected?.isDirectory ? (
            <div className="bg-inner border border-subtle rounded-xl p-4">
              <div className="text-xs font-bold text-text-base flex items-center gap-2">
                <Folder size={14} className="text-amber-300" /> {selected.name}/
              </div>
              <p className="text-[11px] text-text-muted mt-1 font-sans break-all">{selected.path}</p>
              <div className="text-[11px] text-text-muted mt-2">
                {selected.fileCount?.toLocaleString?.() || selected.fileCount || 0} files ·
                {formatBytes(selected.sizeBytes)}
              </div>
              {!isGuestUser && (
                <button onClick={() => handleRegister(selected)}
                  disabled={registering}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-sky-500/15 border border-sky-500/30 hover:bg-sky-500/25 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-50">
                  {registering ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />}
                  Register as dataset
                </button>
              )}
              {isGuestUser && (
                <p className="text-[11px] text-amber-300 mt-3">Guest read-only: registration disabled.</p>
              )}
            </div>
          ) : selected ? (
            <div className="bg-inner border border-subtle rounded-xl p-4">
              <div className="text-xs font-bold text-text-base flex items-center gap-2">
                <ImageIcon size={14} className="text-sky-300" /> {selected.name}
              </div>
              <p className="text-[11px] text-text-muted mt-1 font-sans break-all">{selected.path}</p>
              <div className="text-[11px] text-text-muted mt-1">{formatBytes(selected.sizeBytes)}</div>
              {previewUrl ? (
                <a href={previewUrl} target="_blank" rel="noreferrer"
                  className="mt-3 flex items-center justify-center gap-1.5 px-3 py-2 bg-sky-500/15 border border-sky-500/30 hover:bg-sky-500/25 text-sky-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer">
                  <Eye size={13} /> Open preview
                </a>
              ) : (
                <p className="text-[11px] text-text-muted mt-3">Configure NAS server URL for previews.</p>
              )}
            </div>
          ) : (
            <div className="bg-inner border border-subtle rounded-xl p-4 text-[11px] text-text-muted">
              Select a file or folder to inspect it. Folders can be registered as dataset metadata (bytes stay on NAS).
            </div>
          )}
        </div>
      </div>
    </div>
  );
};