import React, { useState } from 'react';
import { Lock, ArrowRight } from 'lucide-react';
import { GeoSphereIcon } from '../components/common/GeoSphereLogo';

interface SharePasswordGateProps {
  shareTitle?: string;
  onUnlock: (password: string) => Promise<boolean>;
}

export function SharePasswordGate({ shareTitle, onUnlock }: SharePasswordGateProps) {
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!password || checking) return;
    setChecking(true);
    setError('');
    const ok = await onUnlock(password);
    setChecking(false);
    if (!ok) {
      setError('Incorrect password. Please try again.');
      setPassword('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(1200px 800px at 50% -10%, #16233a 0%, #0b1220 55%, #080d17 100%)' }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-700/60 bg-slate-900/90 backdrop-blur p-7 shadow-2xl"
      >
        <div className="flex items-center gap-2.5">
          <GeoSphereIcon size={34} />
          <span className="text-lg font-extrabold tracking-tight text-white">
            GeoSphere <span className="text-slate-300">360°</span>
          </span>
        </div>

        <div className="my-5 h-px bg-slate-700/60" />

        <div className="flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
            <Lock size={20} className="text-slate-200" />
          </div>
        </div>
        <h1 className="mt-4 text-center text-[17px] font-bold text-white">This shared map has a password</h1>
        <p className="mt-1.5 text-center text-[12.5px] leading-relaxed text-slate-400">
          Enter the password provided by the project team to view{' '}
          <span className="text-slate-200 font-medium">{shareTitle || 'the shared map'}</span> in read-only mode.
        </p>

        <label className="mt-5 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Password
        </label>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          placeholder="Type password"
          className="mt-1.5 w-full rounded-lg border border-slate-600 bg-slate-950/60 px-3.5 py-2.5 text-[13px] text-white placeholder-slate-600 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-500/25"
        />
        {error && <p className="mt-2 text-[11.5px] text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={!password || checking}
          className="mt-5 w-full flex items-center justify-center gap-2 rounded-lg bg-white text-slate-900 text-[13px] font-bold py-2.5 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {checking ? 'Verifying…' : (
            <>
              Continue
              <ArrowRight size={15} />
            </>
          )}
        </button>

        <p className="mt-5 text-center text-[10px] uppercase tracking-wider text-slate-500">
          GeoSphere 360 · Mobile Mapping Surveillance
        </p>
      </form>
    </div>
  );
}
