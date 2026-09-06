import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // E2E runs against the production build (matches what judges see and
    // avoids dev-server HMR flakiness): run `pnpm build` first — the
    // test:e2e script chains it automatically.
    command: `pnpm start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Hermetic: force the in-memory store even when a developer's .env.local
    // points at a real database. Remote round-trips per tick otherwise push
    // the flagship flow past its timeout and make results depend on network.
    env: { MOCK_CALL_E: "true", DATABASE_URL: "" },
  },
});
