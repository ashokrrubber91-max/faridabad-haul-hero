/**
 * Offline, deterministic simulation of the full MiniPort ride lifecycle at
 * scale: customer booking -> sequential 20-second driver offers -> acceptance
 * -> pickup OTP -> drop OTP -> completion.
 *
 * It never touches the network or the database. The dispatch rules mirror
 * `dispatch_next_driver` / `process_driver_dispatch_queue` /
 * `accept_dispatch_offer` (nearest eligible driver within 7 km, one live
 * offer per booking, 20 s expiry, never re-offer the same driver, one active
 * ride per driver, 30 min booking expiry) and reuse the app's real matcher
 * from `src/lib/dispatch-match.ts`.
 *
 * Run: bun scripts/ride-lifecycle-sim.ts [users=10000] [seed=42]
 */
import { DEFAULT_SERVICE_ZONE, isRideAlertMatch } from "../src/lib/dispatch-match";

export const OFFER_TTL_S = 20;
export const BOOKING_TTL_S = 30 * 60;
export const DISPATCH_RADIUS_KM = 7;
export const RETRY_INTERVAL_S = 10;

type BookingStatus = "pending" | "accepted" | "in_progress" | "completed" | "expired";
type OfferStatus = "offered" | "accepted" | "declined" | "expired" | "skipped";

export type SimOptions = {
  users?: number;
  /** Share of users who are drivers (rest are customers, one booking each). */
  driverShare?: number;
  seed?: number;
  /** All bookings arrive within this window (seconds) to model a burst. */
  burstWindowS?: number;
  acceptRate?: number;
  declineRate?: number;
};

type Driver = {
  id: string;
  lat: number;
  lng: number;
  isOnline: boolean;
  kycApproved: boolean;
  serviceZone: string;
  vehicleType: string;
  activeBookingId: string | null;
  completed: number;
};

type Booking = {
  id: string;
  customerId: string;
  createdAt: number;
  expiresAt: number;
  status: BookingStatus;
  driverId: string | null;
  vehicleType: string;
  serviceZone: string;
  pickupLat: number;
  pickupLng: number;
  pickupOtp: string;
  dropOtp: string;
  pickupVerifiedAt: number | null;
  completedAt: number | null;
  acceptedAt: number | null;
  history: BookingStatus[];
};

type Offer = {
  bookingId: string;
  driverId: string;
  seq: number;
  status: OfferStatus;
  offeredAt: number;
  expiresAt: number;
  distanceKm: number;
};

export type SimReport = {
  users: number;
  customers: number;
  drivers: number;
  bookings: number;
  completed: number;
  expiredUnassigned: number;
  stillOpen: number;
  offersSent: number;
  offersAccepted: number;
  offersDeclined: number;
  offersExpired: number;
  rejectedAcceptAttempts: number;
  rejectedOtpAttempts: number;
  avgOffersPerAssignedBooking: number;
  avgSecondsToAccept: number;
  p95SecondsToAccept: number;
  simulatedSeconds: number;
  wallClockMs: number;
  violations: string[];
};

