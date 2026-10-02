import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withErrorLogging } from "@/lib/error-logger";

const input = z.object({
  amount: z.number().finite().positive().max(200000),
  method: z.enum(["upi", "bank"]).default("upi"),
  upiId: z.string().trim().max(120).nullable().default(null),
  bankAccountId: z.string().uuid().nullable().default(null),
});

export const createInstantDriverPayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value) => input.parse(value))
  .handler(({ data, context }) => withErrorLogging(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("kyc_status")
      .eq("id", context.userId)
      .maybeSingle();
    if (profile?.kyc_status !== "approved") throw new Error("Driver verification must be approved before payout.");

    if (data.method === "upi" && !data.upiId) throw new Error("Enter a UPI ID.");
    if (data.method === "bank" && !data.bankAccountId) throw new Error("Select a bank account.");

    const { data: payout, error: reserveError } = await context.supabase.rpc("reserve_driver_payout", {
      _amount: data.amount,
      _method: data.method,
      _upi_id: data.upiId,
      _bank_account_id: data.bankAccountId,
    });
    if (reserveError) throw new Error(reserveError.message);
    const row = Array.isArray(payout) ? payout[0] : payout;
    if (!row?.id) throw new Error("Could not reserve payout.");

    const keyId = process.env.RAZORPAYX_KEY_ID;
    const keySecret = process.env.RAZORPAYX_KEY_SECRET;
    const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER;
    if (!keyId || !keySecret || !accountNumber) {
      await supabaseAdmin.rpc("settle_driver_payout", {
        _payout_id: row.id,
        _status: "failed",
        _error: "RazorpayX payout credentials are not configured",
      });
      throw new Error("Instant payout is not configured yet. Add RazorpayX payout credentials.");
    }

    let fundAccount: Record<string, unknown>;
    if (data.method === "upi") {
      fundAccount = { account_type: "vpa", vpa: { address: data.upiId } };
    } else {
      const { data: bank } = await context.supabase
        .from("driver_bank_accounts")
        .select("account_holder,account_number,ifsc,bank_name")
        .eq("id", data.bankAccountId!)
        .eq("driver_id", context.userId)
        .maybeSingle();
      if (!bank) throw new Error("Bank account not found.");
      fundAccount = {
        account_type: "bank_account",
        bank_account: {
          name: bank.account_holder,
          ifsc: bank.ifsc,
          account_number: bank.account_number,
        },
      };
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/payouts", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_number: accountNumber,
        fund_account: fundAccount,
        amount: Math.round(data.amount * 100),
        currency: "INR",
        mode: data.method === "upi" ? "UPI" : "IMPS",
        purpose: "payout",
        queue_if_low_balance: true,
        reference_id: row.id,
        narration: "MiniPort driver wallet payout",
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.id) {
      await context.supabase.rpc("settle_driver_payout", {
        _payout_id: row.id,
        _status: "failed",
        _error: String(body?.error?.description ?? body?.message ?? "RazorpayX payout failed").slice(0, 500),
      });
      throw new Error(String(body?.error?.description ?? body?.message ?? "RazorpayX payout failed"));
    }

    const { error: settleError } = await supabaseAdmin.rpc("settle_driver_payout", {
      _payout_id: row.id,
      _status: "paid",
      _provider_payout_id: body.id,
      _error: null,
    });
    if (settleError) throw new Error(settleError.message);

    return { ok: true, payoutId: body.id, amount: data.amount };
  }, { source: "razorpayx", action: "createInstantDriverPayout" }));
