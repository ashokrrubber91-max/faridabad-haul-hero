# Fix "account already exists" for a number that isn't in the records

## What I found
- The number 8375800791 has **no profile** in the app's records (checked).
- But the login system still holds a sign-in entry for `8375800791@miniport.app` — a leftover from an earlier attempt (e.g. a half-finished creation or a removed account). That leftover blocks creating the account again.

## Fix
1. **Confirm the leftover** from the admin server side (look up the sign-in entry by that email and check whether it has a profile/role).
2. **Update "Create account"** so when the number already has a sign-in entry:
   - If a real, complete account exists (has a profile) -> keep today's message "already exists, find it in the list".
   - If it's a leftover with no profile -> reuse it: set the new temporary password, name, phone and chosen role, create the profile, and log it in the admin audit as "create (restored)". The admin sees a normal "account created" success.
3. **Accounts list**: show leftover entries clearly as "Incomplete account" so they are never invisible.
4. Retry creating Gori / 8375800791 from the admin screen and confirm it works and can sign in with the temporary password.

## Technical details
- `src/lib/admin.functions.ts` `adminCreateAccount`: on `email_exists`/422, find user via `supabaseAdmin.auth.admin.listUsers` (match email), check `profiles` row; if missing -> `updateUserById` (password, metadata, unban), upsert `profiles`, replace `user_roles`, driver_profiles upsert for drivers, audit insert.
- `adminListAccounts`: flag accounts with no profile row (`incomplete: true`); badge in `AccountManagementTab.tsx`.
- No database schema changes; admin-only check stays first.