const VEHICLES = ["tata_ace", "pickup_8ft", "tata_407"];
const CENTER = { lat: 28.4089, lng: 77.3178 }; // Faridabad

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

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function runRideLifecycleSimulation(opts: SimOptions = {}): SimReport {
  const started = Date.now();
  const users = opts.users ?? 10000;
  const rand = mulberry32(opts.seed ?? 42);
  const driverCount = Math.round(users * (opts.driverShare ?? 0.3));
  const customerCount = users - driverCount;
  const burst = opts.burstWindowS ?? 60;
  const acceptRate = opts.acceptRate ?? 0.55;
  const declineRate = opts.declineRate ?? 0.25;
  const violations: string[] = [];
  const violate = (msg: string) => {
    if (violations.length < 50) violations.push(msg);
  };

  const jitter = (spread: number) => (rand() - 0.5) * spread;
  const otp = () => String(1000 + Math.floor(rand() * 9000));

  const drivers: Driver[] = Array.from({ length: driverCount }, (_, i) => ({
    id: `d${i}`,
    lat: CENTER.lat + jitter(0.2),
    lng: CENTER.lng + jitter(0.2),
    isOnline: rand() < 0.9,
    kycApproved: rand() < 0.92,
    serviceZone: rand() < 0.95 ? DEFAULT_SERVICE_ZONE : "Gurugram",
    vehicleType: VEHICLES[Math.floor(rand() * VEHICLES.length)],
    activeBookingId: null,
    completed: Math.floor(rand() * 50),
  }));
  const driverById = new Map(drivers.map((d) => [d.id, d]));

  const bookings: Booking[] = Array.from({ length: customerCount }, (_, i) => {
    const createdAt = Math.floor(rand() * burst);
    return {
      id: `b${i}`,
      customerId: `c${i}`,
      createdAt,
      expiresAt: createdAt + BOOKING_TTL_S,
      status: "pending",
      driverId: null,
      vehicleType: VEHICLES[Math.floor(rand() * VEHICLES.length)],
      serviceZone: DEFAULT_SERVICE_ZONE,
      pickupLat: CENTER.lat + jitter(0.2),
      pickupLng: CENTER.lng + jitter(0.2),
      pickupOtp: otp(),
      dropOtp: otp(),
      pickupVerifiedAt: null,
      completedAt: null,
      acceptedAt: null,
      history: ["pending"],
    };
  });
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  const offersByBooking = new Map<string, Offer[]>();
  const liveOffer = new Map<string, Offer>(); // bookingId -> current offered row
  const nextRetryAt = new Map<string, number>();
  // Timed events: second -> callbacks.
  const events = new Map<number, Array<() => void>>();
  const at = (t: number, fn: () => void) => {
    const list = events.get(t);
    if (list) list.push(fn);
    else events.set(t, [fn]);
  };

  let offersSent = 0;
  let offersAccepted = 0;
  let offersDeclined = 0;
  let offersExpired = 0;
  let rejectedAccepts = 0;
  let rejectedOtps = 0;
  const acceptLatencies: number[] = [];

  const setStatus = (b: Booking, next: BookingStatus) => {
    const allowed: Record<BookingStatus, BookingStatus[]> = {
      pending: ["accepted", "expired"],
      accepted: ["in_progress"],
      in_progress: ["completed"],
      completed: [],
      expired: [],
    };
    if (!allowed[b.status].includes(next)) violate(`${b.id}: illegal ${b.status} -> ${next}`);
    b.status = next;
    b.history.push(next);
  };

  /** Mirrors dispatch_next_driver: nearest eligible, never offered before. */
  const dispatchNext = (b: Booking, now: number) => {
    if (b.status !== "pending" || b.driverId || liveOffer.has(b.id)) return;
    const past = new Set((offersByBooking.get(b.id) ?? []).map((o) => o.driverId));
    const bookingRow = {
      status: b.status,
      driver_id: b.driverId,
      service_zone: b.serviceZone,
      vehicle_type: b.vehicleType,
      // Booking expiry is enforced by the queue loop; skip per-driver date parsing.
      expires_at: null,
    };
    let best: Driver | null = null;
    let bestKm = Infinity;
    for (const d of drivers) {
      if (d.activeBookingId || past.has(d.id)) continue;
      if (!isRideAlertMatch(bookingRow, d, now * 1000)) continue;
      const km = haversineKm(d.lat, d.lng, b.pickupLat, b.pickupLng);
      if (km > DISPATCH_RADIUS_KM) continue;
      if (km < bestKm || (km === bestKm && best && d.completed > best.completed)) {
        best = d;
        bestKm = km;
      }
    }
    if (!best) {
      nextRetryAt.set(b.id, now + RETRY_INTERVAL_S);
      return;
    }
    const list = offersByBooking.get(b.id) ?? [];
    const offer: Offer = {
      bookingId: b.id,
      driverId: best.id,
      seq: list.length + 1,
      status: "offered",
      offeredAt: now,
      expiresAt: now + OFFER_TTL_S,
      distanceKm: bestKm,
    };
    list.push(offer);
    offersByBooking.set(b.id, list);
    liveOffer.set(b.id, offer);
    offersSent++;
    scheduleDriverResponse(offer);
  };

  /** Mirrors accept_dispatch_offer: only the live, unexpired offer may win. */
  const tryAccept = (bookingId: string, driverId: string, now: number): boolean => {
    const b = bookingById.get(bookingId)!;
    const d = driverById.get(driverId)!;
    const offer = liveOffer.get(bookingId);
    const ok =
      d.isOnline &&
      d.kycApproved &&
      !d.activeBookingId &&
      b.status === "pending" &&
      !b.driverId &&
      now < b.expiresAt &&
      !!offer &&
      offer.driverId === driverId &&
      offer.status === "offered" &&
      now < offer.expiresAt;
    if (!ok) {
      rejectedAccepts++;
      return false;
    }
    b.driverId = driverId;
    b.acceptedAt = now;
    setStatus(b, "accepted");
    d.activeBookingId = bookingId;
    offer!.status = "accepted";
    liveOffer.delete(bookingId);
    offersAccepted++;
    acceptLatencies.push(now - b.createdAt);
    runTrip(b, d, now);
    return true;
  };

  const scheduleDriverResponse = (offer: Offer) => {
    const r = rand();
    if (r < acceptRate) {
      const delay = 1 + Math.floor(rand() * (OFFER_TTL_S - 2)); // within window
      at(offer.offeredAt + delay, () => {
        tryAccept(offer.bookingId, offer.driverId, offer.offeredAt + delay);
        // Concurrency probe: a different driver races the same booking.
        if (rand() < 0.05) {
          const rival = drivers[Math.floor(rand() * drivers.length)];
          if (rival.id !== offer.driverId) {
            const ok = tryAccept(offer.bookingId, rival.id, offer.offeredAt + delay);
            if (ok) violate(`${offer.bookingId}: rival ${rival.id} accepted without an offer`);
          }
        }
      });
    } else if (r < acceptRate + declineRate) {
      const delay = 1 + Math.floor(rand() * 10);
      at(offer.offeredAt + delay, () => {
        if (offer.status !== "offered") return;
        offer.status = "declined";
        liveOffer.delete(offer.bookingId);
        offersDeclined++;
        dispatchNext(bookingById.get(offer.bookingId)!, offer.offeredAt + delay);
      });
    } else if (rand() < 0.3) {
      // Late tap after the 20 s window: must be rejected.
      at(offer.expiresAt + 2, () => {
        if (tryAccept(offer.bookingId, offer.driverId, offer.expiresAt + 2))
          violate(`${offer.bookingId}: accepted after offer expiry`);
      });
    }
  };

  const runTrip = (b: Booking, d: Driver, now: number) => {
    const toPickup = 120 + Math.floor(rand() * 600);
    const ride = 600 + Math.floor(rand() * 1800);
    at(now + toPickup, () => {
      if (rand() < 0.03) {
        // Wrong pickup code entered once before the correct one.
        if (verifyOtp(b, "0000", "pickup")) violate(`${b.id}: wrong pickup OTP accepted`);
      }
      if (!verifyOtp(b, b.pickupOtp, "pickup")) violate(`${b.id}: correct pickup OTP rejected`);
      b.pickupVerifiedAt = now + toPickup;
      setStatus(b, "in_progress");
    });
    at(now + toPickup + ride, () => {
      if (!verifyOtp(b, b.dropOtp, "drop")) violate(`${b.id}: correct drop OTP rejected`);
      b.completedAt = now + toPickup + ride;
      setStatus(b, "completed");
      d.activeBookingId = null;
      d.completed++;
      d.lat = b.pickupLat + jitter(0.05);
      d.lng = b.pickupLng + jitter(0.05);
    });
  };

  const verifyOtp = (b: Booking, code: string, stage: "pickup" | "drop") => {
    const expected = stage === "pickup" ? b.pickupOtp : b.dropOtp;
    const stageOk = stage === "pickup" ? b.status === "accepted" : b.status === "in_progress";
    const ok = stageOk && code === expected;
    if (!ok) rejectedOtps++;
    return ok;
  };

  const byCreated = [...bookings].sort((a, b) => a.createdAt - b.createdAt);
  let cursor = 0;
  let now = 0;
  const horizon = burst + BOOKING_TTL_S + 4 * 3600;
  for (; now <= horizon; now++) {
    // New bookings (insert trigger starts dispatch).
    while (cursor < byCreated.length && byCreated[cursor].createdAt === now) {
      dispatchNext(byCreated[cursor++], now);
    }
    // Driver responses, trip progress.
    const due = events.get(now);
    if (due) {
      events.delete(now);
      for (const fn of due) fn();
    }
    // process_driver_dispatch_queue: expire offers, expire bookings, retry.
    for (const [bookingId, offer] of liveOffer) {
      if (offer.expiresAt <= now) {
        offer.status = "expired";
        liveOffer.delete(bookingId);
        offersExpired++;
        nextRetryAt.set(bookingId, now);
      }
    }
    for (const [bookingId, retryAt] of nextRetryAt) {
      const b = bookingById.get(bookingId)!;
      if (b.status !== "pending") {
        nextRetryAt.delete(bookingId);
        continue;
      }
      if (now >= b.expiresAt) {
        setStatus(b, "expired");
        nextRetryAt.delete(bookingId);
        liveOffer.delete(bookingId);
        continue;
      }
      if (retryAt <= now) {
        nextRetryAt.delete(bookingId);
        dispatchNext(b, now);
      }
    }
    // Invariant: at most one live offer per booking; one active ride per driver.
    if (
      cursor >= byCreated.length &&
      events.size === 0 &&
      liveOffer.size === 0 &&
      nextRetryAt.size === 0
    )
      break;
  }

  // Final invariant sweep.
  const activeCount = new Map<string, number>();
  for (const b of bookings) {
    const offers = offersByBooking.get(b.id) ?? [];
    const seen = new Set<string>();
    let accepted = 0;
    for (const o of offers) {
      if (seen.has(o.driverId)) violate(`${b.id}: driver ${o.driverId} offered twice`);
      seen.add(o.driverId);
      if (o.expiresAt - o.offeredAt !== OFFER_TTL_S) violate(`${b.id}: offer TTL not 20 s`);
      if (o.distanceKm > DISPATCH_RADIUS_KM) violate(`${b.id}: offer beyond 7 km`);
      if (o.status === "offered") violate(`${b.id}: offer left open`);
      if (o.status === "accepted") accepted++;
      const d = driverById.get(o.driverId)!;
      if (d.vehicleType !== b.vehicleType || !d.kycApproved || !d.isOnline)
        violate(`${b.id}: offered to ineligible driver ${d.id}`);
    }
    const ordered = offers.every(
      (o, i) =>
        i === 0 || o.offeredAt >= offers[i - 1].expiresAt || offers[i - 1].status === "declined",
    );
    if (!ordered) violate(`${b.id}: overlapping offers`);
    if (b.status === "completed") {
      if (accepted !== 1) violate(`${b.id}: completed with ${accepted} accepted offers`);
      if (!b.pickupVerifiedAt || !b.completedAt || b.completedAt <= b.pickupVerifiedAt)
        violate(`${b.id}: completed without OTP order`);
      if (b.history.join(">") !== "pending>accepted>in_progress>completed")
        violate(`${b.id}: unexpected lifecycle ${b.history.join(">")}`);
    }
    if (b.driverId && (b.status === "accepted" || b.status === "in_progress"))
      activeCount.set(b.driverId, (activeCount.get(b.driverId) ?? 0) + 1);
  }
  for (const [id, n] of activeCount) if (n > 1) violate(`${id}: ${n} active rides`);

  const sorted = [...acceptLatencies].sort((a, b) => a - b);
  const assigned = bookings.filter((b) => b.driverId);
  const offersOnAssigned = assigned.reduce(
    (s, b) => s + (offersByBooking.get(b.id)?.length ?? 0),
    0,
  );
  return {
    users,
    customers: customerCount,
    drivers: driverCount,
    bookings: bookings.length,
    completed: bookings.filter((b) => b.status === "completed").length,
    expiredUnassigned: bookings.filter((b) => b.status === "expired").length,
    stillOpen: bookings.filter((b) => b.status !== "completed" && b.status !== "expired").length,
    offersSent,
    offersAccepted,
    offersDeclined,
    offersExpired,
    rejectedAcceptAttempts: rejectedAccepts,
    rejectedOtpAttempts: rejectedOtps,
    avgOffersPerAssignedBooking: assigned.length ? offersOnAssigned / assigned.length : 0,
    avgSecondsToAccept: sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0,
    p95SecondsToAccept: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
    simulatedSeconds: now,
    wallClockMs: Date.now() - started,
    violations,
  };
}

if (import.meta.main) {
  const users = Number(process.argv[2] ?? 10000);
  const seed = Number(process.argv[3] ?? 42);
  const report = runRideLifecycleSimulation({ users, seed });
  console.log(JSON.stringify(report, null, 2));
  if (report.violations.length) process.exit(1);
}
