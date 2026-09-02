import { useState, useEffect } from 'react';
import { ShieldAlert, ShieldCheck, X, Search, RefreshCw, CheckCircle, AlertTriangle, Copy, FileText, Loader2 } from 'lucide-react';
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

  return (
    <div role="dialog" aria-modal="true" aria-label="QC Integrity Audit" className="fixed inset-0 bg-[var(--modal-overlay)] flex items-center justify-center z-[1000] p-4 backdrop-blur-md">
      <div className="bg-card border border-subtle rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">

        {/* Header */}
        <div className="flex justify-between items-start pb-4 mb-4 border-b border-subtle shrink-0">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-inner border border-subtle text-text-base">
                {missingCount > 0 ? <ShieldAlert size={20} className="text-rose-400" /> : <ShieldCheck size={20} className="text-emerald-400" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-text-base tracking-wide flex items-center gap-2">
                  QC Integrity Audit &bull; Subgrid [{subgrid}]
                </h2>
                <span className="text-xs text-text-muted">Verifying panorama file availability in Supabase MMS_PIC storage</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Audit Metrics Summary Grid */}
        <div className="grid grid-cols-3 gap-3 mb-4 shrink-0">
          <div className="bg-card border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">POI Metadata Points</span>
            <span className="text-xl font-extrabold text-text-base font-sans mt-0.5 block">{expectedTotal.toLocaleString()}</span>
            <span className="text-[10px] text-text-muted">Expected survey track</span>
          </div>
          <div className="bg-card border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Available in MMS_PIC</span>
            <span className="text-xl font-extrabold text-emerald-400 font-sans mt-0.5 block">{availableCount.toLocaleString()}</span>
            <span className="text-[10px] text-text-muted">Uploaded image frames</span>
          </div>
          <div className="bg-card border border-subtle p-3 rounded-xl">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Missing Images</span>
            <span className={`text-xl font-extrabold font-sans mt-0.5 block ${missingCount > 0 ? 'text-rose-400' : 'text-text-base'}`}>{missingCount.toLocaleString()}</span>
            <span className={`text-[10px] ${missingCount > 0 ? 'text-rose-400/80' : 'text-text-muted'}`}>{missingCount > 0 ? 'Upload required' : '100% Matched'}</span>
          </div>
        </div>

        {/* Progress Bar during Analysis */}
        {isAnalyzing ? (
          <div className="bg-card border border-subtle p-5 rounded-xl mb-4 shrink-0 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-sky-400 flex items-center gap-2">
                <Loader2 size={15} className="animate-spin text-sky-400" />
                Analyzing MMS_PIC storage bucket files...
              </span>
              <span className="text-text-base font-sans">{progress}%</span>
            </div>
            <div className="w-full bg-inner h-2 rounded-full overflow-hidden p-0.5">
              <div
                className="bg-gradient-to-r from-sky-500 to-emerald-400 h-full rounded-full transition-all duration-75 shadow-[0_0_8px_rgba(56,189,248,0.4)]"
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
            <div className="flex bg-card p-1 rounded-xl border border-subtle text-xs font-medium">
              <button
                onClick={() => setActiveTab('missing')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'missing' ? 'bg-inner text-rose-400 border border-subtle font-semibold shadow-sm' : 'text-text-muted hover:text-text-base'}`}
              >
                <AlertTriangle size={13} className="text-rose-400" />
                Missing Only ({missingCount})
              </button>
              <button
                onClick={() => setActiveTab('available')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'available' ? 'bg-inner text-emerald-400 border border-subtle font-semibold shadow-sm' : 'text-text-muted hover:text-text-base'}`}
              >
                <CheckCircle size={13} className="text-emerald-400" />
                Available ({availableCount})
              </button>
              <button
                onClick={() => setActiveTab('all')}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${activeTab === 'all' ? 'bg-inner text-text-base border border-subtle font-semibold shadow-sm' : 'text-text-muted hover:text-text-base'}`}
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
                  className="pl-8 pr-3 py-1.5 bg-card border border-subtle rounded-lg text-xs text-text-base placeholder-text-muted focus:outline-none focus:border-subtle"
                />
              </div>
              <button
                onClick={runIntegrityAudit}
                className="p-2 bg-inner hover:bg-inner text-text-base rounded-lg border border-subtle transition-colors cursor-pointer"
                title="Re-run QC Audit"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Results List View */}
        <div className="flex-1 overflow-y-auto font-sans text-xs space-y-1 p-2.5 bg-card rounded-xl border border-subtle min-h-[220px]">
          {filteredResults.length === 0 ? (
            <div className="py-12 text-center text-text-muted">
              <CheckCircle size={24} className="mx-auto text-emerald-400 mb-2 opacity-70" />
              <span className="block text-xs font-semibold text-text-base">
                {activeTab === 'missing' ? 'No missing image files!' : 'No files matching criteria'}
              </span>
              <span className="text-[11px] text-text-muted">
                {activeTab === 'missing' ? 'All expected POI survey points have matching images in MMS_PIC.' : 'Try changing search or tab filters.'}
              </span>
            </div>
          ) : (
            filteredResults.map((item) => (
              <div
                key={item.index}
                className="flex items-center justify-between px-3 py-2 bg-card hover:bg-card border border-subtle hover:border-subtle rounded-lg transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-text-muted text-[10px] w-10 font-sans">#{String(item.index).padStart(4, '0')}</span>
                  {/* Clean white/slate text for filenames */}
                  <span className="font-sans text-xs font-medium text-text-base">
                    {item.filename}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {item.isMissing ? (
                    <span className="px-2 py-0.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-md text-[10px] font-medium font-sans flex items-center gap-1">
                      <AlertTriangle size={10} />
                      MISSING FROM MMS_PIC
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-md text-[10px] font-medium font-sans flex items-center gap-1">
                      <CheckCircle size={10} />
                      AVAILABLE
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
              className="px-3.5 py-2 bg-inner hover:bg-inner disabled:opacity-40 disabled:cursor-not-allowed text-text-base border border-subtle rounded-xl text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Copy size={13} /> Copy Missing List ({missingCount})
            </button>
            <button
              onClick={exportQCReport}
              className="px-3.5 py-2 bg-inner hover:bg-inner text-text-base border border-subtle rounded-xl text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer"
            >
              <FileText size={13} /> Export QC Report (.txt)
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-text-base rounded-xl text-xs font-semibold transition-all shadow-md cursor-pointer"
          >
            Close QC Tool
          </button>
        </div>

      </div>
    </div>
  );
}

export default QCAuditModal;