import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logError } from "@/lib/error-logger";

type Props = { children: React.ReactNode; label?: string };
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    logError(error, { source: "unknown", context: { boundary: this.props.label ?? "react" } });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="surface-card my-4 p-5 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
        <h2 className="mt-2 font-display text-xl tracking-wide text-secondary">Something went wrong</h2>
        <p className="mt-1 text-sm text-muted-foreground">This section stopped unexpectedly. Your trip data is safe.</p>
        <Button className="mt-3" variant="outline" onClick={() => this.setState({ hasError: false })}>
          <RotateCcw className="h-4 w-4" /> Try again
        </Button>
      </div>
    );
  }
}
