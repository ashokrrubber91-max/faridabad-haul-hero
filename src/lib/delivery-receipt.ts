type ReceiptInput = {
  id: string;
  pickup_address?: string;
  drop_address?: string;
  vehicle_type?: string;
  fare?: number;
  driver_net_earning?: number;
  helper_count?: number;
  helper_fee?: number;
  insurance_fee?: number;
  cargo_value?: number;
  gstin_id?: string | null;
  eway_bill_number?: string | null;
  pod_photo_url?: string | null;
  pod_signature_url?: string | null;
  updated_at?: string;
};

function esc(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function money(value: number | string | null | undefined) {
  return `INR ${Number(value ?? 0).toFixed(0)}`;
}

/**
 * Generates a lightweight, dependency-free PDF receipt. The POD media references
 * are included in the receipt so the document records exactly which secure
 * storage objects were attached to the completed trip. The original media remains
 * in the private pod-files bucket and is not made public by receipt generation.
 */
export function downloadDeliveryReceipt(b: ReceiptInput) {
  const fare = Number(b.fare ?? 0);
  const helperFee = Number(b.helper_fee ?? 0);
  const insuranceFee = Number(b.insurance_fee ?? 0);
  const taxable = fare + helperFee + insuranceFee;
  const gst = Math.round(taxable * 0.18);
  const total = taxable + gst;

  const lines = [
    "MINIPORT — DIGITAL DELIVERY RECEIPT",
    `Trip: ${b.id.slice(0, 8)}`,
    `Vehicle: ${b.vehicle_type ?? "Mini truck"}`,
    `Pickup: ${b.pickup_address ?? ""}`,
    `Drop: ${b.drop_address ?? ""}`,
    `Base ride fare: ${money(fare)}`,
    `Helpers: ${Number(b.helper_count ?? 0)} · ${money(helperFee)}`,
    `Cargo insurance: ${money(insuranceFee)}`,
    `Taxable subtotal: ${money(taxable)}`,
    `GST (18%): ${money(gst)}`,
    `Grand total: ${money(total)}`,
    `Cargo value: ${money(b.cargo_value)}`,
    `GSTIN: ${b.gstin_id ?? "Not provided"}`,
    `E-Way Bill: ${b.eway_bill_number ?? "Not required / not provided"}`,
    `Driver net earning: ${money(b.driver_net_earning)}`,
    `POD photo: ${b.pod_photo_url ? "captured · " + b.pod_photo_url : "not attached"}`,
    `Receiver signature: ${b.pod_signature_url ? "captured · " + b.pod_signature_url : "not attached"}`,
    `Completed: ${new Date(b.updated_at ?? Date.now()).toLocaleString("en-IN")}`,
  ];

  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 790 Td",
    ...lines.flatMap((line, i) => [
      `(${esc(line)}) Tj`,
      i < lines.length - 1 ? "0 -18 Td" : "",
    ]),
    "ET",
  ].join("\n");

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + "\n";
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MiniPort-delivery-receipt-${b.id.slice(0, 8)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
