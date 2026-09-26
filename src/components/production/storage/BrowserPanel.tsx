import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  FileText,
  RefreshCw,
  Loader2,
  Eye,
  Home,
  ArrowRight
} from 'lucide-react';
import type { ProductionApiClient } from '../../../services/productionApi';
import type { NasFolderEntry, NasFolderListing } from '../../../types/production';
import { isNasImageProxyEnabled, nasImageUrl } from '../../../services/nasImageToken';
import { formatBytes, guessSubgridFromPath } from './storageCommon';
import { TextAction } from '../chrome';

export interface BrowserPanelProps {
  api: ProductionApiClient;
  projectSettings: any;
  translate: (key: string) => string;
  isGuestUser?: boolean;
  onAddNotification?: (item: any) => void;
  onAddAuditLog?: (type: any, title: string, details: string, status?: any) => void;
  onOpenProductionHub?: (path: string, subgrid?: string) => void;
  userLabel: string;
  initialPath?: string;
}

const PREVIEW_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp']);

function isPreviewable(name: string): boolean {
  const lower = name.toLowerCase();
  return PREVIEW_EXT.has('.' + lower.split('.').pop());
}

export const BrowserPanel: React.FC<BrowserPanelProps> = ({
  api,
  projectSettings,
  onOpenProductionHub,
  initialPath
}) => {
  const [stack, setStack] = useState<string[]>(
    () =>
      initialPath
        ? initialPath.replace(/^\/+/, '').split('/').filter(Boolean)
        : []
  );
  const [listing, setListing] = useState<NasFolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<NasFolderEntry | null>(null);

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
    setSelected(null);
  };

  const previewUrl = selected?.isDirectory
    ? ''
    : (() => {
        const pfx = [currentPath, selected?.name]
          .filter(Boolean)
          .join('/')
          .replace(/^\/+/, '');
        if (!pfx) return '';
        // Cloudflare Pages is HTTPS, so a private http:// NAS origin cannot be
        // embedded directly; previews go through the authenticated same-origin
        // proxy in production.
        if (isNasImageProxyEnabled()) return nasImageUrl(pfx);
        const base = (
          projectSettings?.nasServerUrl ||
          projectSettings?.productionApiUrl ||
          import.meta.env.VITE_NAS_SERVER_URL ||
          import.meta.env.VITE_PRODUCTION_API_URL ||
          ''
        ).replace(/\/+$/, '');
        return base ? `${base}/${pfx}` : pfx;
      })();


  return (
    <div className="space-y-3 animate-in fade-in font-sans">
      {/* Pipeline Stage Quick Jumps */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-subtle">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase font-bold text-text-muted">Pipeline Folders:</span>
          {['00_Raw_data', '01_Metadata', '02_Blurring', '03_Stitching', '04_Enhanced', '05_Final'].map((st) => (
            <TextAction
              key={st}
              onClick={() => {
                setStack([st]);
                setSelected(null);
              }}
              title={`Jump to ${st}`}
            >
              <span className={`font-mono ${stack[0] === st ? 'text-text-base font-semibold' : ''}`}>{st}</span>
            </TextAction>
          ))}
        </div>
      </div>

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
        <TextAction
          icon={<RefreshCw size={11} className={loading ? 'animate-spin' : ''} />}
          onClick={() => navigate(currentPath)}
          disabled={loading}
          title="Re-list the current directory"
        >
          Refresh
        </TextAction>
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle/80">
                  {listing?.entries.map((entry) => {
                    const isSel = selected?.path === entry.path;
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
                                openDir(entry);
                              }}
                              title={`Open ${entry.name}/`}
                              className="flex items-center gap-1.5 text-left cursor-pointer transition-colors"
                            >
                              <ChevronRight size={12} className="text-text-muted" />
                              <FolderOpen size={13} className="text-zinc-400" />
                              <span className="font-semibold text-text-base hover:underline">{entry.name}/</span>
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
                      </tr>
                    );
                  })}
                  {listing && listing.entries.length === 0 && (
                    <tr><td colSpan={3} className="py-12 text-center text-xs text-text-muted">Empty folder.</td></tr>
                  )}
                  {!listing && !loading && (
                    <tr><td colSpan={3} className="py-12 text-center text-xs text-text-muted">No directory listing available.</td></tr>
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
              <button
                onClick={() => onOpenProductionHub?.(selected.path, guessSubgridFromPath(selected.path))}
                className="mt-3 w-full flex items-center justify-center gap-1.5 px-3.5 py-2 bg-text-base text-card hover:opacity-90 text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-sm"
              >
                <span>Load in Production Hub</span>
                <ArrowRight size={13} />
              </button>
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
              Select a file or folder to inspect properties or load into Production Hub.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};