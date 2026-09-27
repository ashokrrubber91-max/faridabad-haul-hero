import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Conservative security headers. Frame options are deliberately omitted so the
 * Lovable preview (an iframe) keeps working.
 */
const securityHeaders = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = (result as { response?: Response }).response;
  if (response?.headers) {
    // Keep the allow-list narrow while permitting the services loaded by the
    // browser (Supabase, Maps, Razorpay and the configured font files). This
    // stops injected markup from loading arbitrary scripts, frames or forms.
    response.headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "form-action 'self'",
        "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://maps.googleapis.com https://www.gstatic.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://maps.googleapis.com https://*.supabase.co",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com https://checkout.razorpay.com",
        "frame-src 'self' https://api.razorpay.com https://*.razorpay.com",
        "worker-src 'self' blob:",
      ].join("; "),
    );
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-DNS-Prefetch-Control", "off");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    response.headers.set(
      "Permissions-Policy",
      "camera=(self), microphone=(self), geolocation=(self), payment=(self)",
    );
  }
  return result;
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, securityHeaders],
}));
