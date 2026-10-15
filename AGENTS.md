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
