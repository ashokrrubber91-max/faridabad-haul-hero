# Fix incorrect “number already exists” error

## Confirmed cause
Recent backend logs show the new mobile numbers were rejected because the entered password is known to be weak. The account-creation code currently treats every 422 response as a duplicate number, so it displays the wrong message and then repeats the same failure for any number.

## Changes
1. Update admin account creation to run leftover-account recovery only when the backend specifically returns `email_exists`.
2. Return a clear password-strength message when the backend rejects a weak or leaked password; preserve the real duplicate-number message for genuine duplicates.
3. Apply the same clear password error handling to admin password reset, without weakening the backend’s password protection.
4. Keep all existing account roles, phone-number login alias behavior, incomplete-account recovery, and audit records unchanged.

## Verification
- Run type checking, lint, and the production build.
- Test account creation from the admin screen with a fresh number and a strong generated password.
- Confirm a weak password shows the password warning rather than “number already exists.”
- Confirm a genuinely existing number still shows the duplicate-number message and the page remains usable.
