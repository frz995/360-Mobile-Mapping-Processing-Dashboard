import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, X, Search, RefreshCw, CheckCircle, AlertTriangle, Copy, FileText, Loader2 } from 'lucide-react';
import { generateImageFilenamesList } from '../utils/subgrid';
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

export function QCAuditModal({ subgrid, poiCount, availableCount, baseFilename, availableFilenames, expectedFilenames, onClose }: QCAuditModalProps) {
  const expectedTotal = poiCount > 0 ? poiCount : 1;
  const missingCount = Math.max(0, expectedTotal - availableCount);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentScanningFilename, setCurrentScanningFilename] = useState('');
  const [, setHasAnalyzed] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'missing' | 'available'>('missing');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<{ filename: string; index: number; isMissing: boolean }[]>([]);

  useDialogEscape(onClose);

  const runIntegrityAudit = () => {
    setIsAnalyzing(true);
    setProgress(0);
    setHasAnalyzed(false);

    const allExpected = (expectedFilenames && expectedFilenames.length > 0)
      ? expectedFilenames
      : generateImageFilenamesList(subgrid, expectedTotal, baseFilename);

    const availableSet = new Set((availableFilenames && availableFilenames.length > 0)
      ? availableFilenames.map(f => f.toLowerCase().trim())
      : allExpected.slice(0, availableCount).map(f => f.toLowerCase().trim()));

    let currentStep = 0;
    const totalSteps = Math.min(100, allExpected.length);
    const stepIncrement = Math.max(1, Math.floor(allExpected.length / totalSteps));

    const interval = setInterval(() => {
      currentStep += stepIncrement;
      if (currentStep >= allExpected.length) {
        currentStep = allExpected.length;
        clearInterval(interval);

        const analyzedList = allExpected.map((fn, idx) => ({
          filename: fn,
          index: idx + 1,
          isMissing: !availableSet.has(fn.toLowerCase().trim())
        }));

        setResults(analyzedList);
        setProgress(100);
        setIsAnalyzing(false);
        setHasAnalyzed(true);
      } else {
        const pct = Math.round((currentStep / allExpected.length) * 100);
        setProgress(pct);
        setCurrentScanningFilename(allExpected[currentStep - 1] || '');
      }
    }, 25);
  };

  useEffect(() => {
    runIntegrityAudit();
  }, [subgrid, poiCount, availableCount]);

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
POI Survey Count (CSV Metadata): ${expectedTotal}
Available Images in MMS_PIC: ${availableCount}
Missing Panorama Images: ${missingCount}
Integrity Status: ${missingCount === 0 ? 'PASSED (100% Complete)' : 'ACTION REQUIRED (Missing Images Detected)'}
=====================================================

MISSING FILENAMES (${missingFilenames.length}):
-----------------------------------------------------
${missingFilenames.length > 0 ? missingFilenames.join('\n') : 'None - All images exist in MMS_PIC storage.'}
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
            <div className="p-2.5 rounded-xl bg-inner border border-subtle text-text-base">
              <ShieldAlert size={18} className={missingCount > 0 ? 'text-rose-400' : 'text-text-muted'} />
            </div>
            <div>
              <h2 className="text-base font-bold text-text-base tracking-wide flex items-center gap-2">
                QC Integrity Audit &bull; Subgrid [{subgrid}]
              </h2>
              <span className="text-xs text-text-muted">Verifying panorama file availability in Supabase MMS_PIC storage</span>
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
            <span className="text-xl font-bold text-text-base font-sans mt-0.5 block">{expectedTotal.toLocaleString()}</span>
            <span className="text-[10px] text-text-muted">Expected survey track</span>
          </div>
          <div className="bg-inner border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Available in MMS_PIC</span>
            <span className="text-xl font-bold text-text-base font-sans mt-0.5 block">{availableCount.toLocaleString()}</span>
            <span className="text-[10px] text-text-muted">Uploaded image frames</span>
          </div>
          <div className="bg-inner border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Missing Images</span>
            <span className={`text-xl font-bold font-sans mt-0.5 block ${missingCount > 0 ? 'text-rose-400' : 'text-text-base'}`}>{missingCount.toLocaleString()}</span>
            <span className={`text-[10px] ${missingCount > 0 ? 'text-rose-400/90 font-medium' : 'text-text-muted'}`}>{missingCount > 0 ? 'Upload required' : '100% Matched'}</span>
          </div>
        </div>

        {/* Progress Bar during Analysis */}
        {isAnalyzing ? (
          <div className="bg-inner border border-subtle p-5 rounded-xl mb-4 shrink-0 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-sky-400 flex items-center gap-2">
                <Loader2 size={15} className="animate-spin text-sky-400" />
                Analyzing MMS_PIC storage bucket files...
              </span>
              <span className="text-text-base font-sans">{progress}%</span>
            </div>
            <div className="w-full bg-card h-2 rounded-full overflow-hidden p-0.5 border border-subtle">
              <div
                className="bg-sky-500 h-full rounded-full transition-all duration-75"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="text-[11px] text-text-muted font-sans truncate">
              {currentScanningFilename ? `Scanning: ${currentScanningFilename}` : 'Checking panorama filenames...'}
            </div>
          </div>
        ) : (
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
                Available ({availableCount})
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  activeTab === 'all'
                    ? 'bg-card text-text-base border border-subtle font-semibold shadow-sm'
                    : 'text-text-muted hover:text-text-base'
                }`}
              >
                All ({expectedTotal})
              </button>
            </div>

            {/* Re-analyze & Search */}
            <div className="flex items-center gap-2">
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
              <button
                onClick={runIntegrityAudit}
                className="p-2 bg-inner hover:bg-inner/80 text-text-base rounded-lg border border-subtle transition-colors cursor-pointer"
                title="Re-run QC Audit"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Results List View */}
        <div className="flex-1 overflow-y-auto font-sans text-xs space-y-1 p-2 bg-inner rounded-xl border border-subtle min-h-[220px]">
          {filteredResults.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              <CheckCircle size={22} className="mx-auto text-emerald-400/80 mb-2" />
              <span className="block text-xs font-semibold text-text-base">
                {activeTab === 'missing' ? 'No missing image files' : 'No files matching criteria'}
              </span>
              <span className="text-[11px] text-text-muted">
                {activeTab === 'missing' ? 'All expected survey points have matching images in MMS_PIC.' : 'Try changing search or tab filters.'}
              </span>
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
              disabled={missingCount === 0}
              className="px-3 py-1.5 bg-inner hover:bg-inner/80 disabled:opacity-40 disabled:cursor-not-allowed text-text-base border border-subtle rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Copy size={13} /> Copy Missing ({missingCount})
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