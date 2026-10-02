import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";

const LiveTripMap = lazy(() => import("./LiveTripMap").then((m) => ({ default: m.LiveTripMap })));

export function LazyLiveTripMap(props: ComponentProps<typeof import("./LiveTripMap").LiveTripMap>) {
  return (
    <Suspense fallback={<div className="mt-3 grid h-[240px] place-items-center rounded-md border bg-muted"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}>
      <LiveTripMap {...props} />
    </Suspense>
  );
}
