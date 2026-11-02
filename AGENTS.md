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
- Ride alerts (driver pop-up and push) share one pure matcher: online, KYC-approved, same zone, same catalogue vehicle type; a live sequential-dispatch offer stays exclusive, and only a missing dispatch table falls back to matched drivers. Realtime channels bind only published tables, because one missing table rejects the whole channel.
- Booking offers and review share one parent-owned discount state and one typed wallet-balances query so cash and coins cannot collide in the query cache.
- Keep co-loading planning separate from assignment and financial writes; never enable pooled acceptance before atomic backend run/capacity/payment safeguards exist.
- Goods-photo/audio drafts remain local until a dedicated private booking-attachment capability is installed; never repurpose KYC or delivery-proof storage, silently discard drafts, or embed media URLs in notes.
- Account sync treats a profile-read failure as non-fatal once roles load, and the driver feed falls back to the RLS-guarded bookings read when the open-jobs RPC is absent, so profile or schema gaps never block the job feed.

- The ride-lifecycle load simulation (scripts/ride-lifecycle-sim.ts) is offline and in-memory, mirroring the sequential-dispatch SQL rules and reusing the shared matcher, because the preview and live app share one backend and load tests must never write real bookings.

- The full-flow integration runner (scripts/full-flow-test.ts, `bun run test:full-flow`) is in-memory like the ride simulation, because the preview and live app share one backend; it must never seed accounts, approve KYC or write bookings.
