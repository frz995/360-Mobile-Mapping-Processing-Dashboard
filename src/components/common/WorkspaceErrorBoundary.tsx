import React from 'react';
import { captureException } from '../../lib/sentry';

interface WorkspaceErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string;
}

interface WorkspaceErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryStamp: number;
  retryCount: number;
  retrying: boolean;
}

const MAX_CHUNK_RETRIES = 3;
const CHUNK_RETRY_DELAY_MS = 800;

/**
 * Detect a failed React.lazy dynamic import (stale hashed chunk name after a
 * deploy, flaky network, transient 404). Webpack and Vite emit distinct
 * messages per browser; matching them lets us auto-retry instead of showing a
 * hard error card for recoverable failures.
 */
function isChunkImportError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  if (
    /failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /loading chunk \d+ failed/i.test(msg) ||
    /chunkloaderror/i.test(msg)
  ) {
    return true;
  }
  if (error && typeof error === 'object' && 'name' in error) {
    return (error as { name?: string }).name === 'ChunkLoadError';
  }
  return false;
}

export class WorkspaceErrorBoundary extends React.Component<WorkspaceErrorBoundaryProps, WorkspaceErrorBoundaryState> {
  private _retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryStamp: 0, retryCount: 0, retrying: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('WorkspaceErrorBoundary caught an error:', error, errorInfo);
    captureException(error, { workspace: 'unknown', errorInfo: String(errorInfo?.componentStack || '') });

    // Auto-recover recoverable dynamic-import failures (e.g. stale hashed chunk
    // after a deploy): re-keying the subtree re-runs the lazy import().
    if (isChunkImportError(error) && this.state.retryCount < MAX_CHUNK_RETRIES) {
      if (this._retryTimer !== null) clearTimeout(this._retryTimer);
      this.setState({ retrying: true });
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        const retry = this.state.retryCount + 1;
        this.setState((prev) => ({
          hasError: false,
          error: null,
          retrying: false,
          retryStamp: prev.retryStamp + 1,
          retryCount: retry
        }));
      }, CHUNK_RETRY_DELAY_MS * (this.state.retryCount + 1));
    }
  }

  componentDidUpdate(prevProps: WorkspaceErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null, retrying: false });
    }
  }

  componentWillUnmount() {
    if (this._retryTimer !== null) clearTimeout(this._retryTimer);
    this._retryTimer = null;
  }

  handleRetry = () => {
    if (this._retryTimer !== null) clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this.setState((prev) => ({ hasError: false, error: null, retrying: false, retryStamp: prev.retryStamp + 1 }));
  };

  render() {
    if (this.state.hasError) {
      if (this.state.retrying) {
        return (
          <div className="flex-1 flex flex-col items-center justify-center min-h-[16rem] p-4 animate-in fade-in duration-300">
            <div className="bg-card border border-subtle rounded-2xl px-6 py-5 max-w-sm w-full text-center" role="status">
              <h2 className="text-sm font-bold text-text-base uppercase tracking-wide mb-1">
                Reconnecting workspace…
              </h2>
              <p className="text-xs text-text-muted break-words">
                {this.state.error?.message || 'A workspace module failed to load. Retrying automatically…'}
              </p>
            </div>
          </div>
        );
      }

      return (
        <div className="flex-1 flex flex-col items-center justify-center min-h-[16rem] p-4 animate-in fade-in duration-300">
          <div className="bg-card border border-subtle rounded-2xl p-6 max-w-sm w-full shadow-md text-center" role="alert">
            <h2 className="text-sm font-bold text-text-base uppercase tracking-wide mb-1.5">
              This workspace could not be rendered
            </h2>
            <p className="text-xs text-text-muted mb-4 break-words">
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleRetry}
                className="px-3 py-1.5 bg-inner hover:bg-inner text-text-base border border-subtle rounded-lg text-xs font-medium cursor-pointer transition-colors"
              >
                Retry workspace
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
              >
                Reload dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Re-keying the subtree on retry forces React to unmount/remount the lazy
    // boundary, which re-runs the failed dynamic import().
    return <React.Fragment key={this.state.retryStamp}>{this.props.children}</React.Fragment>;
  }
}