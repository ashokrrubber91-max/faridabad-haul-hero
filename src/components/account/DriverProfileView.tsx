import type { ReactNode } from "react";

export function DriverProfileView({ children }: { children: ReactNode }) {
  return <div data-profile-view="driver">{children}</div>;
}
