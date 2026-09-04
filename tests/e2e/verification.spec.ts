import { test, expect } from "@playwright/test";

/**
 * E2E: full happy path in DEMO MODE (deterministic mock CALL-E).
 * create task -> review understanding -> start -> watch live calls ->
 * inspect evidence -> receive verified result.
 */
test("flagship verification flow ends in a verified result with evidence", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/");

  await expect(page.getByText("Verify Reality").first()).toBeVisible();
  await page.getByRole("link", { name: /verify reality/i }).first().click();

  // Task builder: type the flagship request explicitly. The DEMO MODE badge
  // is rendered by a client effect, so waiting for it proves the page is
  // hydrated before we interact with the controlled textarea.
  await expect(page.getByRole("heading", { name: /what do you need to verify/i })).toBeVisible();
  await expect(page.getByText(/DEMO MODE/i).first()).toBeVisible();
  const request =
    "Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km. It must be compatible, available today, under ₹25,000, and the supplier must hold it until 5 PM. You may request a hold, but do not purchase anything.";
  await page.getByRole("textbox").fill(request);
  await page.getByRole("button", { name: /analyze goal/i }).click();

  // Understanding screen shows the extracted structure.
  await expect(page.getByText("UNDERSTANDING YOUR REQUEST", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/hard requirements/i).first()).toBeVisible();
  await expect(page.getByText(/authorized actions/i).first()).toBeVisible();
  await expect(page.getByText(/✕ purchase/i).first()).toBeVisible();

  await page.getByRole("button", { name: /start verification/i }).click();

  // Live dashboard: waits through mock calls (dialing -> conversation -> result).
  await expect(page.getByText(/GROUNDTRUTH/i).first()).toBeVisible();

  // The decision banner appears with the verified winner (Metro Components).
  const banner = page.getByText("Reality verified", { exact: false }).first();
  await expect(banner).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/metro components/i).first()).toBeVisible();
  await expect(page.getByText(/₹22,800/i).first()).toBeVisible();

  // Evidence UI: click a verified claim chip to open the evidence modal.
  await page.getByText(/hold confirmed/i).first().click();
  await expect(page.getByText(/VERIFIED CLAIM|verified claim/i).first()).toBeVisible();
  await expect(page.getByText(/CALL-E call ID/i).first()).toBeVisible();
  await expect(
    page.getByText(/Supplier said:/i).or(page.getByText(/structured result/i)).first(),
  ).toBeVisible();
  // Close the modal via the backdrop, then inspect the transcript.
  await page.locator("div.fixed.inset-0").click({ position: { x: 12, y: 12 } });

  // Transcript is inspectable and masked/PII-safe.
  await page.getByText(/transcript \(/i).first().click();
  await expect(page.getByText(/do you currently have a genuine xz-420/i).first()).toBeVisible();
});
