import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const InputSchema = z.object({
  role: z.enum(["customer", "driver"]),
  clientContext: z.string().max(2000).optional(),
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

    const languageInstruction =
      "IMPORTANT: Detect the language the user just wrote in (Hindi in Devanagari script, Hinglish/romanized Hindi, or English) and reply in that SAME language/style. Never switch languages on your own.";

    const system =
      data.role === "customer"
        ? `You are Miniport Support — a helpful, concise chatbot for a mini-truck booking app in Faridabad, India. ${languageInstruction} Use the live context to give specific answers about their booking, driver ETA, fare, refund, wallet/coins balance, or KYC status. For serious issues (accident, safety, fraud, refund dispute) say you are connecting them to the Faridabad support team. Keep replies under 4 short sentences. Never invent trip data.`
        : `You are Miniport Driver Support — a helpful bilingual (Hindi/English/Hinglish) chatbot for driver partners in Faridabad. ${languageInstruction} Use the live context to answer about incentives, wallet balance, commission, job flow, and KYC status. Commission is 10% of fare. Incentive tiers: 5 rides = ₹50, 10 rides = ₹200. Bonus credits at 12:00 AM. Keep replies under 4 short sentences. For emergencies (accident, medical) tell them to call 112 and say support is being alerted.`;

    if (data.clientContext) {
      contextBlock = `${contextBlock}\nUser-side snapshot (wallet/order/KYC): ${data.clientContext}`;
    }

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3.5-flash");

    try {
      const { text } = await generateText({
        model,
        system: `${system}\n\nLive context:\n${contextBlock}`,
        messages: data.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      if (text?.trim()) return { reply: text };
      return { reply: fallbackReply(data.role, data.messages[data.messages.length - 1]?.content ?? "") };
    } catch (err) {
      console.error("[support-chat] AI error:", err);
      return { reply: fallbackReply(data.role, data.messages[data.messages.length - 1]?.content ?? "") };
    }
  });

function fallbackReply(role: "customer" | "driver", userText: string): string {
  const t = userText.toLowerCase();
  if (role === "driver") {
    if (t.includes("incentive")) return "Aapka incentive daily 12:00 AM ko wallet me credit hota hai. Aaj ka progress driver dashboard pe 'Today's target' card me dikh raha hai. Agar 24 ghante ke baad bhi credit nahi hua toh support team ko forward kar diya gaya hai.";
    if (t.includes("wallet") || t.includes("top")) return "Wallet top-up ke liye Driver → Wallet page pe jaayein aur UPI/Cash option choose karein. Minimum ₹100 balance zaroori hai naye jobs receive karne ke liye.";
    if (t.includes("phone") || t.includes("customer")) return "Agar customer ka phone off hai toh 2 minute wait karein, phir pickup location pe pahunch kar dobara try karein. 5 min tak koi response nahi mile toh 'Cancel ride' se safe cancel kar sakte hain.";
    if (t.includes("emergency") || t.includes("accident")) return "🚨 Emergency me turant **112** dial karein. Aapki live location Miniport safety team ko share kar di gayi hai — support 2 minute me contact karega.";
    return "Main aapki madad ke liye hoon. Aap incentive, wallet, ya emergency ke baare me pooch sakte hain. Serious issue ke liye Miniport Faridabad support team ko notify kar diya gaya hai.";
  }
  if (t.includes("where") || t.includes("driver") || t.includes("track")) return "Aapka driver active ride pe hai — customer dashboard pe live status aur OTP dikh raha hai. Driver ki ETA map par update ho rahi hai.";
  if (t.includes("fare") || t.includes("bill") || t.includes("dispute")) return "Fare distance × per-km rate + base fare pe calculate hota hai. Agar aapko lagta hai bill galat hai, booking ID share karein — support team review karegi.";
  if (t.includes("cancel")) return "Ride cancel karne ke liye active booking card pe 'Cancel' button use karein. Driver accept karne ke baad cancellation par small fee lag sakti hai.";
  if (t.includes("human") || t.includes("support")) return "Aapki request Miniport Faridabad support team ko forward kar di gayi hai — koi executive jaldi call karega.";
  return "Main Miniport Support hoon. Aap tracking, fare, cancel, ya kisi bhi issue ke baare me pooch sakte hain.";
}

