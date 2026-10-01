import { createFileRoute } from "@tanstack/react-router";
import { ReferralCard } from "@/components/referrals/ReferralCard";

export const Route = createFileRoute("/_authenticated/refer")({
  head: () => ({
    meta: [
      { title: "Refer & Earn — MiniPort" },
      {
        name: "description",
        content: "Invite customers and drivers to MiniPort and track referral rewards.",
      },
    ],
  }),
  component: ReferPage,
});

function ReferPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-3xl tracking-wide text-secondary">Refer & Earn</h1>
        <p className="text-sm text-muted-foreground">
          Invite customers or drivers using your MiniPort referral link.
        </p>
      </header>
      <ReferralCard />
    </div>
  );
}
