/**
 * The MiniPort WhatsApp assistant.
 *
 * Every inbound message is already stored in `whatsapp_messages` before this
 * runs, so processing is retry-safe. Here we decide what the message means for
 * the sender's *verified* MiniPort role and act inside the existing rules:
 *
 *  - A WhatsApp message can never change a role, grant admin rights, assign a
 *    driver, move money or skip a payment. Those stay in the app/console.
 *  - A customer message becomes a booking DRAFT. The real booking is created
 *    only after the customer replies CONFIRM, and the fare always comes from the
 *    vehicle catalogue, never from the message.
 *  - A driver or ops message becomes a task for that same person (drivers can
 *    only ever get their own tasks).
 *  - Unknown numbers get a sign-up pointer and nothing is created.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { parseWhatsAppMessage, quickReplyIntent, type ParsedWhatsApp } from "@/lib/whatsapp-ai.server";

type Admin = SupabaseClient<Database>;
type Draft = Database["public"]["Tables"]["whatsapp_booking_drafts"]["Row"];

export type InboundMessage = {
  id: string;
  from_phone: string;
  body: string;
  latitude: number | null;
  longitude: number | null;
  user_id: string | null;
  sender_role: "customer" | "driver" | "admin" | null;
};

const HELP_CUSTOMER = `🚚 *MiniPort on WhatsApp*
Send your load details in one message, for example:
"Kal 10 baje ABC Trader Ballabhgarh se 500 kg rubber sheets pickup, drop Sector 25 Faridabad."

You can also share a WhatsApp location for an exact pickup or drop point.
I will send a summary — reply *CONFIRM* to book or *CANCEL* to drop it.`;

const HELP_DRIVER = `🚚 *MiniPort driver help*
• Send any note to save it as a job task, e.g. "Kal subah 8 baje Sector 21 se parcel uthana hai".
• Send *JOBS* to see your current trips.
• Send *TASKS* to see your open tasks.
Emergency: dial 112.`;

const HELP_ADMIN = `🚚 *MiniPort ops help*
• Send any note to create an ops task, e.g. "Check driver Ramesh KYC documents today".
• Send *TASKS* for open ops tasks.
• Send *TODAY* for today's trip summary.
Driver assignment, fares and payouts stay in the admin console.`;

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function istTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ---------------------------------------------------------------- customer */

function draftSummary(draft: Draft): string {
  const lines = [
    "🚚 *MiniPort booking request*",
    "",
    `Pickup: ${draft.pickup_address ?? "—"}`,
    `Drop: ${draft.drop_address ?? "—"}`,
    `When: ${istTime(draft.scheduled_at) ?? draft.schedule_text ?? "As soon as possible"}`,
  ];
  if (draft.material) lines.push(`Material: ${draft.material}`);
  if (draft.quantity) lines.push(`Quantity: ${draft.quantity}`);
  if (draft.weight_kg) lines.push(`Approx. weight: ${draft.weight_kg} kg`);
  if (draft.dimensions) lines.push(`Dimensions: ${draft.dimensions}`);
  lines.push(`Vehicle: ${draft.vehicle_type ?? "Not selected yet"}`);
  if (draft.distance_km) lines.push(`Distance: ${Number(draft.distance_km).toFixed(1)} km`);
  if (draft.quoted_fare) lines.push(`Estimated fare: ${inr(Number(draft.quoted_fare))} (cash on delivery)`);
  if (draft.instructions) lines.push(`Note: ${draft.instructions}`);
  lines.push("", "Reply *CONFIRM* to book, *CANCEL* to drop it, or send corrections.");
  return lines.join("\n");
}

function askForMissing(missing: string[]): string {
  const ask: Record<string, string> = {
    pickup_address: "the pickup address (or share the pickup location)",
    drop_address: "the drop address (or share the drop location)",
  };
  const list = missing.map((m) => ask[m] ?? m).join(" and ");
  return `Please send ${list} so I can prepare your booking. Nothing is booked yet.`;
}

async function pickVehicle(admin: Admin, hint: string | null, weightKg: number | null) {
  const { data: vehicles } = await admin
    .from("vehicle_types")
    .select("id,label,base_fare,per_km_fare,weight_limit_kg,payload_kg,sort_order")
    .eq("active", true)
    .order("sort_order");
  const list = vehicles ?? [];
  if (list.length === 0) return null;

  if (hint) {
    const needle = hint.toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = list.find(
      (v) =>
        v.id.replace(/[^a-z0-9]/g, "") === needle ||
        v.label.toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle),
    );
    if (match) return match;
  }
  if (weightKg) {
    const fit = list.find((v) => (v.weight_limit_kg ?? v.payload_kg ?? 0) >= weightKg);
    if (fit) return fit;
  }
  return null;
}

