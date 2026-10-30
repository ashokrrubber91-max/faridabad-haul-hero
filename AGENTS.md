<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Keep customer live ride search/tracking in the dedicated searching route; use the existing owner-scoped booking and live-location data to avoid duplicate booking state.
- Same-booking vehicle recovery uses the restricted database RPC, never a direct client vehicle/fare update, to preserve financial integrity.
- Ride-history cards open the shared trip dialog with optional page-owned actions so invoice, rating and tracking workflows remain available.
- Repeat bookings use validated router search and owner-scoped reads; missing historic coordinates are geocoded instead of replaced with a default pickup pin.
- Delivery proof is fetched on demand from private storage with short-lived signed URLs, keeping evidence out of initial history requests.
- Optional sequential-dispatch push uses a narrow local schema boundary and skips only missing-table errors; never broaden recipients or edit generated live types to mask unapplied migrations.
- Booking offers and review share one parent-owned discount state and one typed wallet-balances query so cash and coins cannot collide in the query cache.
- Keep co-loading planning separate from assignment and financial writes; never enable pooled acceptance before atomic backend run/capacity/payment safeguards exist.
- Goods-photo/audio drafts remain local until a dedicated private booking-attachment capability is installed; never repurpose KYC or delivery-proof storage, silently discard drafts, or embed media URLs in notes.
- Account sync treats a profile-read failure as non-fatal once roles load, and the driver feed falls back to the RLS-guarded bookings read when the open-jobs RPC is absent, so profile or schema gaps never block the job feed.
