import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './themes.css';
import { initSentry, captureException, sentryReportSink } from './lib/sentry';
import { addReportSink, installReporters } from './lib/report';

initSentry();
installReporters();
addReportSink(sentryReportSink);

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React ErrorBoundary caught an error:', error, errorInfo);
    captureException(error, { errorInfo: String(errorInfo?.componentStack || '') });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-app)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '1rem', padding: '2rem', maxWidth: '28rem', width: '100%', boxShadow: 'var(--card-shadow)' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
              Dashboard Encountered an Error
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <button
              onClick={this.handleReset}
              style={{ width: '100%', backgroundColor: 'var(--accent)', color: '#ffffff', fontWeight: '600', padding: '0.625rem 1rem', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}
            >
              Reload Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootEl = document.getElementById('root')!;

const isShareRoute =
  window.location.pathname.startsWith('/share/') ||
  window.location.pathname === '/share' ||
  window.location.hash.startsWith('#/share/') ||
  window.location.hash === '#/share';

if (isShareRoute) {
  import('./share/SharedMapPage')
    .then(({ SharedMapPage }) => {
      ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
          <ErrorBoundary>
            <SharedMapPage />
          </ErrorBoundary>
        </React.StrictMode>,
      );
    })
    .catch((err) => {
      console.error('[SharedMapPage] Failed to load module:', err);
      ReactDOM.createRoot(rootEl).render(
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#e2e8f0', fontFamily: 'sans-serif' }}>
          <div style={{ textAlign: 'center', maxWidth: '400px', padding: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>Failed to load map viewer</h2>
            <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '1rem' }}>Please check your network connection and reload the page.</p>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '0.5rem 1rem', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', fontWeight: '600' }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    });
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

