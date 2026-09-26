import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, X, Search, CheckCircle, AlertTriangle, Copy, FileText } from 'lucide-react';
import { toast } from './common/toast';
import { useDialogEscape } from './common/dialog';

interface QCAuditModalProps {
  subgrid: string;
  poiCount: number;
  availableCount: number;
  baseFilename?: string;
  availableFilenames?: string[];
  expectedFilenames?: string[];
  onClose: () => void;
}

export function QCAuditModal({ subgrid, poiCount, availableCount, availableFilenames, expectedFilenames, onClose }: QCAuditModalProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'missing' | 'available'>('missing');
  const [searchQuery, setSearchQuery] = useState('');

  useDialogEscape(onClose);

  const realExpected = useMemo(
    () => (expectedFilenames || []).filter(f => Boolean(f && f.trim())),
    [expectedFilenames]
  );
  const realAvailable = useMemo(
    () => (availableFilenames || []).filter(f => Boolean(f && f.trim())),
    [availableFilenames]
  );

  // A filename-level integrity audit needs BOTH a real survey track and a real
  // imagery inventory. Previously the fallback synthesised a sequence from the
  // subgrid code and then assumed the first N of those invented names existed,
  // so "missing" was only ever arithmetic and the report could claim PASSED
  // without anything having been checked. Without both lists we cannot audit.
  const canAudit = realExpected.length > 0 && realAvailable.length > 0;

  const results = useMemo(() => {
    if (!canAudit) return [] as { filename: string; index: number; isMissing: boolean }[];
    const availableSet = new Set(realAvailable.map(f => f.toLowerCase().trim()));
    return realExpected.map((fn, idx) => ({
      filename: fn,
      index: idx + 1,
      isMissing: !availableSet.has(fn.toLowerCase().trim())
    }));
  }, [canAudit, realExpected, realAvailable]);

  const missingCount = canAudit ? results.filter(r => r.isMissing).length : 0;
  const trackCount = canAudit ? realExpected.length : 0;
  const availableTotal = canAudit ? realAvailable.length : 0;
  const verdict = !canAudit
    ? 'NOT VERIFIED'
    : (missingCount === 0 ? 'PASSED (100% Matched)' : 'ACTION REQUIRED (Missing Images Detected)');

  const filteredResults = results.filter(item => {
    if (activeTab === 'missing' && !item.isMissing) return false;
    if (activeTab === 'available' && item.isMissing) return false;
    if (searchQuery.trim()) {
      return item.filename.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const missingFilenames = results.filter(r => r.isMissing).map(r => r.filename);

  const copyMissingList = () => {
    if (!canAudit) {
      toast.error('Audit not verified: no real survey track and imagery inventory to compare.');
      return;
    }
    if (missingFilenames.length === 0) {
      toast.info('No missing image files found for this subgrid!');
      return;
    }
    navigator.clipboard.writeText(missingFilenames.join('\n'));
    toast.success(`Copied ${missingFilenames.length} missing image filenames to clipboard!`);
  };

  const exportQCReport = () => {
    const reportText = `=====================================================
TNB 360 MOBILE MAPPING - QC AUDIT REPORT
=====================================================
Subgrid: ${subgrid}
Audit Date: ${new Date().toLocaleString()}
POI Survey Count (CSV Metadata): ${poiCount}
Survey Track Filenames Loaded: ${trackCount}
Available Image Filenames Loaded: ${availableTotal}
Missing Panorama Images: ${canAudit ? missingCount : 'UNKNOWN - NOT VERIFIED'}
Integrity Status: ${verdict}
Source: set difference of the loaded survey track against the loaded
imagery inventory. No storage bucket is scanned by this report.
====================================================

MISSING FILENAMES (${canAudit ? missingFilenames.length : 'not determined'}):
-----------------------------------------------------
${!canAudit
      ? 'Audit could not be run: a real survey track filename list and a real\nimagery inventory list are both required. Nothing was inferred.'
      : (missingFilenames.length > 0 ? missingFilenames.join('\n') : 'None - every survey track frame has a matching loaded image.')}
`;
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `QC_Missing_Report_${subgrid}_${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="QC Integrity Audit"
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-card border border-subtle rounded-2xl p-6 max-w-2xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-start pb-4 mb-4 border-b border-subtle shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl bg-inner border border-subtle ${canAudit ? 'text-text-base' : 'text-text-muted'}`}>
              <ShieldAlert size={18} className={canAudit && missingCount > 0 ? 'text-rose-400' : 'text-text-muted'} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-base tracking-wide flex items-center gap-2">
                QC Integrity Audit &bull; Subgrid [{subgrid}]
              </h2>
              <span className="text-xs text-text-muted">
                Compares the loaded survey track against the loaded imagery inventory
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-base p-1.5 rounded-lg hover:bg-inner transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Audit Metrics Summary Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4 shrink-0">
          <div className="bg-inner border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">POI Metadata Points</span>
            <span className="text-xl font-bold text-text-base font-sans mt-0.5 block">{poiCount.toLocaleString()}</span>
            <span className="text-[10px] text-text-muted">From CSV metadata</span>
          </div>
          <div className="bg-inner border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Loaded Imagery</span>
            <span className="text-xl font-bold text-text-base font-sans mt-0.5 block">
              {canAudit ? availableTotal.toLocaleString() : <span className="text-text-muted">&mdash;</span>}
            </span>
            <span className="text-[10px] text-text-muted">Filenames actually loaded</span>
          </div>
          <div className="bg-inner border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Missing Images</span>
            <span className={`text-xl font-bold font-sans mt-0.5 block ${canAudit && missingCount > 0 ? 'text-rose-400' : 'text-text-base'}`}>
              {canAudit ? missingCount.toLocaleString() : <span className="text-text-muted">&mdash;</span>}
            </span>
            <span className={`text-[10px] ${canAudit && missingCount > 0 ? 'text-rose-400/90 font-medium' : 'text-text-muted'}`}>
              {canAudit ? (missingCount > 0 ? 'Upload required' : '100% Matched') : 'Not verified'}
            </span>
          </div>
        </div>

        {/* Unverified banner / filter row */}
        {canAudit ? (
          <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
            {/* Filter Tabs */}
            <div className="flex bg-inner p-1 rounded-xl border border-subtle text-xs font-medium">
              <button
                onClick={() => setActiveTab('missing')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'missing'
                    ? 'bg-card text-rose-400 border border-subtle font-semibold shadow-sm'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                <AlertTriangle size={13} className={activeTab === 'missing' ? 'text-rose-400' : 'text-text-muted'} />
                Missing Only ({missingCount})
              </button>
              <button
                onClick={() => setActiveTab('available')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'available'
                    ? 'bg-card text-text-base border border-subtle font-semibold shadow-sm'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                <CheckCircle size={13} className={activeTab === 'available' ? 'text-emerald-400' : 'text-text-muted'} />
                Available ({availableTotal})
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-card text-text-base border border-subtle font-semibold shadow-sm'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                All ({trackCount})
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-2.5 text-text-muted" />
              <input
                type="text"
                placeholder="Filter filenames..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 bg-inner border border-subtle rounded-lg text-xs text-text-base placeholder-text-muted focus:outline-none focus:border-subtle"
              />
            </div>
          </div>
        ) : (
          <div className="bg-inner border border-subtle p-4 rounded-xl mb-4 shrink-0">
            <div className="flex items-center gap-2 text-xs font-bold text-text-base">
              <AlertTriangle size={14} className="text-amber-400" />
              Audit not verified
            </div>
            <p className="text-[11px] text-text-muted mt-1.5 leading-relaxed">
              An integrity audit needs a real survey track filename list and a real imagery
              inventory list for this subgrid. Without both, no verdict can be given.
              {trackCount === 0 && ' No survey track filenames are loaded.'}
              {availableTotal === 0 && realAvailable.length === 0 && availableCount > 0 && (
                <> {availableCount.toLocaleString()} frames are counted for this subgrid, but
                  their filenames are not loaded, so they cannot be checked individually.</>
              )}
              {availableTotal === 0 && realAvailable.length === 0 && availableCount === 0 && (
                ' No imagery filenames are loaded.'
              )}
              {' '}Run a live NAS scan for this subgrid to populate both.
            </p>
          </div>
        )}

        {/* Results List View */}
        <div className="flex-1 overflow-y-auto font-sans text-xs space-y-1 p-2 bg-inner rounded-xl border border-subtle min-h-[220px]">
          {filteredResults.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              {canAudit && activeTab === 'missing' ? (
                <>
                  <CheckCircle size={22} className="mx-auto text-emerald-400/80 mb-2" />
                  <span className="block text-xs font-semibold text-text-base">No missing image files</span>
                  <span className="text-[11px] text-text-muted">
                    Every loaded survey track frame has a matching loaded image.
                  </span>
                </>
              ) : (
                <>
                  <Search size={22} className="mx-auto text-text-muted/80 mb-2" />
                  <span className="block text-xs font-semibold text-text-base">
                    {canAudit ? 'No files matching criteria' : 'No audit results'}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    {canAudit
                      ? 'Try changing search or tab filters.'
                      : 'This audit was not run because no real filename lists were loaded.'}
                  </span>
                </>
              )}
            </div>
          ) : (
            filteredResults.map((item) => (
              <div
                key={item.index}
                className="flex items-center justify-between px-3 py-2 bg-card hover:bg-card/80 border border-subtle rounded-lg transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-text-muted text-[10px] w-10 font-sans shrink-0">#{String(item.index).padStart(4, '0')}</span>
                  <span className="font-sans text-xs font-medium text-text-base truncate">
                    {item.filename}
                  </span>
                </div>

                <div className="shrink-0 ml-3">
                  {item.isMissing ? (
                    <span className="text-[11px] font-medium text-rose-400 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                      Missing from MMS_PIC
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-text-muted flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
                      Available
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Utility Toolbar */}
        <div className="pt-4 border-t border-subtle flex items-center justify-between shrink-0 mt-4">
          <div className="flex items-center gap-2">
            <button
              onClick={copyMissingList}
              disabled={!canAudit || missingCount === 0}
              className="px-3 py-1.5 bg-inner hover:bg-inner/80 disabled:opacity-40 disabled:cursor-not-allowed text-text-base border border-subtle rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Copy size={13} /> Copy Missing ({canAudit ? missingCount : 0})
            </button>
            <button
              onClick={exportQCReport}
              className="px-3 py-1.5 bg-inner hover:bg-inner/80 text-text-base border border-subtle rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <FileText size={13} /> Export Report (.txt)
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-inner hover:bg-inner/80 text-text-base border border-subtle rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}

export default QCAuditModal;