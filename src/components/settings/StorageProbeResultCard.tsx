import { AlertTriangle, CheckCircle, ExternalLink, XCircle } from 'lucide-react';

/**
 * Verdict card for the storage connectivity probe.
 *
 * WHY THIS IS ITS OWN FILE
 *   `AdminSettingsView` is budgeted and this card pushed it 70 lines over. The
 *   skill's rule is to extract rather than raise the budget, and the card was
 *   the right seam: it is self-contained, and its whole job is to keep one
 *   distinction visible that the panel previously got wrong.
 *
 * WHAT IT MUST NOT DO
 *   Report a state that was not measured. The panel this replaces synthesised
 *   `HTTP 200` from a database query and hardcoded `corsOk: true`, so it read
 *   "Storage Reachable" while every panorama 400'd in production. Three states
 *   are therefore distinct here, and only one of them is good news:
 *
 *     served     — the object was fetched and came back 2xx
 *     notFound   — the endpoint answered, so credentials and bucket are fine;
 *                  the KEY is wrong
 *     unprobed   — nothing was requested; existence is unknown, never "fine"
 *
 *   `objectFound` is `boolean | null` and null is load-bearing.
 */
export interface StorageProbeCardResult {
  ok: boolean;
  reachable?: boolean;
  /** Whether the probed key exists. null when that was never established. */
  objectFound?: boolean | null;
  status: number;
  statusText: string;
  /** Round-trip for the OBJECT request. Never a database or list() time. */
  latencyMs: number;
  imageUrl: string;
  corsOk: boolean;
  contentType?: string;
  error?: string;
  /** Latency of the DATABASE query, independent of the object. null = not read. */
  dbLatencyMs?: number | null;
  /** Bucket list() outcome, independent of the object. */
  bucketStatus?: string | null;
  /** null when the inventory was not enumerated — never 0. */
  indexedFiles?: number | null;
}

export interface StorageProbeCardProps {
  result: StorageProbeCardResult;
}

export function StorageProbeResultCard({ result }: StorageProbeCardProps) {
  const served = result.objectFound === true;
  const notFound = result.objectFound === false && result.reachable === true;
  const unprobed = result.objectFound === null && result.reachable === true;

  const verdict = served
    ? `Object Served · HTTP ${result.status} ${result.statusText}`
    : notFound
      ? `Storage Reachable · Object Not Found (HTTP ${result.status})`
      : unprobed
        ? 'Endpoint Reachable · Object Not Probed'
        : `Storage Unreachable · ${result.statusText || 'No response'}`;

  return (
    <div className={`p-3.5 rounded-xl border animate-in fade-in slide-in-from-top-2 ${served
      ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
      : notFound || unprobed
        ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
        : 'bg-rose-950/30 border-rose-800/60 text-rose-200'
      }`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <div className="flex items-center gap-2 flex-wrap">
            {served ? (
              <CheckCircle size={16} className="text-text-muted shrink-0" />
            ) : notFound || unprobed ? (
              <AlertTriangle size={16} className="text-text-muted shrink-0" />
            ) : (
              <XCircle size={16} className="text-text-muted shrink-0" />
            )}
            <span className="font-bold text-xs">{verdict}</span>
            {result.status > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-sans bg-inner border border-subtle text-text-base">
                Object fetch {result.latencyMs}ms
              </span>
            )}
            {/* Present only when a CORS-mode response actually arrived. */}
            {result.corsOk && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-inner text-text-muted border border-subtle">
                CORS OK
              </span>
            )}
          </div>

          {result.error && (
            <p className="text-[11px] text-text-muted leading-relaxed font-sans">{result.error}</p>
          )}

          {notFound && (
            <p className="text-[11px] text-text-muted leading-relaxed font-sans">
              The endpoint answered, so the bucket and credentials are fine — the <em>key</em> is wrong.
              Compare the resolved URL above against the actual folder in the bucket: a tenant-prefixed
              key (<code>orgs/&#123;id&#125;/</code>) and a flat key are different objects, and the 360
              viewer fails exactly when this URL and the stored location disagree.
            </p>
          )}

          {result.contentType && (
            <div className="text-[10px] text-text-muted font-sans">
              Content-Type: <span className="text-text-base">{result.contentType}</span>
            </div>
          )}

          {/* Database and bucket liveness, kept visibly separate from the object
              verdict so one measurement is never read as another. */}
          {(result.dbLatencyMs != null || result.bucketStatus) && (
            <div className="pt-1 mt-1 border-t border-subtle text-[10px] text-text-muted font-sans space-y-0.5">
              <div>
                Database query:{' '}
                <span className="text-text-base">
                  {result.dbLatencyMs != null ? `${result.dbLatencyMs}ms` : 'not read'}
                </span>
                {result.bucketStatus ? ` · bucket list: ${result.bucketStatus}` : ''}
                {result.indexedFiles != null
                  ? ` · ${result.indexedFiles.toLocaleString()} files indexed`
                  : ' · inventory not enumerated'}
              </div>
              <div className="opacity-80">
                Separate measurement — does not indicate whether this file exists.
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 flex flex-col items-center gap-1">
          <a
            href={result.imageUrl}
            target="_blank"
            rel="noreferrer"
            className="group relative block rounded-lg overflow-hidden border border-subtle bg-black/40 hover:border-sky-400 transition-all shadow-md"
            title="Click to open image in new tab"
          >
            <img
              src={result.imageUrl}
              alt="360 Preview"
              className="h-16 w-28 object-cover group-hover:scale-105 transition-transform"
              onError={(e) => {
                // Hides the broken-image glyph only. The caption is driven by the
                // measured state, never by this handler, so a preview cannot
                // quietly vanish and leave the operator thinking none was tried.
                e.currentTarget.style.display = 'none';
              }}
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <ExternalLink size={14} className="text-white" />
            </div>
          </a>
          <span className="text-[9px] text-text-muted">
            {served ? '360° Preview' : 'Preview unavailable'}
          </span>
        </div>
      </div>
    </div>
  );
}

export default StorageProbeResultCard;