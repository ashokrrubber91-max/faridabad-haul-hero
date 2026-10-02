import { KycReviewTab } from "./KycReviewTab";

export function KYCReviewPanel({ driverId }: { driverId?: string }) {
  return <KycReviewTab driverId={driverId} />;
}
