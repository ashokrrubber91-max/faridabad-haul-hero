# Twilio setup

MiniPort uses two Twilio products, both from server-only secrets:

- **Verify** delivers and checks the SMS one-time code used by phone sign-up
  and the SMS sign-in tab. MiniPort never creates, stores, logs, or returns an
  OTP.
- **Programmable Messaging** delivers queued customer and driver SMS alerts.

## Configure production

1. In the Twilio Console, create a **Verify Service** and enable the SMS
   channel. Apply any required India sender, template, consent, and regulatory
   configuration in Twilio before going live.
2. Obtain an SMS-capable Twilio sender number for alerts. Verify trial-account
   recipient numbers while the Twilio account remains in trial mode.
3. Add these values to **Lovable Secrets** (or the server deployment's secret
   store). Do not add them as `VITE_*` variables and do not put them in a
   committed `.env` file:

   ```text
   TWILIO_ACCOUNT_SID=AC...
   TWILIO_AUTH_TOKEN=...
   TWILIO_VERIFY_SERVICE_SID=VA...
   TWILIO_FROM_NUMBER=+...
   ```

4. Redeploy the server, then sign in as an administrator and confirm the
   **Phone verification** and **Customer SMS alerts** checks show **Ready**.
   The former requires the Verify service SID; the latter requires the sender
   number.
5. Test with a real permitted phone number: request one OTP, enter it once,
   then verify that a second attempt cannot reuse it. Also send a non-critical
   SMS alert and inspect its delivery status in Twilio.

## Security behaviour

- The app accepts Indian mobile numbers only and sends them to Verify in E.164
  form (`+91...`).
- A number has a 45-second resend cooldown, a five-send hourly cap, and is
  locally locked after six unsuccessful checks for 30 minutes. Twilio adds its
  own provider-side controls.
- A failed request is not counted locally, so a temporary Twilio/network error
  does not lock out a legitimate customer.
- `TWILIO_VERIFY_SERVICE_SID` is mandatory. MiniPort will not guess which
  Verify service in an account should authenticate customers.
