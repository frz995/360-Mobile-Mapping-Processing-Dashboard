import { createPortal } from 'react-dom';
import {
  ShieldAlert,
  X,
  Database,
  Loader2,
  AlertTriangle,
  Info,
  Lock,
  Trash2
} from 'lucide-react';
import type { DeletionImpact, DeletionMode } from '../../utils/deletionImpact';

export interface SafeDeleteModalProps {
  isOpen: boolean;
  deleteTarget: any;
  deleteMode: DeletionMode;
  impactData: DeletionImpact | null;
  isComputingImpact: boolean;
  willRequireApproval: boolean;
  expectedDeletePhrase: string;
  selectedRowCount?: number;
  spatialSubgridCount?: number;
  deleteConfirmText: string;
  setDeleteConfirmText: (val: string) => void;
  adminPasscode: string;
  setAdminPasscode: (val: string) => void;
  deleteError: string | null;
  setDeleteError: (val: string | null) => void;
  onConfirm: () => void;
  onClose: () => void;
  translate?: (key: string) => string;
}

export const SafeDeleteModal = ({
  isOpen,
  deleteTarget,
  deleteMode,
  impactData,
  isComputingImpact,
  willRequireApproval,
  expectedDeletePhrase,
  selectedRowCount = 0,
  spatialSubgridCount = 0,
  deleteConfirmText,
  setDeleteConfirmText,
  adminPasscode,
  setAdminPasscode,
  deleteError,
  setDeleteError,
  onConfirm,
  onClose,
  translate
}: SafeDeleteModalProps) => {
  if (!isOpen || !deleteTarget) return null;

  const tf = translate || ((k: string) => k);
  const impactTotals = impactData?.totals;
  const hasSevereImpact = !!(impactData && (impactData.hasPublished || impactData.hasDeliverables || impactData.hasLinkedJobs || impactData.hasOrphanRisk));

  const modalContent = (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 z-[9999] animate-fadeIn">
      <div className="bg-card border border-subtle rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden transform transition-all max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="bg-card border-b border-subtle p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-inner border border-subtle flex items-center justify-center text-text-base">
              <ShieldAlert size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text-base flex items-center gap-2">
                {willRequireApproval ? 'Deletion Request' : 'Admin Security Verification'}
              </h3>
              <p className="text-xs text-text-muted font-medium">
                {willRequireApproval ? 'Admin Authorization Required to Submit Deletion' : 'Permanent Database Deletion Authorization'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-base p-1 rounded-lg hover:bg-inner transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto min-h-0">
          {/* Impact Preview */}
          <div>
            <div className="font-semibold text-text-base mb-2.5 flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <Database size={14} className="text-sky-400" />
              {tf('dataImpactPreview')}
            </div>

            {isComputingImpact ? (
              <div className="flex items-center gap-2 text-xs text-text-muted py-6 justify-center">
                <Loader2 size={14} className="animate-spin text-sky-400" /> {tf('dataImpactComputing')}
              </div>
            ) : impactData && impactTotals ? (
              <div className="space-y-3">
                {/* 4 Clean Relevant KPI Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="bg-inner border border-subtle rounded-xl p-3">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                      {tf('dataImpactSubgrids')}
                    </div>
                    <div className="text-base font-bold text-text-base leading-none">
                      {impactTotals.subgrids} {impactTotals.subgrids === 1 ? 'subgrid' : 'subgrids'}
                    </div>
                  </div>

                  <div className="bg-inner border border-subtle rounded-xl p-3">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                      {tf('dataImpactPoi')}
                    </div>
                    <div className="text-base font-bold text-text-base leading-none">
                      {impactTotals.poi.toLocaleString()}
                    </div>
                  </div>

                  <div className="bg-inner border border-subtle rounded-xl p-3">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                      {tf('dataImpactKm')}
                    </div>
                    <div className="text-base font-bold text-text-base leading-none">
                      {impactTotals.km.toLocaleString()} km
                    </div>
                  </div>

                  <div className="bg-inner border border-subtle rounded-xl p-3">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
                      {tf('dataImpactPublished')}
                    </div>
                    <div className={`text-base font-bold leading-none ${impactTotals.published > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {impactTotals.published > 0 ? `${impactTotals.published} published` : 'Unpublished (Draft)'}
                    </div>
                  </div>
                </div>

                {/* Per-subgrid breakdown */}
                {impactData.rows.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-subtle max-h-[200px] overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-inner text-text-muted border-b border-subtle sticky top-0 font-medium text-[11px]">
                        <tr>
                          <th className="px-3 py-2">{tf('dataRegistryColSubgrid')}</th>
                          <th className="px-3 py-2 text-right">{tf('dataImpactRuns')}</th>
                          <th className="px-3 py-2 text-right">{tf('dataImpactPoi')}</th>
                          <th className="px-3 py-2 text-right">{tf('dataImpactKm')}</th>
                          <th className="px-3 py-2 text-right">{tf('dataImpactPublished')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impactData.rows.map((r) => (
                          <tr key={r.subgrid} className="border-t border-subtle hover:bg-inner/40 transition-colors">
                            <td className="px-3 py-2 font-mono text-text-base font-semibold">{r.subgrid}</td>
                            <td className="px-3 py-2 text-right text-text-muted">{r.runs}</td>
                            <td className="px-3 py-2 text-right text-text-base font-medium">{r.poi.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right text-text-muted">{r.km} km</td>
                            <td className={`px-3 py-2 text-right font-medium ${r.published > 0 ? 'text-rose-400' : 'text-text-muted'}`}>
                              {r.published > 0 ? `${r.published} published` : 'Unpublished'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Dependent-data warnings */}
                {hasSevereImpact ? (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 mb-1">
                      <AlertTriangle size={13} className="text-rose-400" />
                      {tf('dataImpactDependents')}
                    </div>
                    <ul className="text-[11px] text-rose-300 space-y-1 list-disc list-inside">
                      {impactData.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : impactData.warnings.length > 0 ? (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <ul className="text-[11px] text-amber-300 space-y-1 list-disc list-inside">
                      {impactData.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Security Warning */}
          <div className="bg-inner border border-subtle rounded-xl p-4 text-xs text-text-base leading-relaxed">
            <div className="font-semibold text-text-base mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wide">
              <AlertTriangle size={14} className={willRequireApproval ? 'text-amber-400' : 'text-rose-400'} />
              {willRequireApproval ? 'Security Warning: Admin Approval Required' : 'Security Warning: Permanent Deletion'}
            </div>
            {willRequireApproval ? (
              <>This action will <strong className="text-amber-400 font-medium">submit the deletion for Administrator approval</strong>. No database records are removed until an Administrator reviews and approves it in Administration → Approvals. Partial point selections are not part of this request and still delete immediately.</>
            ) : (
              <>This data will be <strong className="text-rose-400 font-medium">permanently removed</strong> from the database. This action cannot be reversed.</>
            )}
            {deleteMode === 'bulk' && (
              <div className="mt-3 p-3 bg-card rounded-lg border border-subtle text-xs space-y-1.5">
                <div className="flex justify-between items-center"><span className="text-text-muted">Target Selection:</span> <strong className="text-text-base font-semibold">Bulk Delete</strong></div>
                <div className="flex justify-between items-center"><span className="text-text-muted">Records Selected:</span> <span className="text-rose-400 font-bold">{selectedRowCount} records</span></div>
              </div>
            )}
            {deleteMode === 'spatial' && (
              <div className="mt-3 p-3 bg-card rounded-lg border border-subtle text-xs space-y-1.5">
                <div className="flex justify-between items-center"><span className="text-text-muted">Target Selection:</span> <strong className="text-text-base font-semibold">Map Spatial Selection</strong></div>
                <div className="flex justify-between items-center"><span className="text-text-muted">Subgrids Selected:</span> <span className="text-rose-400 font-bold">{spatialSubgridCount} subgrids</span></div>
              </div>
            )}
          </div>

          {/* Explicit Confirmation Input */}
          <div>
            <label className="text-xs font-medium text-text-base mb-2 flex items-center gap-1.5">
              <Info size={14} className="text-text-muted" />
              {tf('dataConfirmPhrase')}
            </label>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => {
                setDeleteConfirmText(e.target.value);
                if (deleteError) setDeleteError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirm();
              }}
              placeholder={expectedDeletePhrase}
              autoCapitalize="characters"
              spellCheck={false}
              className="w-full bg-inner border border-subtle focus:border-rose-500/70 rounded-xl px-4 py-2.5 text-sm font-mono text-text-base placeholder-text-muted focus:outline-none transition-all shadow-inner uppercase"
            />
            <p className="text-[11px] text-text-muted mt-1.5">
              {willRequireApproval
                ? <>Type the exact code below to authorize submitting this deletion request: <strong className="text-text-base font-mono">{expectedDeletePhrase}</strong></>
                : <>{tf('dataConfirmInstruction')} <strong className="text-text-base font-mono">{expectedDeletePhrase}</strong></>}
            </p>
          </div>

          {/* Admin Authorization Input */}
          <div>
            <label className="text-xs font-medium text-text-base mb-2 flex items-center gap-1.5">
              <Lock size={14} className="text-text-muted" />
              Enter User Auth Password to Confirm Deletion:
            </label>
            <div className="relative">
              <input
                type="password"
                value={adminPasscode}
                onChange={(e) => {
                  setAdminPasscode(e.target.value);
                  if (deleteError) setDeleteError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onConfirm();
                }}
                placeholder="Enter account password"
                className="w-full bg-inner border border-subtle focus:border-rose-500/70 rounded-xl px-4 py-2.5 text-sm text-text-base placeholder-text-muted focus:outline-none transition-all shadow-inner"
              />
            </div>
          </div>

          {/* Error Box */}
          {deleteError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start gap-2.5 text-xs text-rose-300 font-medium">
              <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              <span>{deleteError}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-card border-t border-subtle flex items-center justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-text-muted hover:text-text-base bg-inner hover:bg-inner/80 border border-subtle transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isComputingImpact || !impactData || deleteConfirmText.trim().toUpperCase() !== expectedDeletePhrase.toUpperCase() || !adminPasscode.trim()}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 border border-rose-500/40 transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} />
            {willRequireApproval ? 'Authorize & Submit Deletion' : 'Authorize & Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
};
