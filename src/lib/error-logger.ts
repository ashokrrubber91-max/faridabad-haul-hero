export type ErrorSource =
  | "runtime"
  | "supabase"
  | "razorpay"
  | "booking"
  | "kyc"
  | "wallet"
  | "network";

export type ErrorContext = Record<string, unknown> & {
  source?: ErrorSource;
  action?: string;
};

type LoggerEvent = {
  error: unknown;
  context: ErrorContext;
  at: string;
};

const MAX_BUFFER = 25;
const BUFFER_KEY = "miniport-error-log";

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown error");
  }
}

export function logError(error: unknown, context: ErrorContext = {}): void {
  const normalized = normalizeError(error);
  const payload: LoggerEvent = {
    error: {
      name: normalized.name,
      message: normalized.message,
      stack: normalized.stack,
    },
    context,
    at: new Date().toISOString(),
  };

  console.error("[MiniPort]", payload);

  if (typeof window === "undefined") return;

  (window as unknown as { __lovableEvents?: { captureException?: (error: unknown, context?: Record<string, unknown>, options?: Record<string, unknown>) => void } }).__lovableEvents?.captureException?.(
    normalized,
    { source: "miniport", ...context },
    { mechanism: "manual", handled: true, severity: "error" },
  );

  try {
    const previous = JSON.parse(window.localStorage.getItem(BUFFER_KEY) ?? "[]") as LoggerEvent[];
    previous.push(payload);
    window.localStorage.setItem(BUFFER_KEY, JSON.stringify(previous.slice(-MAX_BUFFER)));
  } catch {
    // Logging must never break the user workflow.
  }
}

export function logSupabaseError(error: unknown, context: ErrorContext = {}): void {
  logError(error, { ...context, source: "supabase" });
}

export function logPaymentError(error: unknown, context: ErrorContext = {}): void {
  logError(error, { ...context, source: "razorpay" });
}

export async function withErrorLogging<T>(
  action: () => Promise<T>,
  context: ErrorContext,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    logError(error, context);
    throw error;
  }
}

export function installGlobalErrorLogger(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onError = (event: ErrorEvent) =>
    logError(event.error ?? event.message, { source: "runtime", mechanism: "window.onerror" });
  const onRejection = (event: PromiseRejectionEvent) =>
    logError(event.reason, { source: "runtime", mechanism: "unhandledrejection" });

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

