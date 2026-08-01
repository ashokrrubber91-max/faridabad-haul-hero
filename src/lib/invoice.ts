export type InvoiceBooking = {
  id: string;
  created_at: string;
  pickup_address: string;
  drop_address: string;
  vehicle_type: string;
  distance_km: number | string;
  fare: number | string;
  coupon_discount?: number | string | null;
  coins_redeemed?: number | string | null;
  payment_method?: string | null;
};

export type InvoiceParty = {
  name: string;
  phone: string;
  gstin?: string | null;
  businessName?: string | null;
  businessAddress?: string | null;
};

const GST_RATE = 0.05; // 5% GST on goods transport (SAC 9965)

export function invoiceNumber(bookingId: string, createdAt: string): string {
  const d = new Date(createdAt);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `MP/${ym}/${bookingId.slice(0, 8).toUpperCase()}`;
}

/** Build a printable tax invoice (CGST/SGST split — Faridabad intra-state). */
export function buildInvoiceHtml(b: InvoiceBooking, party: InvoiceParty, vehicleName: string): string {
  const total = Number(b.fare) || 0;
  const taxable = +(total / (1 + GST_RATE)).toFixed(2);
  const gst = +(total - taxable).toFixed(2);
  const half = +(gst / 2).toFixed(2);
  const discount = (Number(b.coupon_discount) || 0) + (Number(b.coins_redeemed) || 0);
  const rows: Array<[string, string]> = [
    ["Taxable value", `\u20b9 ${taxable.toFixed(2)}`],
    ["CGST @ 2.5%", `\u20b9 ${half.toFixed(2)}`],
    ["SGST @ 2.5%", `\u20b9 ${half.toFixed(2)}`],
  ];
  if (discount > 0) rows.unshift(["Discounts applied", `\u2212 \u20b9 ${discount.toFixed(2)}`]);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Tax Invoice ${invoiceNumber(b.id, b.created_at)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;margin:0;padding:32px;max-width:800px}
  h1{font-size:22px;letter-spacing:.06em;text-transform:uppercase;margin:0;color:#ea580c}
  .muted{color:#78716c;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}
  th,td{text-align:left;padding:8px;border-bottom:1px solid #e7e5e4}
  th{background:#fafaf9;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#78716c}
  .right{text-align:right}
  .total{font-size:18px;font-weight:700}
  .grid{display:flex;gap:24px;flex-wrap:wrap;margin-top:20px}
  .grid > div{flex:1;min-width:220px}
  .box{border:1px solid #e7e5e4;border-radius:8px;padding:12px;font-size:13px}
</style></head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px">
    <div>
      <h1>MiniPort Logistics</h1>
      <p class="muted">Mini-truck goods transport &middot; Faridabad, Haryana<br/>SAC 9965 &mdash; Goods transport services</p>
    </div>
    <div class="right">
      <p style="margin:0;font-weight:700">TAX INVOICE</p>
      <p class="muted" style="margin:2px 0">No. ${invoiceNumber(b.id, b.created_at)}<br/>Date ${new Date(b.created_at).toLocaleDateString("en-IN")}</p>
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <p class="muted" style="margin:0 0 4px">Billed to</p>
      <p style="margin:0;font-weight:600">${escapeHtml(party.businessName || party.name)}</p>
      <p class="muted" style="margin:2px 0">${escapeHtml(party.phone)}</p>
      ${party.gstin ? `<p class="muted" style="margin:2px 0">GSTIN: ${escapeHtml(party.gstin)}</p>` : ""}
      ${party.businessAddress ? `<p class="muted" style="margin:2px 0">${escapeHtml(party.businessAddress)}</p>` : ""}
    </div>
    <div class="box">
      <p class="muted" style="margin:0 0 4px">Trip</p>
      <p style="margin:0">${escapeHtml(b.pickup_address)}</p>
      <p style="margin:2px 0">&darr; ${escapeHtml(b.drop_address)}</p>
      <p class="muted" style="margin:2px 0">${escapeHtml(vehicleName)} &middot; ${Number(b.distance_km).toFixed(1)} km &middot; ${b.payment_method === "cod" ? "Cash" : "Online"}</p>
    </div>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
    <tbody>
      ${rows.map(([k, v]) => `<tr><td>${k}</td><td class="right">${v}</td></tr>`).join("")}
      <tr><td class="total">Total payable</td><td class="right total">\u20b9 ${total.toFixed(2)}</td></tr>
    </tbody>
  </table>

  <p class="muted" style="margin-top:20px">
    GST is charged at 5% on goods transport under SAC 9965. This is a computer-generated invoice.
    Trip reference ${b.id.slice(0, 8).toUpperCase()}.
  </p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`;
}

export function openInvoice(html: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
