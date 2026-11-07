/**
 * Fully automated, zero-touch end-to-end ride flow test for MiniPort.
 *
 *   bun run test:full-flow [--users=10000] [--drivers=10000 --customers=20000] [--seed=7]
 *
 * Runs entirely in memory. The preview and the live app share one database, so
 * this runner never seeds real accounts, never approves real KYC and never
 * writes real bookings. Instead it stands up an in-memory "server" that mirrors
 * the app's server rules (admin-only KYC approval, verification gate before
 * going online, sequential 20 s single-driver offers within 7 km, idempotent
 * acceptance, server-generated pickup/drop OTPs, support tickets) and reuses the
 * app's real ride-alert matcher from src/lib/dispatch-match.ts.
 *
 * The "AI assistant" step is a deterministic playbook resolver standing in for
 * the support assistant, so runs are free, offline and repeatable.
 *
 * Exits with code 1 when any invariant fails.
 */
import { mkdir } from "node:fs/promises";
import { DEFAULT_SERVICE_ZONE, isRideAlertMatch } from "../src/lib/dispatch-match";

// ---------------------------------------------------------------- constants
const OFFER_TTL_S = 20;
const BOOKING_TTL_S = 30 * 60;
const DISPATCH_RADIUS_KM = 7;
const RETRY_INTERVAL_S = 10;
const MAX_OTP_ATTEMPTS = 5;
const MAX_NETWORK_RETRIES = 3;
const MAX_SIM_S = 6 * 60 * 60;

const VEHICLES = ["tata_ace", "three_wheeler", "pickup_8ft"] as const;
type Vehicle = (typeof VEHICLES)[number];

const HUBS = [
  { name: "Sector 74", lat: 28.3936, lng: 77.3524 },
  { name: "Tigaon Rd", lat: 28.388, lng: 77.36 },
  { name: "NIT", lat: 28.3925, lng: 77.3 },
  { name: "Ballabgarh", lat: 28.341, lng: 77.323 },
] as const;
type HubName = (typeof HUBS)[number]["name"];

