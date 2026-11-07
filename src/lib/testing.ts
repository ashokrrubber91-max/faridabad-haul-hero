/** MiniPort testing switches. Test-only OTP bypass must never be enabled in production. */
export const MINIPORT_TEST_MODE = import.meta.env.DEV;
export const TEST_OTP = "123456";