async function upsertDraft(
  admin: Admin,
  message: InboundMessage,
  parsed: ParsedWhatsApp,
  existing: Draft | null,
): Promise<{ draft: Draft | null; reply: string }> {
  const { geocodeAddressServer, reverseGeocodeServer } = await import("@/lib/geocode.server");
  const { computeRoadRouteServer } = await import("@/lib/routing.server");

  const patch: Database["public"]["Tables"]["whatsapp_booking_drafts"]["Update"] = {
    customer_id: message.user_id!,
    source_message_id: message.id,
  };

  const merge = <K extends keyof Draft>(key: K, value: Draft[K] | null) => {
    if (value !== null && value !== undefined && value !== "") {
      (patch as Record<string, unknown>)[key as string] = value;
    }
  };

  merge("material", parsed.material);
  merge("quantity", parsed.quantity);
  merge("weight_kg", parsed.weight_kg);
  merge("dimensions", parsed.dimensions);
  merge("instructions", parsed.instructions);
  merge("schedule_text", parsed.schedule_text);
  merge("scheduled_at", parsed.scheduled_at);

  // Written addresses are resolved to real coordinates; an address we cannot
  // resolve is still kept as text so the customer can correct it.
  for (const side of ["pickup", "drop"] as const) {
    const written = side === "pickup" ? parsed.pickup_address : parsed.drop_address;
    if (!written) continue;
    (patch as Record<string, unknown>)[`${side}_address`] = written;
    const hit = await geocodeAddressServer(written);
    if (hit) {
      (patch as Record<string, unknown>)[`${side}_address`] = hit.address;
      (patch as Record<string, unknown>)[`${side}_lat`] = hit.lat;
      (patch as Record<string, unknown>)[`${side}_lng`] = hit.lng;
    }
  }

  // A shared WhatsApp location fills the first point that has no coordinates.
  if (message.latitude !== null && message.longitude !== null) {
    const pickupSet = (patch.pickup_lat ?? existing?.pickup_lat) !== null;
    const side = pickupSet ? "drop" : "pickup";
    (patch as Record<string, unknown>)[`${side}_lat`] = message.latitude;
    (patch as Record<string, unknown>)[`${side}_lng`] = message.longitude;
    const readable = await reverseGeocodeServer(message.latitude, message.longitude);
    (patch as Record<string, unknown>)[`${side}_address`] =
      readable ?? `Shared location ${message.latitude.toFixed(5)}, ${message.longitude.toFixed(5)}`;
  }

  const merged = { ...(existing ?? {}), ...patch } as Draft;

  const vehicle = await pickVehicle(admin, parsed.vehicle_hint, merged.weight_kg ? Number(merged.weight_kg) : null);
  if (vehicle) patch.vehicle_type = vehicle.id;

  // Distance and fare only when both real points are known — never estimated.
  const hasBoth =
    merged.pickup_lat != null &&
    merged.pickup_lng != null &&
    merged.drop_lat != null &&
    merged.drop_lng != null;
  if (hasBoth && vehicle) {
    try {
      const route = await computeRoadRouteServer([
        { lat: Number(merged.pickup_lat), lng: Number(merged.pickup_lng) },
        { lat: Number(merged.drop_lat), lng: Number(merged.drop_lng) },
      ]);
      patch.distance_km = Number(route.distanceKm.toFixed(2));
      patch.quoted_fare = Math.round(
        Number(vehicle.base_fare) + Number(vehicle.per_km_fare) * route.distanceKm,
      );
    } catch (e) {
      console.error("[whatsapp] routing unavailable:", e);
    }
  }

  const missing: string[] = [];
  if (!(patch.pickup_address ?? existing?.pickup_address)) missing.push("pickup_address");
  if (!(patch.drop_address ?? existing?.drop_address)) missing.push("drop_address");
  patch.missing_fields = missing;
  patch.status = missing.length === 0 ? "awaiting_confirmation" : "collecting";

  const saved = existing
    ? await admin.from("whatsapp_booking_drafts").update(patch).eq("id", existing.id).select().single()
    : await admin
        .from("whatsapp_booking_drafts")
        .insert(patch as Database["public"]["Tables"]["whatsapp_booking_drafts"]["Insert"])
        .select()
        .single();

  if (saved.error || !saved.data) {
    console.error("[whatsapp] draft save failed:", saved.error?.message);
    return { draft: null, reply: "Sorry, I could not save your request. Please send it again." };
  }

  return {
    draft: saved.data,
    reply: missing.length === 0 ? draftSummary(saved.data) : askForMissing(missing),
  };
}