// ---------------------------------------------------------------- args/rng
function arg(name: string, fallback: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const n = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
const USERS = arg("users", 10_000);
const DRIVER_COUNT = arg(
  "drivers",
  Math.max(VEHICLES.length * HUBS.length, Math.round(USERS * 0.3)),
);
const CUSTOMER_COUNT = arg("customers", Math.max(0, USERS - DRIVER_COUNT));
const SEED = arg("seed", 7);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const otp = () => String(between(1000, 9999));

function jitter(lat: number, lng: number, km: number) {
  const r = km * Math.sqrt(rand());
  const t = rand() * 2 * Math.PI;
  return { lat: lat + (r / 111) * Math.cos(t), lng: lng + (r / 98) * Math.sin(t) };
}
function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------- model
type Role = "customer" | "driver" | "admin";
type User = { id: string; role: Role };
type Driver = {
  id: string;
  vehicle: Vehicle;
  lat: number;
  lng: number;
  kyc: "pending" | "approved" | "rejected";
  online: boolean;
  activeBooking: string | null;
  /** Booking whose live offer this driver currently holds (offers are exclusive). */
  heldOffer: string | null;
};
type Status = "pending" | "accepted" | "in_progress" | "completed" | "expired";
type Booking = {
  id: string;
  customerId: string;
  vehicle: Vehicle;
  hub: HubName;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  status: Status;
  driverId: string | null;
  expiresAt: number;
  pickupOtp: string;
  dropOtp: string;
  pickupVerifiedAt: number | null;
  offered: Set<string>;
  liveOffer: { driverId: string; expiresAt: number; offeredAt: number } | null;
  nextRetryAt: number;
  otpAttempts: { pickup: number; drop: number };
};
type TicketCategory = "wrong_otp" | "declined_offer" | "connection_timeout" | "no_driver_found";
type Ticket = {
  id: string;
  bookingId: string;
  category: TicketCategory;
  status: "open" | "auto_resolved" | "escalated";
  resolution?: string;
};

class ServerError extends Error {
  constructor(
    public code: string,
    msg: string,
  ) {
    super(msg);
  }
}

// ---------------------------------------------------------------- in-memory server
let now = 0;
const users = new Map<string, User>();
const drivers = new Map<string, Driver>();
const bookings = new Map<string, Booking>();
const tickets: Ticket[] = [];
const idempotency = new Map<string, { ok: boolean; code?: string }>();
const violations: string[] = [];
const stats = {
  offers: 0,
  offersAccepted: 0,
  offersDeclined: 0,
  offersExpired: 0,
  wrongOtp: 0,
  connectionTimeouts: 0,
  networkRetries: 0,
  duplicateAcceptsBlocked: 0,
  busyDriverAcceptsBlocked: 0,
  goOnlineBlockedBeforeKyc: 0,
  nonAdminApprovalsBlocked: 0,
  maxOfferLifetimeS: 0,
};
const offerHistory = new Map<string, string[]>(); // bookingId -> drivers offered (in order)

function addTicket(bookingId: string, category: TicketCategory) {
  tickets.push({ id: `T${tickets.length + 1}`, bookingId, category, status: "open" });
}

const api = {
  adminApproveKyc(callerId: string, driverId: string) {
    if (users.get(callerId)?.role !== "admin") throw new ServerError("42501", "admin only");
    const d = drivers.get(driverId);
    if (!d) throw new ServerError("P0002", "driver not found");
    d.kyc = "approved";
  },
  setDriverOnline(driverId: string, online: boolean) {
    const d = drivers.get(driverId)!;
    if (online && d.kyc !== "approved") throw new ServerError("P0001", "verification incomplete");
    d.online = online;
  },
  createBooking(customerId: string, vehicle: Vehicle, hub: (typeof HUBS)[number]): Booking {
    if (users.get(customerId)?.role !== "customer")
      throw new ServerError("42501", "customers only");
    const id = `B${bookings.size + 1}`;
    const b: Booking = {
      id,
      customerId,
      vehicle,
      hub: hub.name,
      pickup: jitter(hub.lat, hub.lng, 1.5),
      drop: jitter(hub.lat, hub.lng, 6),
      status: "pending",
      driverId: null,
      expiresAt: now + BOOKING_TTL_S,
      pickupOtp: otp(), // server-generated, never client supplied
      dropOtp: otp(),
      pickupVerifiedAt: null,
      offered: new Set(),
      liveOffer: null,
      nextRetryAt: now,
      otpAttempts: { pickup: 0, drop: 0 },
    };
    bookings.set(id, b);
    offerHistory.set(id, []);
    return b;
  },
  /** Mirrors dispatch_next_driver: nearest eligible driver, one live offer, never re-offer. */
  dispatchNext(b: Booking): string | null {
    if (b.status !== "pending" || b.liveOffer) return null;
    const shape = {
      status: b.status,
      driver_id: b.driverId,
      vehicle_type: b.vehicle,
      service_zone: DEFAULT_SERVICE_ZONE,
    };
    let best: Driver | null = null;
    let bestKm = Infinity;
    for (const d of drivers.values()) {
      if (d.activeBooking || d.heldOffer || b.offered.has(d.id) || d.vehicle !== b.vehicle)
        continue;
      const ok = isRideAlertMatch(
        shape,
        {
          isOnline: d.online,
          kycApproved: d.kyc === "approved",
          serviceZone: DEFAULT_SERVICE_ZONE,
          vehicleType: d.vehicle,
        },
        now * 1000,
      );
      if (!ok) continue;
      const km = distKm(d, b.pickup);
      if (km <= DISPATCH_RADIUS_KM && km < bestKm) {
        best = d;
        bestKm = km;
      }
    }
    if (!best) {
      b.nextRetryAt = now + RETRY_INTERVAL_S;
      return null;
    }
    if (best.kyc !== "approved") violations.push(`offer to unverified driver ${best.id}`);
    b.offered.add(best.id);
    offerHistory.get(b.id)!.push(best.id);
    if (best.heldOffer) violations.push(`driver ${best.id} holds two live offers`);
    best.heldOffer = b.id;
    b.liveOffer = { driverId: best.id, expiresAt: now + OFFER_TTL_S, offeredAt: now };
    stats.offers++;
    return best.id;
  },
  /** Mirrors accept/decline: idempotent per key, atomic assignment, offer must be live. */
  respondOffer(driverId: string, bookingId: string, action: "accept" | "decline", key: string) {
    const prior = idempotency.get(key);
    if (prior) {
      stats.duplicateAcceptsBlocked++;
      if (!prior.ok) throw new ServerError(prior.code!, "replayed failure");
      return;
    }
    const b = bookings.get(bookingId)!;
    const d = drivers.get(driverId)!;
    const live = b.liveOffer;
    if (!live || live.driverId !== driverId || live.expiresAt <= now || b.status !== "pending") {
      idempotency.set(key, { ok: false, code: "offer_expired" });
      throw new ServerError("offer_expired", "offer no longer available");
    }
    stats.maxOfferLifetimeS = Math.max(stats.maxOfferLifetimeS, now - live.offeredAt);
    b.liveOffer = null;
    d.heldOffer = null;
    if (action === "accept" && d.activeBooking) {
      stats.busyDriverAcceptsBlocked++;
      b.nextRetryAt = now;
      idempotency.set(key, { ok: false, code: "driver_busy" });
      throw new ServerError("driver_busy", "driver already on a ride");
    }
    if (action === "decline") {
      stats.offersDeclined++;
      b.nextRetryAt = now;
    } else {
      if (d.activeBooking) violations.push(`driver ${d.id} double-booked`);
      if (!d.online || d.kyc !== "approved" || d.vehicle !== b.vehicle)
        violations.push(`ineligible acceptance ${d.id} on ${b.id}`);
      b.status = "accepted";
      b.driverId = driverId;
      d.activeBooking = bookingId;
      stats.offersAccepted++;
    }
    idempotency.set(key, { ok: true });
  },
  verifyOtp(driverId: string, bookingId: string, stage: "pickup" | "drop", code: string) {
    const b = bookings.get(bookingId)!;
    if (b.driverId !== driverId) throw new ServerError("42501", "not your booking");
    const expected = stage === "pickup" ? b.status === "accepted" : b.status === "in_progress";
    if (!expected) throw new ServerError("P0001", "wrong stage");
    if (b.otpAttempts[stage] >= MAX_OTP_ATTEMPTS)
      throw new ServerError("locked", "too many attempts");
    const truth = stage === "pickup" ? b.pickupOtp : b.dropOtp;
    if (code !== truth) {
      b.otpAttempts[stage]++;
      throw new ServerError("invalid_otp", "incorrect code");
    }
    if (stage === "pickup") {
      b.status = "in_progress";
      b.pickupVerifiedAt = now;
    } else {
      if (!b.pickupVerifiedAt) violations.push(`${b.id} completed without pickup verification`);
      b.status = "completed";
      const d = drivers.get(driverId)!;
      d.activeBooking = null;
      d.lat = b.drop.lat;
      d.lng = b.drop.lng;
    }
  },
};

/** Flaky transport: the request may reach the server but the response is lost. */
function callWithRetry(label: string, fn: () => void, failRate: number) {
  for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt++) {
    const reachesServer = !(rand() < failRate / 2);
    let serverErr: unknown = null;
    if (reachesServer) {
      try {
        fn();
      } catch (e) {
        serverErr = e;
      }
    }
    const responseLost = rand() < failRate;
    if (!reachesServer || responseLost) {
      stats.connectionTimeouts++;
      if (attempt < MAX_NETWORK_RETRIES) stats.networkRetries++;
      continue;
    }
    if (serverErr) throw serverErr;
    return;
  }
  throw new ServerError("network_timeout", `${label} timed out after retries`);
}

