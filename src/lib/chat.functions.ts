import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  role: z.enum(["customer", "driver"]),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
});

export const sendSupportChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    // Build grounded context for the assistant
    const { supabase, userId } = context;
    let contextBlock = "";
    if (data.role === "customer") {
      const { data: bk } = await supabase
        .from("bookings")
        .select("id,status,pickup_address,drop_address,fare,vehicle_type,driver_id,created_at,pickup_otp,drop_otp")
        .eq("customer_id", userId)
        .order("created_at", { ascending: false })
        .limit(3);
      contextBlock = `Recent bookings (JSON): ${JSON.stringify(bk ?? [])}`;
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [{ data: mine }, { data: wallet }, { data: tiers }] = await Promise.all([
        supabase
          .from("bookings")
          .select("id,status,fare,driver_net_earning,created_at,updated_at,payment_method")
          .eq("driver_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("wallet_accounts").select("cash_balance,coins_balance").eq("user_id", userId).maybeSingle(),
        supabase.from("driver_incentive_config").select("rides_required,bonus_amount,label").order("rides_required"),
      ]);
      const doneToday = (mine ?? []).filter(
        (b) => b.status === "completed" && new Date(b.updated_at ?? b.created_at) >= today,
      );
      contextBlock = `Today's completed rides: ${doneToday.length}. Wallet: ${JSON.stringify(wallet)}. Incentive tiers: ${JSON.stringify(tiers)}. Recent jobs: ${JSON.stringify(mine ?? [])}`;
    }

    const system =
      data.role === "customer"
        ? `You are Miniport Support — a helpful, concise chatbot for a mini-truck booking app in Faridabad, India. Answer in the user's language (Hindi/English/Hinglish). Use the live context to give specific answers about their booking, driver ETA, fare, or refund. For serious issues (accident, safety, fraud, refund dispute) say you are connecting them to the Faridabad support team. Keep replies under 4 short sentences. Never invent trip data.`
        : `You are Miniport Driver Support — a helpful bilingual (Hindi/English/Hinglish) chatbot for driver partners in Faridabad. Use the live context to answer about incentives, wallet, commission, and job flow. Commission is 10% of fare. Incentive tiers: 5 rides = ₹50, 10 rides = ₹200. Bonus credits at 12:00 AM. Keep replies under 4 short sentences. For emergencies (accident, medical) tell them to call 112 and say support is being alerted.`;

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3.5-flash");

    const { text } = await generateText({
      model,
      messages: [
        { role: "system", content: `${system}\n\nLive context:\n${contextBlock}` },
        ...data.messages,
      ],
    });

    return { reply: text };
  });
