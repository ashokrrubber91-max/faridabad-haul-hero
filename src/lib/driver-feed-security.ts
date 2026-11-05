export type DriverFeedRpcError = Readonly<{ code?: string; message?: string }> | null | undefined;

export function isMissingDriverFeedRpc(error: DriverFeedRpcError): boolean {
  return Boolean(
    error &&
      (error.code === "PGRST202" ||
        error.code === "42883" ||
        /could not find the function/i.test(error.message ?? "")),
  );
}

export function driverFeedRpcErrorMessage(error: DriverFeedRpcError): string {
  if (isMissingDriverFeedRpc(error)) {
    return "Secure driver dispatch is temporarily unavailable. Please refresh or contact support.";
  }
  return error?.message || "Could not load available rides. Please try again.";
}