async function confirmDraft(admin: Admin, draft: Draft): Promise<string> {
  if (!draft.pickup_address || !draft.drop_address) {
    return askForMissing(draft.missing_fields.length ? draft.missing_fields : ["pickup_address"]);
  }
  if (!draft.vehicle_type || draft.distance_km == null) {
    await admin
      .from("ops_tasks")
      .insert({
        scope: "admin",
        title: "WhatsApp booking needs manual pricing",
        details: `Customer confirmed a WhatsApp request but the route or vehicle could not be priced automatically.\nPickup: ${draft.pickup_address}\nDrop: ${draft.drop_address}\nMaterial: ${draft.material ?? "—"}`,
        priority: "high",
        source: "whatsapp",
        source_message_id: draft.source_message_id,
      });
    return "Your request is confirmed, but I could not price the route automatically. Our Faridabad team will call you shortly to finish the booking.";
  }

  const { data: vehicle } = await admin
    .from("vehicle_types")
    .select("id,label,base_fare,per_km_fare")
    .eq("id", draft.vehicle_type)
    .eq("active", true)
    .maybeSingle();
  if (!vehicle) return "That vehicle is not available right now. Please open the MiniPort app to pick another one.";

  // Fare is recomputed from the catalogue at confirmation time — the message
  // never sets the price.
  const distance = Number(draft.distance_km);
  const fare = Math.round(Number(vehicle.base_fare) + Number(vehicle.per_km_fare) * distance);

  const { data: booking, error } = await admin
    .from("bookings")
    .insert({
      customer_id: draft.customer_id,
      pickup_address: draft.pickup_address,
      drop_address: draft.drop_address,
      pickup_lat: draft.pickup_lat,
      pickup_lng: draft.pickup_lng,
      drop_lat: draft.drop_lat,
      drop_lng: draft.drop_lng,
      vehicle_type: vehicle.id,
      distance_km: distance,
      fare,
      status: "pending",
      payment_method: "cod",
      payment_status: "pending",
      notes: [draft.material, draft.quantity, draft.dimensions, draft.instructions]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500),
    })
    .select("id, fare")
    .single();

  if (error || !booking) {
    console.error("[whatsapp] booking insert failed:", error?.message);
    await admin
      .from("whatsapp_booking_drafts")
      .update({ status: "failed" })
      .eq("id", draft.id);
    return "I could not create the booking just now. Please try again from the MiniPort app or reply and our team will help.";
  }

  await admin
    .from("whatsapp_booking_drafts")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString(), booking_id: booking.id })
    .eq("id", draft.id);

  return `✅ Booking confirmed — ${booking.id.slice(0, 8).toUpperCase()}
Vehicle: ${vehicle.label}
Distance: ${distance.toFixed(1)} km
Fare: ${inr(Number(booking.fare))} (cash on delivery)

We are finding a driver now. You will get the driver's name, vehicle number and live tracking in the MiniPort app.`;
}