// ---------------------------------------------------------------- scheduler
const events = new Map<number, Array<() => void>>();
function at(t: number, fn: () => void) {
  const k = Math.max(t, now + 1);
  const list = events.get(k);
  if (list) list.push(fn);
  else events.set(k, [fn]);
}

// ---------------------------------------------------------------- AI assistant (deterministic playbook)
function aiAssistantResolve(t: Ticket) {
  const b = bookings.get(t.bookingId)!;
  switch (t.category) {
    case "wrong_otp":
      if (b.otpAttempts.pickup >= MAX_OTP_ATTEMPTS || b.otpAttempts.drop >= MAX_OTP_ATTEMPTS) {
        t.status = "escalated";
        t.resolution = "OTP locked; human agent to verify identity";
      } else {
        t.status = "auto_resolved";
        t.resolution = "Customer re-shared the code from the trip screen; verified on retry";
      }
      break;
    case "declined_offer":
      t.status = "auto_resolved";
      t.resolution =
        b.status === "expired"
          ? "Customer notified; suggested fare boost or vehicle change"
          : "Re-dispatched to next nearest captain";
      if (b.status === "expired") t.status = "escalated";
      break;
    case "connection_timeout":
      t.status = "auto_resolved";
      t.resolution = "Idempotent retry applied once; no duplicate assignment";
      break;
    case "no_driver_found":
      t.status = "escalated";
      t.resolution = "No captain within 7 km; ops to contact customer";
      break;
  }
}

