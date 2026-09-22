import { useState } from 'react';
import { Check, Copy, Globe2, KeyRound, Loader2, X } from 'lucide-react';
import { GeoSphereIcon } from '../components/common/GeoSphereLogo';
import { supabase } from '../services/api/client';
import {
  createShare,
  type ShareKind,
  type ShareSnapshot
} from '../utils/mapShares';

interface ShareMapDialogProps {
  open: boolean;
  kind: ShareKind;
  defaultTitle: string;
  buildSnapshot: () => ShareSnapshot | Promise<ShareSnapshot>;
  basemap?: string;
  createdBy?: string | null;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { value: '0', label: 'No expiry' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' }
];

const DotOption = ({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) => (
  <button type="button" onClick={onSelect} className="group flex items-center gap-1.5 cursor-pointer">
    <span className={`w-3 h-3 rounded-full border flex items-center justify-center transition-colors ${
      selected ? 'bg-accent border-accent' : 'border-subtle group-hover:border-slate-500'
    }`}>
      {selected && <Check className="w-2 h-2 text-app" strokeWidth={4} />}
    </span>
    <span className={`text-[11px] transition-colors ${selected ? 'font-medium text-text-base' : 'text-text-muted group-hover:text-text-base'}`}>
      {label}
    </span>
  </button>
);

export function ShareMapDialog({ open, kind, defaultTitle, buildSnapshot, basemap, createdBy, onClose }: ShareMapDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [expiresDays, setExpiresDays] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const reset = () => {
    setTitle(defaultTitle);
    setUsePassword(false);
    setPassword('');
    setExpiresDays('0');
    setBusy(false);
    setError('');
    setShareUrl('');
    setCopied(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const create = async () => {
    if (busy) return;
    if (usePassword && password.trim().length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      const effectiveCreatedBy = createdBy || sessionData?.session?.user?.id || null;
      const snapshot = await buildSnapshot();
      const { url } = await createShare({
        kind,
        title: title.trim() || defaultTitle,
        snapshot,
        basemap,
        password: usePassword ? password.trim() : null,
        expiresDays: Number(expiresDays) > 0 ? Number(expiresDays) : null,
        createdBy: effectiveCreatedBy
      });
      setShareUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the share link. Ensure the map_shares migration (0018) is applied.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed — select the link and copy manually.');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150" onClick={close}>
      <div
        className="w-full max-w-md bg-card border border-subtle rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-inner border border-subtle flex items-center justify-center">
              <GeoSphereIcon size={17} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-base">Share Map Link</h3>
              <p className="text-[10px] text-text-muted">
                {kind === 'road' ? 'Road analysis map · public read-only view' : 'WebGIS survey map · public read-only view'}
              </p>
            </div>
          </div>
          <button onClick={close} className="text-text-muted hover:text-text-base cursor-pointer p-1 rounded transition-colors" title="Close">
            <X size={16} />
          </button>
        </div>

        {shareUrl ? (
          /* Success — the link */
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-emerald-400 text-[12px] font-semibold">
              <Check size={15} />
              Share link created
            </div>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 bg-inner border border-subtle rounded-lg px-3 py-2 text-[11px] text-text-base"
              />
              <button
                onClick={copy}
                className="flex items-center gap-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition-colors cursor-pointer shrink-0"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-[10.5px] text-text-muted leading-relaxed">
              Anyone with this link can view the shared map{usePassword ? ' after entering the password' : ''}
              {Number(expiresDays) > 0 ? ` for ${expiresDays} days` : ' indefinitely'}.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={close} className="px-4 py-2 rounded-lg bg-inner border border-subtle text-[11px] font-semibold text-text-base hover:text-sky-400 transition-colors cursor-pointer">
                Done
              </button>
            </div>
          </div>
        ) : (
          /* Create form */
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Map title</label>
              <input
                value={title}
                onChange={(e) => { setTitle(e.target.value); setError(''); }}
                className="mt-1.5 w-full bg-inner border border-subtle rounded-lg px-3 py-2 text-[12px] text-text-base outline-none focus:border-sky-500/60 transition-colors"
                placeholder={defaultTitle}
              />
            </div>

            <div className="rounded-xl border border-subtle bg-inner/40 p-3.5 space-y-2">
              <DotOption
                label="Require password"
                selected={usePassword}
                onSelect={() => { setUsePassword((v) => !v); setError(''); }}
              />
              {usePassword && (
                <div className="relative">
                  <KeyRound size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  <input
                    type="text"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    placeholder="Viewer password (min 4 characters)"
                    className="w-full bg-inner border border-subtle rounded-lg pl-8 pr-3 py-2 text-[12px] text-text-base outline-none focus:border-sky-500/60 transition-colors"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Link validity</label>
              <div className="mt-2 flex items-center flex-wrap gap-x-3.5 gap-y-1.5 px-0.5">
                {EXPIRY_OPTIONS.map((opt) => (
                  <DotOption
                    key={opt.value}
                    label={opt.label}
                    selected={expiresDays === opt.value}
                    onSelect={() => { setExpiresDays(opt.value); setError(''); }}
                  />
                ))}
              </div>
            </div>

            {error && <p className="text-[11px] text-rose-400">{error}</p>}

            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="flex items-center gap-1.5 text-[10px] text-text-muted">
                <Globe2 size={12} />
                Opens on any browser · no login required
              </p>
              <div className="flex gap-2">
                <button onClick={close} className="px-3.5 py-2 rounded-lg bg-inner border border-subtle text-[11px] font-semibold text-text-base hover:text-sky-400 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button
                  onClick={create}
                  disabled={busy}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-[11px] font-bold transition-colors cursor-pointer"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Globe2 size={13} />}
                  {busy ? 'Creating…' : 'Create Link'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
