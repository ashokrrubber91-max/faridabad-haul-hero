type ReceiptInput = {
  id: string;
  pickup_address?: string;
  drop_address?: string;
  vehicle_type?: string;
  fare?: number;
  driver_net_earning?: number;
  updated_at?: string;
};

function esc(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function downloadDeliveryReceipt(b: ReceiptInput) {
  const lines = [
    "MINIPORT — DIGITAL DELIVERY RECEIPT",
    `Trip: ${b.id.slice(0, 8)}`,
    `Vehicle: ${b.vehicle_type ?? "Mini truck"}`,
    `Pickup: ${b.pickup_address ?? ""}`,
    `Drop: ${b.drop_address ?? ""}`,
    `Fare: INR ${Number(b.fare ?? 0).toFixed(0)}`,
    `Driver earning: INR ${Number(b.driver_net_earning ?? 0).toFixed(0)}`,
    `Completed: ${new Date(b.updated_at ?? Date.now()).toLocaleString("en-IN")}`,
    "POD: Customer photo + digital signature captured",
  ];
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 790 Td",
    ...lines.flatMap((line, i) => [`(${esc(line)}) Tj`, i < lines.length - 1 ? "0 -18 Td" : ""]),
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
  for (const obj of objects) { offsets.push(pdf.length); pdf += obj + "\n"; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += String(offsets[i]).padStart(10,"0") + " 00000 n \n";
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MiniPort-delivery-receipt-${b.id.slice(0,8)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
