import type { ReactNode } from "react";

export function CustomerProfileView({ children }: { children: ReactNode }) {
  return <div data-profile-view="customer">{children}</div>;
}
