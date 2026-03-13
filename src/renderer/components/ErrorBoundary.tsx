/**
 * RhythmDesk Error Boundary - Phase 5 Stability Lockdown
 * 
 * React error boundary for catching renderer errors.
 * Prevents full application crash and provides recovery UI.
 */

import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    
    // Log error
    console.error('[ERROR] React Error Boundary caught error:', error);
    console.error('[ERROR] Component stack:', errorInfo.componentStack);
    
    // Notify IPC if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).electronAPI;
      api?.logError?.({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: Date.now(),
      });
    } catch {
      // IPC not available
    }
    
    // Call custom handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      // Default error UI
      return (
        <div style={styles.container}>
          <div style={styles.content}>
            <h2 style={styles.title}>Something went wrong</h2>
            <p style={styles.message}>
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            
            <div style={styles.actions}>
              <button
                style={styles.retryButton}
                onClick={this.handleRetry}
              >
                Try Again
              </button>
              <button
                style={styles.reloadButton}
                onClick={() => window.location.reload()}
              >
                Reload App
              </button>
            </div>
            
            {process.env.NODE_ENV === 'development' && this.state.error?.stack && (
              <details style={styles.details}>
                <summary style={styles.summary}>Error Details</summary>
                <pre style={styles.stack}>{this.state.error.stack}</pre>
                {this.state.errorInfo?.componentStack && (
                  <pre style={styles.stack}>{this.state.errorInfo.componentStack}</pre>
                )}
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '200px',
    padding: '20px',
  },
  content: {
    textAlign: 'center',
    maxWidth: '500px',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    marginBottom: '10px',
    color: '#dc3545',
  },
  message: {
    fontSize: '1rem',
    color: '#666',
    marginBottom: '20px',
  },
  actions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  retryButton: {
    padding: '10px 20px',
    fontSize: '1rem',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
  },
  reloadButton: {
    padding: '10px 20px',
    fontSize: '1rem',
    backgroundColor: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
  },
  details: {
    textAlign: 'left',
    marginTop: '20px',
  },
  summary: {
    cursor: 'pointer',
    color: '#666',
    marginBottom: '10px',
  },
  stack: {
    fontSize: '0.75rem',
    backgroundColor: '#f8f9fa',
    padding: '10px',
    borderRadius: '5px',
    overflow: 'auto',
    maxHeight: '200px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
};

export default ErrorBoundary;
