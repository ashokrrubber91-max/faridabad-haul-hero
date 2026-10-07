import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WHATSAPP_APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
const GRAPH_VERSION = Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "v23.0";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function verifyMetaSignature(req: Request, rawBody: string) {
  if (!WHATSAPP_APP_SECRET) return true; // Keep webhook usable until the app secret is configured.
  const header = req.headers.get("x-hub-signature-256") ?? "";
  if (!header.startsWith("sha256=")) return false;
  const expected = header.slice(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WHATSAPP_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const actual = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return actual === expected;
}

async function whatsappMediaUrl(mediaId: string) {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } },
  );
  if (!res.ok) throw new Error(`WhatsApp media lookup failed: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

async function transcribeAudio(mediaId: string) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const mediaUrl = await whatsappMediaUrl(mediaId);
  const media = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  if (!media.ok) throw new Error(`WhatsApp audio download failed: ${media.status}`);
  const bytes = await media.arrayBuffer();
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: media.headers.get("content-type") ?? "audio/ogg" }), "whatsapp.ogg");
  form.append("model", "whisper-1");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI transcription failed: ${res.status}`);
  const data = await res.json();
  return String(data.text ?? "");
}

async function analyzeImage(mediaId: string, caption: string) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const mediaUrl = await whatsappMediaUrl(mediaId);
  const media = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  if (!media.ok) throw new Error(`WhatsApp image download failed: ${media.status}`);
  const bytes = new Uint8Array(await media.arrayBuffer());
  const mime = media.headers.get("content-type") ?? "image/jpeg";
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const dataUrl = `data:${mime};base64,${btoa(binary)}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text:
              "You are a logistics intake assistant. Describe only visible cargo/material information useful for a MiniPort booking. Do not invent weight. If the photo does not show a reliable weight, say weight is unknown. " +
              (caption ? `Customer caption: ${caption}` : ""),
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
        ],
      }],
      max_tokens: 300,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI vision failed: ${res.status}`);
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content ?? "");
}

async function extractBookingDetails(text: string) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You extract MiniPort logistics booking details. Return ONLY JSON with keys pickup, drop, vehicle, goods_type, weight_kg, distance_km, scheduled_for. Never invent pickup/drop. weight_kg and distance_km may be null. vehicle must be one of tata_ace, pickup_8ft, tata_407 or null. scheduled_for must be ISO string or null.",
        },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI extraction failed: ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}

async function sendWhatsAppText(to: string, message: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return;
  await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    },
  );
}

serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Not Found", { status: 404 });

  const rawBody = await req.text();
  if (!(await verifyMetaSignature(req, rawBody))) return new Response("Invalid signature", { status: 401 });

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("OK", { status: 200 });
  }

  const value = body.entry?.[0]?.changes?.[0]?.value;
  const message = value?.messages?.[0];
  if (!message) return new Response("OK", { status: 200 });

  const fromNumber = String(message.from ?? "");
  if (!fromNumber) return new Response("OK", { status: 200 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Meta retries webhook deliveries. Ignore a message that already created a booking.
  const { data: duplicate } = await supabase
    .from("bookings")
    .select("id")
    .eq("whatsapp_message_id", String(message.id ?? ""))
    .maybeSingle();
  if (duplicate) return new Response("OK", { status: 200 });

  let parsedText = "";
  try {
    if (message.type === "audio") {
      parsedText = await transcribeAudio(message.audio.id);
    } else if (message.type === "image") {
      parsedText = await analyzeImage(message.image.id, message.image.caption ?? "");
    } else if (message.type === "text") {
      parsedText = String(message.text?.body ?? "");
    } else {
      await sendWhatsAppText(fromNumber, "Please send text, a voice note, or a cargo photo with your MiniPort booking details.");
      return new Response("OK", { status: 200 });
    }

    const bookingData = await extractBookingDetails(parsedText);
    if (!bookingData.pickup || !bookingData.drop) {
      await sendWhatsAppText(
        fromNumber,
        "🚚 MiniPort: Please send both pickup and drop location. You can also share the pickup/drop WhatsApp location pin.",
      );
      return new Response("OK", { status: 200 });
    }

    const last10 = normalizePhone(fromNumber);
    const { data: profile } = await supabase
      .from("profiles")
      .select("id,name,phone")
      .in("phone", [fromNumber, last10, `+91${last10}`])
      .limit(1)
      .maybeSingle();

    const vehicleType = ["tata_ace", "pickup_8ft", "tata_407"].includes(bookingData.vehicle)
      ? bookingData.vehicle
      : "tata_ace";

    const { data: vehicle } = await supabase
      .from("vehicle_types")
      .select("id,base_fare,per_km_fare")
      .eq("id", vehicleType)
      .eq("active", true)
      .maybeSingle();

    const distanceKm = Number(bookingData.distance_km ?? 0);
    const fare = vehicle
      ? Math.round(Number(vehicle.base_fare) + Number(vehicle.per_km_fare) * distanceKm)
      : 0;

    const { data: trip, error } = await supabase
      .from("bookings")
      .insert({
        customer_id: profile?.id ?? null,
        customer_phone: fromNumber,
        pickup_address: String(bookingData.pickup),
        drop_address: String(bookingData.drop),
        vehicle_type: vehicleType,
        distance_km: distanceKm,
        fare,
        status: "pending",
        payment_method: "cod",
        payment_status: "pending",
        booking_source: "whatsapp_ai",
        whatsapp_message_id: String(message.id ?? ""),
        notes: [
          bookingData.goods_type ? `Goods: ${bookingData.goods_type}` : "",
          bookingData.weight_kg ? `Weight: ${bookingData.weight_kg} kg` : "",
          parsedText.slice(0, 300),
        ].filter(Boolean).join(" · ").slice(0, 500),
        scheduled_for: bookingData.scheduled_for ?? null,
      })
      .select("id,pickup_address,drop_address,vehicle_type,fare,status")
      .single();

    if (error || !trip) {
      console.error("[whatsapp-ai-agent] booking insert failed", error);
      await sendWhatsAppText(fromNumber, "Sorry, MiniPort could not create the booking right now. Please try again.");
      return new Response("OK", { status: 200 });
    }

    // The existing driver screen subscribes to public.bookings. Inserting the row
    // therefore produces an immediate Postgres Changes event for eligible drivers,
    // while the admin console's bookings subscription refreshes its live monitor.
    const reply =
      `🚚 *MiniPort Booking Received!*

📍 Pickup: ${trip.pickup_address}
🎯 Drop: ${trip.drop_address}
🚛 Vehicle: ${vehicleType}
💰 Estimated fare: ₹${Number(trip.fare).toFixed(0)}

We are assigning nearby drivers in Faridabad now. Please keep MiniPort open for live updates.`;

    await sendWhatsAppText(fromNumber, reply);
  } catch (error) {
    console.error("[whatsapp-ai-agent] processing error", error);
    await sendWhatsAppText(fromNumber, "MiniPort could not process that message right now. Please send the pickup and drop again.");
  }

  return new Response("OK", { status: 200 });
});