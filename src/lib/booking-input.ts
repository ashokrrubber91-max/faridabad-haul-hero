import { z } from "zod";
import { sanitizeDriverNotes } from "@/lib/driver-notes";

export const BOOKING_ADDRESS_MAX = 200;
export const BOOKING_NOTES_MAX = 500;

const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Accept common visual formatting without relaxing the stored phone limit. */
export function normalizeContactPhone(value: string): string {
  return value.replace(/[\s()\-]/g, "");
}

export const bookingPlaceSchema = point.extend({
  address: z.string().trim().min(3).max(BOOKING_ADDRESS_MAX),
  placeId: z.string().trim().max(300).nullish(),
  contactName: z.string().trim().max(80).nullish(),
  contactPhone: z.preprocess(
    (value) => (typeof value === "string" ? normalizeContactPhone(value).trim() : value),
    z.string().max(13).nullish(),
  ),
});

export function bookingAddressError(
  places: Array<{ label: string; address: string }>,
): string | null {
  const invalid = places.find(
    ({ address }) => address.trim().length < 3 || address.trim().length > BOOKING_ADDRESS_MAX,
  );
  return invalid
    ? `${invalid.label} address must be between 3 and ${BOOKING_ADDRESS_MAX} characters. Choose a shorter address.`
    : null;
}

/** Stops and contacts are stored in booking_stops; notes retain only instructions and GST billing. */
export function customerBookingNotes(
  notes: string,
  gstin: { gstin: string; business_name: string } | null,
): string | null {
  return (
    [
      sanitizeDriverNotes(notes).trim(),
      gstin && `Billed to GSTIN ${gstin.gstin} (${gstin.business_name})`,
    ]
      .filter(Boolean)
      .join(" · ") || null
  );
}
