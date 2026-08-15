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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
      <div className="flex min-h-100 w-full flex-col items-center justify-center p-6 text-foreground">
        <Card className="w-full max-w-xl border border-white/8 shadow-xl">
          <CardHeader>
            <div className="col-span-1 flex min-w-0 items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/15 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-lg">
                  Something went wrong in the workspace UI
                </CardTitle>
                <CardDescription className="mt-1">
                  An unhandled rendering error occurred. The error has been
                  captured and logged to observability.
                </CardDescription>
                {errorId && (
                  <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-white/8 bg-white/5 px-2.5 py-1 text-xs text-white/60">
                    <span>Error Ref:</span>
                    <span className="font-semibold text-white">{errorId}</span>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="border-t border-white/8 pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={this.toggleDetails}
                className="w-full justify-between px-0 text-white/60 hover:bg-transparent hover:text-white"
              >
                <span>Technical Error Details</span>
                {showDetails ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>

              {showDetails && (
                <div className="mt-3 space-y-2">
                  <div className="overflow-x-auto rounded-lg border border-destructive/20 bg-white/5 p-3 text-xs text-destructive">
                    <p className="font-semibold">
                      {error?.name}: {error?.message}
                    </p>
                    {error?.stack && (
                      <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-white/60">
                        {error.stack}
                      </pre>
                    )}
                  </div>
                  {errorInfo?.componentStack && (
                    <div className="overflow-x-auto rounded-lg border border-white/8 bg-white/5 p-2.5 text-[11px] text-white/60">
                      <p className="mb-1 font-medium text-white">
                        Component Stack:
                      </p>
                      <pre className="leading-tight whitespace-pre-wrap">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>

          <CardFooter>
            <Button type="button" onClick={this.handleReset}>
              <RefreshCw data-icon="inline-start" />
              Try Again / Reload View
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                window.location.href = "/";
              }}
            >
              <Home data-icon="inline-start" />
              Return to Home
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={this.handleCopyDetails}
            >
              {copied ? (
                <>
                  <Check data-icon="inline-start" className="text-primary" />
                  Copied
                </>
              ) : (
                <>
                  <Copy data-icon="inline-start" />
                  Copy Error Log
                </>
              )}
            </Button>
          </CardFooter>
        </Card>
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
