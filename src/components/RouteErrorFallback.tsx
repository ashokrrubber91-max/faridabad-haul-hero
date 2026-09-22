import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportLovableError } from "@/lib/lovable-error-reporting";

/**
 * Screen-level fallback. Used as a route `errorComponent` so a single screen that
 * fails to render or load its data shows a recoverable message instead of taking
 * the whole app down.
 */
export function RouteErrorFallback({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error(normalized);
    reportLovableError(normalized, { boundary: "route_error_fallback" });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle className="h-8 w-8 text-muted-foreground" aria-hidden />
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          This screen didn&apos;t load
        </h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Something went wrong while loading this part of MiniPort. Your bookings and account are
          safe — try again, or go back to the home screen.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          onClick={() => {
            router.invalidate();
            reset();
          }}
        >
          Try again
        </Button>
        <Button variant="outline" onClick={() => router.navigate({ to: "/" })}>
          Go home
        </Button>
      </div>
    </div>
  );
}
