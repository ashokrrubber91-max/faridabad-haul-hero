export type DriverTripContact = { name: string; phone: string };

type ContactStop = {
  kind: string;
  contact_name: string | null;
  contact_phone: string | null;
};

/** Prefer participant-scoped endpoint data; retain note contacts for historic rides. */
export function resolveDriverTripContact(
  stops: readonly ContactStop[],
  status: string,
  notes: string | null,
): DriverTripContact {
  const pickup = status === "accepted";
  const endpoint = stops.find((stop) => stop.kind === (pickup ? "pickup" : "drop"));
  const phone = endpoint?.contact_phone?.trim();
  if (phone) return { name: endpoint?.contact_name?.trim() ?? "", phone };

  const prefix = pickup ? "Sender" : "Receiver";
  const match = notes?.match(new RegExp(`${prefix}:\\s*([^(]+)\\(([^)]*)\\)`));
  return { name: (match?.[1] ?? "").trim(), phone: (match?.[2] ?? "").trim() };
}