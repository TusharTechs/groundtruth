import { test, expect } from "@playwright/test";

/**
 * E2E: failure path in DEMO MODE. Every supplier fails a hard requirement,
 * so GroundTruth must report NO FULLY VERIFIED MATCH with the breakdown —
 * never a fake success.
 */
test("failure scenario reports no fully verified match", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/verify");

  await expect(page.getByRole("heading", { name: /what do you need to verify/i })).toBeVisible();
  await expect(page.getByText(/DEMO MODE/i).first()).toBeVisible();

  // Select the deterministic failure scenario (pre-fills the request).
  await page.getByText(/honest failure path/i).first().click();
  await page.getByRole("button", { name: /analyze goal/i }).click();

  await page.getByRole("button", { name: /start verification/i }).click();

  const banner = page.getByText(/No fully verified match/i).first();
  await expect(banner).toBeVisible({ timeout: 240_000 });
  await expect(page.getByText(/why this result\?/i).first()).toBeVisible();
  // The winner banner must NOT appear.
  await expect(page.getByText(/Reality verified/i)).toHaveCount(0);
});