// ---------------------------------------------------------------- driver/customer behaviour
function scheduleOfferResponse(b: Booking, driverId: string) {
  const roll = rand();
  // Forced edge case: the first offer on every 7th booking is declined.
  const forceDecline = offerHistory.get(b.id)!.length === 1 && Number(b.id.slice(1)) % 7 === 0;
  if (forceDecline || roll < 0.15) {
    at(now + between(2, 12), () => {
      try {
        api.respondOffer(driverId, b.id, "decline", `${b.id}:${driverId}:decline`);
        addTicket(b.id, "declined_offer");
      } catch {
        /* offer already gone */
      }
    });
    return;
  }
  if (roll < 0.3) return; // ignores the pop-up -> offer expires at 20 s
  at(now + between(2, 15), () => {
    let hadTimeout = false;
    const before = stats.connectionTimeouts;
    try {
      callWithRetry(
        "accept",
        () => api.respondOffer(driverId, b.id, "accept", `${b.id}:${driverId}:accept`),
        Number(b.id.slice(1)) % 11 === 0 ? 0.6 : 0.05,
      );
    } catch {
      /* expired or retries exhausted: dispatcher moves on */
    }
    hadTimeout = stats.connectionTimeouts > before;
    if (hadTimeout) addTicket(b.id, "connection_timeout");
    if (b.status === "accepted" && b.driverId === driverId) runTrip(b, driverId);
  });
}

function enterOtp(b: Booking, driverId: string, stage: "pickup" | "drop", then: () => void) {
  const truth = stage === "pickup" ? b.pickupOtp : b.dropOtp;
  const forceWrong = Number(b.id.slice(1)) % 5 === 0;
  if (forceWrong || rand() < 0.08) {
    const wrong = truth === "1234" ? "4321" : "1234";
    const statusBefore = b.status;
    try {
      api.verifyOtp(driverId, b.id, stage, wrong);
      violations.push(`${b.id} accepted wrong ${stage} OTP`);
    } catch (e) {
      if ((e as ServerError).code !== "invalid_otp")
        violations.push(`${b.id} unexpected OTP error`);
    }
    if (b.status !== statusBefore) violations.push(`${b.id} advanced on wrong ${stage} OTP`);
    stats.wrongOtp++;
    addTicket(b.id, "wrong_otp");
  }
  at(now + between(5, 30), () => {
    api.verifyOtp(driverId, b.id, stage, truth);
    then();
  });
}

