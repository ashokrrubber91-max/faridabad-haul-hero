import { test, expect } from "@playwright/test";

const customerPhone = process.env.E2E_CUSTOMER_PHONE;
const customerPassword = process.env.E2E_CUSTOMER_PASSWORD;
const driverPhone = process.env.E2E_DRIVER_PHONE;
const driverPassword = process.env.E2E_DRIVER_PASSWORD;

async function signIn(page: import("@playwright/test").Page, phone: string, password: string) {
  await page.goto("/auth?mode=signin");
  await page.locator("#signin-phone").fill(phone);
  await page.locator("#signin-pw").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/auth/);
}

test.describe("Customer critical path", () => {
  test("login -> booking form -> COD fallback", async ({ page }) => {
    test.skip(
      !customerPhone || !customerPassword,
      "Set E2E_CUSTOMER_PHONE and E2E_CUSTOMER_PASSWORD for the live customer journey.",
    );

    await signIn(page, customerPhone!, customerPassword!);
    await page.goto("/customer");

    await expect(page.getByPlaceholder("Search pickup location")).toBeVisible();
    await expect(page.getByPlaceholder("Search drop location")).toBeVisible();

    // The booking checkout keeps COD available as the fallback when online
    // payment is unavailable or declined.
    await expect(page.getByRole("button", { name: /Cash on delivery/i })).toBeVisible();
  });
});

test.describe("Driver critical path", () => {
  test("login -> driver queue -> ride/wallet surfaces", async ({ page }) => {
    test.skip(
      !driverPhone || !driverPassword,
      "Set E2E_DRIVER_PHONE and E2E_DRIVER_PASSWORD for the live driver journey.",
    );

    await signIn(page, driverPhone!, driverPassword!);
    await page.goto("/driver");

    await expect(page.getByText(/Today's earnings/i)).toBeVisible();
    await expect(page.getByText(/Wallet/i)).toBeVisible();
    await expect(page.getByText(/Trips completed/i)).toBeVisible();
  });
});
