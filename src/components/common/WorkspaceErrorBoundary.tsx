import React from 'react';

interface WorkspaceErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string;
}

interface WorkspaceErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class WorkspaceErrorBoundary extends React.Component<WorkspaceErrorBoundaryProps, WorkspaceErrorBoundaryState> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('WorkspaceErrorBoundary caught an error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: WorkspaceErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
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
    return this.props.children;
  }
}