function runTrip(b: Booking, driverId: string) {
  const d = drivers.get(driverId)!;
  const arrive = Math.max(180, Math.round((distKm(d, b.pickup) / 20) * 3600));
  at(now + arrive, () =>
    enterOtp(b, driverId, "pickup", () => {
      const ride = Math.max(300, Math.round((distKm(b.pickup, b.drop) / 22) * 3600));
      at(now + ride, () => enterOtp(b, driverId, "drop", () => {}));
    }),
  );
}

// ---------------------------------------------------------------- run
async function main() {
  const t0 = performance.now();
  // 1. Seed users
  const admin: User = { id: "A1", role: "admin" };
  users.set(admin.id, admin);
  const driverCount = DRIVER_COUNT;
  const customerCount = CUSTOMER_COUNT;
  for (let i = 0; i < driverCount; i++) {
    const id = `D${i + 1}`;
    users.set(id, { id, role: "driver" });
    const hub = HUBS[i % HUBS.length];
    const pos = jitter(hub.lat, hub.lng, 3);
    drivers.set(id, {
      id,
      vehicle: VEHICLES[Math.floor(i / HUBS.length) % VEHICLES.length],
      ...pos,
      kyc: "pending",
      online: false,
      activeBooking: null,
      heldOffer: null,
    });
  }
  const customerIds: string[] = [];
  for (let i = 0; i < customerCount; i++) {
    const id = `C${i + 1}`;
    users.set(id, { id, role: "customer" });
    customerIds.push(id);
  }

  // 2. Verification gate + admin KYC approval
  for (const d of drivers.values()) {
    try {
      api.setDriverOnline(d.id, true);
      violations.push(`${d.id} went online before KYC`);
    } catch {
      stats.goOnlineBlockedBeforeKyc++;
    }
  }
  try {
    api.adminApproveKyc(customerIds[0], "D1");
    violations.push("customer approved KYC");
  } catch {
    stats.nonAdminApprovalsBlocked++;
  }
  let rejected = 0;
  for (const d of drivers.values()) {
    if (rand() < 0.05) {
      d.kyc = "rejected";
      rejected++;
      continue;
    }
    api.adminApproveKyc(admin.id, d.id);
    api.setDriverOnline(d.id, true);
  }

  // 3. Ride requests burst across the four Faridabad areas within 60 s
  for (let i = 0; i < customerIds.length; i++) {
    const cid = customerIds[i];
    at(between(1, 60), () => {
      const b = api.createBooking(cid, pick(VEHICLES), HUBS[i % HUBS.length]);
      b.nextRetryAt = now;
    });
  }

  // 4. Event loop: offers, expiries, retries
  const unverified = new Set(
    [...drivers.values()].filter((d) => d.kyc !== "approved").map((d) => d.id),
  );
  for (now = 1; now <= MAX_SIM_S; now++) {
    const list = events.get(now);
    if (list) {
      events.delete(now);
      for (const fn of list) fn();
    }
    let open = 0;
    for (const b of bookings.values()) {
      if (b.status !== "pending") continue;
      open++;
      if (b.liveOffer && b.liveOffer.expiresAt <= now) {
        stats.maxOfferLifetimeS = Math.max(stats.maxOfferLifetimeS, now - b.liveOffer.offeredAt);
        drivers.get(b.liveOffer.driverId)!.heldOffer = null;
        b.liveOffer = null;
        stats.offersExpired++;
        b.nextRetryAt = now;
      }
      if (now >= b.expiresAt) {
        b.status = "expired";
        if (b.liveOffer) drivers.get(b.liveOffer.driverId)!.heldOffer = null;
        b.liveOffer = null;
        addTicket(b.id, "no_driver_found");
        continue;
      }
      if (!b.liveOffer && now >= b.nextRetryAt) {
        const driverId = api.dispatchNext(b);
        if (driverId) {
          if (unverified.has(driverId)) violations.push(`unverified ${driverId} offered`);
          scheduleOfferResponse(b, driverId);
        }
      }
    }
    if (open === 0 && events.size === 0 && bookings.size === customerIds.length) break;
  }

  // 5. Support + AI assistant
  for (const t of tickets) aiAssistantResolve(t);

  // ---------------------------------------------------------------- assertions
  const all = [...bookings.values()];
  const by = (s: Status) => all.filter((b) => b.status === s).length;
  for (const b of all) {
    if (b.status !== "completed" && b.status !== "expired")
      violations.push(`${b.id} stuck in ${b.status}`);
    const h = offerHistory.get(b.id)!;
    if (new Set(h).size !== h.length) violations.push(`${b.id} re-offered a driver`);
  }
  if (stats.maxOfferLifetimeS > OFFER_TTL_S)
    violations.push(`offer lived ${stats.maxOfferLifetimeS}s`);
  if (stats.goOnlineBlockedBeforeKyc !== driverCount) violations.push("verification gate leaked");
  if (stats.nonAdminApprovalsBlocked !== 1) violations.push("non-admin KYC approval not blocked");
  for (const d of drivers.values())
    if (d.activeBooking || d.heldOffer) violations.push(`${d.id} still busy`);
  for (const cat of ["wrong_otp", "declined_offer", "connection_timeout"] as const)
    if (!tickets.some((t) => t.category === cat))
      violations.push(`edge case ${cat} never triggered`);
  if (tickets.some((t) => t.status === "open")) violations.push("support tickets left unresolved");
  if (stats.offersDeclined === 0) violations.push("no declines exercised");
  for (const hub of HUBS)
    if (!all.some((b) => b.hub === hub.name && b.status === "completed"))
      violations.push(`no completed ride in ${hub.name}`);
  for (const v of VEHICLES)
    if (!all.some((b) => b.vehicle === v && b.status === "completed"))
      violations.push(`no completed ride for ${v}`);

  const ticketSummary = Object.fromEntries(
    (["wrong_otp", "declined_offer", "connection_timeout", "no_driver_found"] as const).map((c) => {
      const ts = tickets.filter((t) => t.category === c);
      return [
        c,
        {
          logged: ts.length,
          autoResolved: ts.filter((t) => t.status === "auto_resolved").length,
          escalated: ts.filter((t) => t.status === "escalated").length,
        },
      ];
    }),
  );

  console.log("MiniPort full-flow integration test (in-memory, no database writes)");
  console.table({
    users: driverCount + customerCount,
    totalTestAccountsCreated: driverCount + customerCount,
    seed: SEED,
    drivers: driverCount,
    driversKycRejected: rejected,
    customers: customerCount,
    bookings: all.length,
    completed: by("completed"),
    expired: by("expired"),
    simulatedMinutes: Math.round(now / 60),
    runtimeMs: Math.round(performance.now() - t0),
  });
  console.table(stats);
  console.table(ticketSummary);
  console.table(
    Object.fromEntries(
      HUBS.map((h) => [
        h.name,
        all.filter((b) => b.hub === h.name && b.status === "completed").length,
      ]),
    ),
  );

  // A shareable visual report is generated from the same in-memory run.
  // No simulated account, booking, OTP, or support ticket is written to Supabase.
  const testAccounts = {
    total: driverCount + customerCount,
    customers: customerCount,
    drivers: driverCount,
    admins: 1,
    persistedToDatabase: 0,
    storage: "in-memory only",
  };
  console.table(testAccounts);

  const status = violations.length === 0 ? "PASS" : "FAIL";
  const completed = by("completed");
  const expired = by("expired");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760">
    <rect width="1200" height="760" rx="28" fill="#fff8ef"/>
    <rect width="1200" height="150" rx="28" fill="#f97316"/>
    <text x="64" y="70" fill="#ffffff" font-family="Arial,sans-serif" font-size="30" font-weight="700">MINIPORT · FULL-FLOW TEST REPORT</text>
    <text x="64" y="112" fill="#ffedd5" font-family="Arial,sans-serif" font-size="18">Deterministic Faridabad simulation · Seed ${SEED} · No production data touched</text>
    <rect x="64" y="184" width="1072" height="170" rx="22" fill="#ffffff" stroke="#eadfd2" stroke-width="2"/>
    <text x="96" y="230" fill="#6b6259" font-family="Arial,sans-serif" font-size="20">TOTAL TEST ACCOUNTS CREATED (IN MEMORY)</text>
    <text x="96" y="320" fill="#171717" font-family="Arial,sans-serif" font-size="82" font-weight="700">${testAccounts.total.toLocaleString("en-US")}</text>
    <rect x="64" y="384" width="336" height="118" rx="18" fill="#ffedd5"/>
    <text x="92" y="426" fill="#9a3412" font-family="Arial,sans-serif" font-size="19">CUSTOMERS</text>
    <text x="92" y="476" fill="#171717" font-family="Arial,sans-serif" font-size="42" font-weight="700">${customerCount.toLocaleString("en-US")}</text>
    <rect x="432" y="384" width="336" height="118" rx="18" fill="#dcfce7"/>
    <text x="460" y="426" fill="#166534" font-family="Arial,sans-serif" font-size="19">DRIVERS</text>
    <text x="460" y="476" fill="#171717" font-family="Arial,sans-serif" font-size="42" font-weight="700">${driverCount.toLocaleString("en-US")}</text>
    <rect x="800" y="384" width="336" height="118" rx="18" fill="#e0e7ff"/>
    <text x="828" y="426" fill="#3730a3" font-family="Arial,sans-serif" font-size="19">ADMIN TEST ACCOUNT</text>
    <text x="828" y="476" fill="#171717" font-family="Arial,sans-serif" font-size="42" font-weight="700">1</text>
    <rect x="64" y="530" width="1072" height="112" rx="18" fill="#ffffff" stroke="#eadfd2" stroke-width="2"/>
    <text x="96" y="575" fill="#6b6259" font-family="Arial,sans-serif" font-size="19">RIDES COMPLETED: ${completed.toLocaleString("en-US")}    ·    EXPIRED: ${expired.toLocaleString("en-US")}</text>
    <text x="96" y="615" fill="#6b6259" font-family="Arial,sans-serif" font-size="19">DATABASE WRITES: 0    ·    MODE: IN-MEMORY SIMULATION</text>
    <rect x="64" y="670" width="1072" height="58" rx="16" fill="${status === "PASS" ? "#16a34a" : "#dc2626"}"/>
    <text x="600" y="709" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="25" font-weight="700">${status} · ${violations.length} INVARIANT VIOLATIONS</text>
  </svg>`;
  const report = {
    generatedAt: new Date().toISOString(),
    status,
    seed: SEED,
    testAccounts,
    rides: { total: all.length, completed, expired },
    dispatch: stats,
    support: ticketSummary,
    violations,
    note: "All accounts and activity are simulated in memory. No Supabase or production records were created or modified.",
  };
  await mkdir("test-results", { recursive: true });
  await Bun.write("test-results/full-flow-report.svg", svg);
  await Bun.write("test-results/full-flow-report.json", JSON.stringify(report, null, 2));
  await Bun.write(
    "test-results/full-flow-report.html",
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>MiniPort Full-Flow Test Report</title><style>body{margin:0;padding:20px;background:#fff8ef;font-family:Arial,sans-serif}main{max-width:1000px;margin:auto}img{width:100%;height:auto;display:block;border-radius:18px}p{color:#6b6259;text-align:center}</style></head><body><main><img src="./full-flow-report.svg" alt="MiniPort test report"><p>Generated by bun run test:full-flow. Test accounts are not saved in the database.</p></main></body></html>`,
  );
  console.log("Visual report: test-results/full-flow-report.svg");
  console.log("HTML report:   test-results/full-flow-report.html");
  console.log("JSON report:   test-results/full-flow-report.json");

  if (violations.length) {
    console.error(`FAIL: ${violations.length} invariant violation(s)`);
    for (const v of violations.slice(0, 25)) console.error(" -", v);
    process.exit(1);
  }
  console.log("PASS: all invariants held");
}

main().catch((error) => {
  console.error("Full-flow test runner failed:", error);
  process.exit(1);
});
