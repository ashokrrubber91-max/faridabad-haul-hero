import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Phone verification for MiniPort sign-up and sign-in.
 *
 * The one-time code is created, delivered and checked by Twilio Verify. It is
 * never returned to the browser, never logged and never stored by MiniPort.
 * User-facing messages are deliberately generic so nothing about the provider
 * or about which numbers already have an account leaks out.
 */

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

function normalise(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return INDIAN_MOBILE.test(digits) ? digits : null;
}

function loginEmail(phone: string): string {
  return `${phone}@miniport.app`;
}

const startSchema = z.object({
  phone: z.string().min(1),
  intent: z.enum(["signin", "signup"]),
});

export const startPhoneOtp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => startSchema.parse(input))
  .handler(async ({ data }) => {
    const phone = normalise(data.phone);
    if (!phone) {
      return { ok: false as const, message: "Enter a valid 10-digit Indian mobile number." };
    }

    const { isVerifyConfigured, startVerification } = await import("@/lib/twilio-verify.server");
    if (!isVerifyConfigured()) {
      return {
        ok: false as const,
        message:
          "Number verification is not switched on for this app yet, so no code could be sent.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { throttleSend, findUserByEmail } = await import("@/lib/phone-auth.server");

    const existing = await findUserByEmail(supabaseAdmin, loginEmail(phone));
    if (data.intent === "signup" && existing) {
      return {
        ok: false as const,
        message: "This number already has a MiniPort account. Please sign in instead.",
      };
    }
    if (data.intent === "signin" && !existing) {
      return {
        ok: false as const,
        message: "No MiniPort account uses this number yet. Please sign up first.",
      };
    }

    const gate = await throttleSend(supabaseAdmin, phone);
    if (!gate.allowed) {
      return {
        ok: false as const,
        message:
          gate.reason === "cooldown"
            ? `Please wait ${gate.retryAfterSeconds} seconds before asking for another code.`
            : "Too many code requests for this number. Please try again later.",
      };
    }

    const result = await startVerification(`+91${phone}`);
    if (result.outcome === "sent") return { ok: true as const };
    if (result.outcome === "too_many_attempts") {
      return {
        ok: false as const,
        message: "Too many code requests for this number. Please try again later.",
      };
    }
    if (result.outcome === "not_configured") {
      return {
        ok: false as const,
        message:
          "Number verification is not switched on for this app yet, so no code could be sent.",
      };
    }
    return {
      ok: false as const,
      message: "We could not send the code right now. Please try again in a moment.",
    };
  });

const verifySchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(4).max(10),
  intent: z.enum(["signin", "signup"]),
  name: z.string().trim().min(2).max(60).optional(),
  acceptedTerms: z.boolean().optional(),
});

export const verifyPhoneOtp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => verifySchema.parse(input))
  .handler(async ({ data }) => {
    const phone = normalise(data.phone);
    if (!phone) {
      return { ok: false as const, message: "Enter a valid 10-digit Indian mobile number." };
    }
    if (data.intent === "signup" && (!data.acceptedTerms || !data.name)) {
      return {
        ok: false as const,
        message: "Please enter your name and accept the Terms & Conditions and Privacy Policy.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { registerCheck, clearAttempts, findUserByEmail, issueSessionToken } = await import(
      "@/lib/phone-auth.server"
    );
    const { checkVerification } = await import("@/lib/twilio-verify.server");

    if (!(await registerCheck(supabaseAdmin, phone))) {
      return {
        ok: false as const,
        message: "Too many incorrect codes for this number. Please try again later.",
      };
    }

    const result = await checkVerification(`+91${phone}`, data.code.replace(/\D/g, ""));
    if (result.outcome !== "approved") {
      const message =
        result.outcome === "expired"
          ? "That code has expired. Please ask for a new one."
          : result.outcome === "too_many_attempts"
            ? "Too many incorrect codes for this number. Please try again later."
            : result.outcome === "not_configured"
              ? "Number verification is not switched on for this app yet."
              : result.outcome === "invalid_code"
                ? "That code is not correct. Please check and try again."
                : "We could not check that code right now. Please try again in a moment.";
      return { ok: false as const, message };
    }

    const email = loginEmail(phone);
    let user = await findUserByEmail(supabaseAdmin, email);

    if (!user) {
      if (data.intent === "signin") {
        return {
          ok: false as const,
          message: "No MiniPort account uses this number yet. Please sign up first.",
        };
      }
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID() + crypto.randomUUID(),
        // The database decides the role: every new account starts as a customer.
        user_metadata: { phone, name: data.name },
      });
      if (error || !created?.user) {
        console.error(`Account creation failed: ${error?.message ?? "unknown"}`);
        return {
          ok: false as const,
          message: "We could not finish creating your account. Please try again.",
        };
      }
      user = { id: created.user.id };
    }

    const tokenHash = await issueSessionToken(supabaseAdmin, email);
    if (!tokenHash) {
      return {
        ok: false as const,
        message: "We could not sign you in right now. Please try again in a moment.",
      };
    }

    await clearAttempts(supabaseAdmin, phone);
    return { ok: true as const, tokenHash, isNewAccount: !data.acceptedTerms ? false : true };
  });