async function handleCustomer(admin: Admin, message: InboundMessage): Promise<string> {
  const { data: openDraft } = await admin
    .from("whatsapp_booking_drafts")
    .select("*")
    .eq("customer_id", message.user_id!)
    .in("status", ["collecting", "awaiting_confirmation"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const quick = quickReplyIntent(message.body);
  if (quick === "confirm" && openDraft?.status === "awaiting_confirmation") {
    return confirmDraft(admin, openDraft);
  }
  if (quick === "cancel" && openDraft) {
    await admin
      .from("whatsapp_booking_drafts")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", openDraft.id);
    return "Request dropped. Nothing was booked. Send new details whenever you are ready.";
  }

  if (/^\s*(help|menu|hi|hello|start)\s*$/i.test(message.body)) return HELP_CUSTOMER;

  if (/^\s*(status|my trip|mera trip|booking status)\s*$/i.test(message.body)) {
    const { data: trips } = await admin
      .from("bookings")
      .select("id,status,pickup_address,drop_address,fare,created_at")
      .eq("customer_id", message.user_id!)
      .order("created_at", { ascending: false })
      .limit(3);
    if (!trips || trips.length === 0) return "You have no MiniPort trips yet.";
    return trips
      .map(
        (t) =>
          `${t.id.slice(0, 8).toUpperCase()} — ${t.status}\n${t.pickup_address} → ${t.drop_address}\n${inr(Number(t.fare))}`,
      )
      .join("\n\n");
  }

  const parsed = await parseWhatsAppMessage(
    message.body,
    "customer",
    openDraft
      ? {
          pickup_address: openDraft.pickup_address,
          drop_address: openDraft.drop_address,
          material: openDraft.material,
          weight_kg: openDraft.weight_kg,
          scheduled_at: openDraft.scheduled_at,
        }
      : null,
    new Date().toISOString(),
  );

  const hasLocation = message.latitude !== null && message.longitude !== null;
  const bookingish =
    parsed.intent === "booking_request" || parsed.intent === "edit" || hasLocation || !!openDraft;
  if (!bookingish) return HELP_CUSTOMER;

  const { reply } = await upsertDraft(admin, message, parsed, openDraft ?? null);
  return reply;
}

/** ------------------------------------------------------- driver and ops */

async function listTasks(admin: Admin, userId: string, scope: "driver" | "admin"): Promise<string> {
  const query = admin
    .from("ops_tasks")
    .select("id,title,status,priority,due_at")
    .eq("scope", scope)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(10);
  const { data } = scope === "driver" ? await query.eq("assigned_to", userId) : await query;
  if (!data || data.length === 0) return "No open tasks right now.";
  return `📋 Open tasks\n\n${data
    .map(
      (t, i) =>
        `${i + 1}. ${t.title}${t.priority === "high" ? " (high)" : ""}${
          t.due_at ? ` — due ${istTime(t.due_at)}` : ""
        }`,
    )
    .join("\n")}`;
}

async function createTask(
  admin: Admin,
  message: InboundMessage,
  parsed: ParsedWhatsApp,
  scope: "driver" | "admin",
): Promise<string> {
  const title = (parsed.task_title ?? message.body).trim().slice(0, 120);
  if (!title) return "Please send the task in a few words so I can save it.";
  const { error } = await admin.from("ops_tasks").insert({
    scope,
    title,
    details: parsed.task_details ?? message.body.slice(0, 1000),
    priority: parsed.task_priority ?? "normal",
    assigned_to: scope === "driver" ? message.user_id : null,
    created_by: message.user_id,
    source: "whatsapp",
    source_message_id: message.id,
    due_at: parsed.scheduled_at ?? null,
  });
  if (error) {
    console.error("[whatsapp] task insert failed:", error.message);
    return "I could not save that task. Please send it again.";
  }
  return `✅ Task saved: ${title}${parsed.scheduled_at ? `\nDue: ${istTime(parsed.scheduled_at)}` : ""}\nSend *TASKS* to see your open list.`;
}

async function handleDriver(admin: Admin, message: InboundMessage): Promise<string> {
  const body = message.body.trim();
  if (/^\s*(help|menu|hi|hello)\s*$/i.test(body)) return HELP_DRIVER;
  if (/^\s*tasks?\s*$/i.test(body)) return listTasks(admin, message.user_id!, "driver");
  if (/^\s*(jobs?|rides?|trips?)\s*$/i.test(body)) {
    const { data } = await admin
      .from("bookings")
      .select("id,status,pickup_address,drop_address,driver_net_earning")
      .eq("driver_id", message.user_id!)
      .in("status", ["accepted", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(5);
    if (!data || data.length === 0)
      return "No active jobs right now. Open the MiniPort driver app to go online and receive requests.";
    return data
      .map(
        (b) =>
          `${b.id.slice(0, 8).toUpperCase()} — ${b.status}\nPickup: ${b.pickup_address}\nDrop: ${b.drop_address}`,
      )
      .join("\n\n");
  }

  const parsed = await parseWhatsAppMessage(body, "driver", null, new Date().toISOString());
  if (parsed.intent === "status_query") return HELP_DRIVER;
  return createTask(admin, message, parsed, "driver");
}

async function handleAdmin(admin: Admin, message: InboundMessage): Promise<string> {
  const body = message.body.trim();
  if (/^\s*(help|menu|hi|hello)\s*$/i.test(body)) return HELP_ADMIN;
  if (/^\s*tasks?\s*$/i.test(body)) return listTasks(admin, message.user_id!, "admin");
  if (/^\s*(today|summary|aaj)\s*$/i.test(body)) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { data } = await admin
      .from("bookings")
      .select("status")
      .gte("created_at", since.toISOString());
    const rows = data ?? [];
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return `📊 Today: ${rows.length} requests
Awaiting driver: ${count("pending")}
Running: ${count("accepted") + count("in_progress")}
Completed: ${count("completed")}
Cancelled: ${count("cancelled")}   Expired: ${count("expired")}

Driver assignment, fares and payouts stay in the admin console.`;
  }

  const parsed = await parseWhatsAppMessage(body, "admin", null, new Date().toISOString());
  if (parsed.intent === "status_query") return HELP_ADMIN;
  return createTask(admin, message, parsed, "admin");
}

/** ------------------------------------------------------------------ entry */

export async function handleInboundWhatsApp(
  admin: Admin,
  message: InboundMessage,
): Promise<{ reply: string; intent: string }> {
  if (!message.user_id || !message.sender_role) {
    return {
      reply: `This number is not registered with MiniPort. Please sign up in the MiniPort app with this mobile number first, then message us here.`,
      intent: "unknown_sender",
    };
  }

  if (message.sender_role === "admin") {
    return { reply: await handleAdmin(admin, message), intent: "ops" };
  }
  if (message.sender_role === "driver") {
    return { reply: await handleDriver(admin, message), intent: "driver" };
  }
  return { reply: await handleCustomer(admin, message), intent: "customer" };
}
