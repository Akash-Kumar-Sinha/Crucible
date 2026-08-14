"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Home,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { captureClientError } from "./lib/error-reporter";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void, errorId: string) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo, errorId: string) => void;
  componentName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string | null;
  copied: boolean;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      copied: false,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const errorId = captureClientError(error, {
      component: this.props.componentName || "ErrorBoundary",
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });

    this.setState({
      errorInfo,
      errorId,
    });

    if (this.props.onError) {
      this.props.onError(error, errorInfo, errorId);
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
      copied: false,
      showDetails: false,
    });
  };

  handleCopyDetails = (): void => {
    const { error, errorInfo, errorId } = this.state;
    const textToCopy = `Crucible Error ID: ${errorId || "unknown"}\nMessage: ${error?.message || "Unknown error"}\nStack:\n${error?.stack || "No stacktrace"}\nComponent Stack:\n${errorInfo?.componentStack || "No component stack"}`;

    navigator.clipboard.writeText(textToCopy).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    const { hasError, error, errorInfo, errorId, copied, showDetails } =
      this.state;
    const { children, fallback } = this.props;

    if (!hasError) {
      return children;
    }

    if (fallback && error && errorId) {
      return fallback(error, this.handleReset, errorId);
    }

    return (
      <div className="flex min-h-[400px] w-full flex-col items-center justify-center p-6 text-foreground">
        <div className="w-full max-w-xl rounded-xl border border-border/80 bg-card p-6 shadow-xl backdrop-blur-md">
          {/* Header icon and title */}
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-destructive/15 text-destructive border border-destructive/30">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                Something went wrong in the workspace UI
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                An unhandled rendering error occurred. The error has been
                captured and logged to observability.
              </p>
              {errorId && (
                <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-xs font-mono text-muted-foreground border border-border/40">
                  <span>Error Ref:</span>
                  <span className="font-semibold text-foreground">
                    {errorId}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again / Reload View
            </button>

            <a
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Home className="h-4 w-4 text-muted-foreground" />
              Return to Home
            </a>

            <button
              onClick={this.handleCopyDetails}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-none"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy Error Log</span>
                </>
              )}
            </button>
          </div>

          {/* Collapsible technical details */}
          <div className="mt-5 border-t border-border/50 pt-4">
            <button
              onClick={this.toggleDetails}
              className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>Technical Error Details</span>
              {showDetails ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            {showDetails && (
              <div className="mt-3 space-y-2">
                <div className="rounded-md bg-muted/80 p-3 font-mono text-xs text-destructive border border-destructive/20 overflow-x-auto">
                  <p className="font-semibold">
                    {error?.name}: {error?.message}
                  </p>
                  {error?.stack && (
                    <pre className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {error.stack}
                    </pre>
                  )}
                </div>
                {errorInfo?.componentStack && (
                  <div className="rounded-md bg-muted/50 p-2.5 font-mono text-[11px] text-muted-foreground border border-border/40 overflow-x-auto">
                    <p className="font-medium text-foreground mb-1">
                      Component Stack:
                    </p>
                    <pre className="whitespace-pre-wrap leading-tight">
                      {errorInfo.componentStack}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export function withErrorBoundary<P extends object>(
  ComponentToWrap: React.ComponentType<P>,
  componentName?: string,
): React.FC<P> {
  return function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary
        componentName={
          componentName || ComponentToWrap.displayName || ComponentToWrap.name
        }
      >
        <ComponentToWrap {...props} />
      </ErrorBoundary>
    );
  };
}
