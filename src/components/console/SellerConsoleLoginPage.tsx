import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/api/client';
import { Eye, EyeOff, AlertCircle, RefreshCw, ArrowLeft } from 'lucide-react';

interface SellerConsoleLoginPageProps {
  onLoginSuccess: (session: any) => void;
  onBackToApp?: () => void;
}

/**
 * Super Admin Console Login Page (`/console/login`).
 *
 * Designed as a strict, clean black & white enterprise portal for platform
 * administrators and operator partners. Completely isolated from the main
 * app theme settings. Upon successful authentication, delegates to the caller
 * to transition to `/console/dashboard`.
 */
export const SellerConsoleLoginPage: React.FC<SellerConsoleLoginPageProps> = ({
  onLoginSuccess,
  onBackToApp
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Isolate page from app-wide theme & neumorphic rules
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    const prevSurface = root.getAttribute('data-surface');

    root.removeAttribute('data-theme');
    root.removeAttribute('data-surface');

    return () => {
      if (prevTheme) root.setAttribute('data-theme', prevTheme);
      else root.removeAttribute('data-theme');
      if (prevSurface) root.setAttribute('data-surface', prevSurface);
      else root.removeAttribute('data-surface');
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        setErrorMessage(error.message || 'Invalid administrator credentials.');
        setIsLoading(false);
        return;
      }

      if (data?.session) {
        onLoginSuccess(data.session);
      } else {
        setErrorMessage('Authentication succeeded but no active session was returned.');
        setIsLoading(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || 'An unexpected error occurred during console login.');
      setIsLoading(false);
    }
  };

  return (
    <div
      id="seller-console-login-root"
      style={{
        backgroundColor: '#0c0d0e',
        color: '#ffffff',
        colorScheme: 'dark',
        minHeight: '100vh',
        width: '100vw'
      }}
      className="flex flex-col items-center justify-center p-6 select-none font-sans antialiased relative overflow-hidden"
    >
      {/* Subtle Monochrome Ambient Glow */}
      <div
        style={{
          background: 'radial-gradient(circle, rgba(255,255,255,0.04) 0%, rgba(12,13,14,0) 70%)',
          width: '600px',
          height: '600px',
          borderRadius: '9999px',
          pointerEvents: 'none'
        }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      />

      <div className="w-full max-w-[390px] z-10 flex flex-col items-center">
        {/* Top Brand Mark */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 flex items-center justify-center mb-3.5 shrink-0">
            <img
              src="/branding/geosphere-arrow-icon-white.svg"
              alt="GeoSphere 360"
              className="w-10 h-10 object-contain select-none"
              draggable={false}
            />
          </div>
          <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-1.5">
            <span>Super Admin Console</span>
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-1 leading-relaxed">
            Multi-Tenant Infrastructure &amp; Security Portal
          </p>
        </div>

        {/* Clean Monochrome Card */}
        <div
          style={{
            backgroundColor: '#ffffff',
            borderColor: '#edf0f4',
            color: '#0f172a',
            colorScheme: 'light',
            borderRadius: '20px'
          }}
          className="w-full p-8 border shadow-2xl"
        >
          <div className="mb-6 pb-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-900 tracking-tight">Console Access</h2>
              <p className="text-[11px] text-slate-500 font-medium mt-0.5">Authorized administrators only</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5">
                Admin Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@geosphere.my"
                style={{
                  backgroundColor: '#f8fafc',
                  borderColor: '#e2e8f0',
                  color: '#0f172a',
                  WebkitTextFillColor: '#0f172a',
                  caretColor: '#0f172a',
                  colorScheme: 'light',
                  boxShadow: 'none',
                  borderRadius: '10px'
                }}
                className="w-full px-3.5 py-2.5 text-xs text-slate-900 border focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all placeholder-slate-400 font-medium"
              />
            </div>

            {/* Password Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-bold text-slate-800">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 cursor-pointer transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  style={{
                    backgroundColor: '#f8fafc',
                    borderColor: '#e2e8f0',
                    color: '#0f172a',
                    WebkitTextFillColor: '#0f172a',
                    caretColor: '#0f172a',
                    colorScheme: 'light',
                    boxShadow: 'none',
                    borderRadius: '10px'
                  }}
                  className="w-full pl-3.5 pr-10 py-2.5 text-xs text-slate-900 border focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all placeholder-slate-400 font-medium"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Error Message Banner */}
            {errorMessage && (
              <div
                style={{ borderRadius: '10px' }}
                className="p-3 bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2"
              >
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-rose-600" />
                <span className="leading-tight font-medium">{errorMessage}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              style={{
                backgroundColor: '#0c0d0e',
                color: '#ffffff',
                borderRadius: '10px',
                boxShadow: 'none'
              }}
              className="w-full py-2.5 px-4 text-xs font-bold hover:bg-black active:scale-[0.99] disabled:opacity-60 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              {isLoading ? (
                <>
                  <RefreshCw size={13} className="animate-spin text-white" />
                  <span>Authenticating...</span>
                </>
              ) : (
                <span>Sign In to Console</span>
              )}
            </button>
          </form>

          {/* Return to GeoSphere 360 */}
          {onBackToApp && (
            <div className="mt-6 pt-4 border-t border-slate-100 text-center">
              <button
                type="button"
                onClick={onBackToApp}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 font-semibold transition-colors cursor-pointer group"
              >
                <ArrowLeft size={13} className="transition-transform group-hover:-translate-x-0.5" />
                <span>Return to GeoSphere 360</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SellerConsoleLoginPage;
