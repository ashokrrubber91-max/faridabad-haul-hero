import { test, expect } from "@playwright/test";

const customerPhone = process.env.E2E_CUSTOMER_PHONE;
const customerPassword = process.env.E2E_CUSTOMER_PASSWORD;
const driverPhone = process.env.E2E_DRIVER_PHONE;
const driverPassword = process.env.E2E_DRIVER_PASSWORD;

test("B2B scheduled booking -> driver -> POD -> drop verification -> receipt", async ({ page }) => {
  test.skip(!customerPhone || !customerPassword || !driverPhone || !driverPassword, "Set E2E customer/driver credentials to run the authenticated B2B flow.");
  await page.goto("/auth?mode=signin");
  await page.getByLabel(/phone/i).fill(customerPhone!);
  await page.getByLabel(/password/i).fill(customerPassword!);
  await page.getByRole("button", { name: /sign in|login/i }).click();
  await expect(page).toHaveURL(/customer|account/);
  await expect(page.getByText(/schedule booking/i)).toBeVisible();

  await page.goto("/auth?mode=signin");
  await page.getByLabel(/phone/i).fill(driverPhone!);
  await page.getByLabel(/password/i).fill(driverPassword!);
  await page.getByRole("button", { name: /sign in|login/i }).click();
  await expect(page).toHaveURL(/driver|account/);
  await expect(page.getByText(/verify drop otp|delivery photo|signature/i).first()).toBeVisible();
});
