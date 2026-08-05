/** Browser-side Razorpay Checkout helper. */

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayInstance {
  open: () => void;
  on: (event: string, cb: (response: unknown) => void) => void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

let loader: Promise<RazorpayConstructor> | null = null;

export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout is browser-only"));
  const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
  if (existing) return Promise.resolve(existing);
  if (loader) return loader;

  loader = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error("Could not load the payment window"));
    };
    script.onerror = () => {
      loader = null;
      reject(new Error("Could not load the payment window. Check your connection."));
    };
    document.head.appendChild(script);
  });
  return loader;
}

export interface CheckoutSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface CheckoutRequest {
  keyId: string;
  orderId: string;
  amountRupees: number;
  currency?: string;
  customerName?: string;
  customerPhone?: string;
  description: string;
  method?: string;
}

/** Resolves with the signed callback, or null when the customer dismisses the popup. */
export async function openRazorpayCheckout(req: CheckoutRequest): Promise<CheckoutSuccess | null> {
  const Razorpay = await loadRazorpay();

  return new Promise<CheckoutSuccess | null>((resolve, reject) => {
    let settled = false;
    const finish = (value: CheckoutSuccess | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const rzp = new Razorpay({
      key: req.keyId,
      order_id: req.orderId,
      amount: Math.round(req.amountRupees * 100),
      currency: req.currency ?? "INR",
      name: "MiniPort",
      description: req.description,
      theme: { color: "#F97316" },
      prefill: {
        name: req.customerName ?? "",
        contact: req.customerPhone ?? "",
      },
      notes: { app: "miniport" },
      modal: {
        ondismiss: () => finish(null),
      },
      handler: (response: CheckoutSuccess) => finish(response),
    });

    rzp.on("payment.failed", (response: unknown) => {
      const description =
        (response as { error?: { description?: string } })?.error?.description ??
        "Payment failed. Please try another method.";
      if (settled) return;
      settled = true;
      reject(new Error(description));
    });

    rzp.open();
  });
}
