import { RealCalleAdapter, type CalleAdapter } from "@/lib/calle/adapter";
import { MockCalleAdapter } from "@/lib/calle/mock-adapter";
import { isMockMode, logCalle } from "@/lib/calle/client";

let mockAdapter: MockCalleAdapter | null = null;
let realAdapter: RealCalleAdapter | null = null;

/**
 * Adapter factory. MOCK_CALL_E=true (default) returns the deterministic mock;
 * otherwise the real SDK adapter is used. The active mode is asserted on
 * every factory call so a misconfigured environment fails loudly, and the
 * mock is reachable in tests via getMockAdapter() for forced completion.
 */
export function getAdapter(): CalleAdapter {
  if (isMockMode()) {
    if (!mockAdapter) mockAdapter = new MockCalleAdapter();
    return mockAdapter;
  }
  if (!process.env.CALLE_API_KEY) {
    throw new Error(
      "Real CALL-E mode requested but CALLE_API_KEY is missing. Set CALLE_API_KEY or keep MOCK_CALL_E=true.",
    );
  }
  if (!realAdapter) {
    realAdapter = new RealCalleAdapter();
    logCalle("MODE", { mode: "real", baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com" });
  }
  return realAdapter;
}

/** Test/demo hook for the mock adapter (force-complete calls). */
export function getMockAdapter(): MockCalleAdapter {
  if (!mockAdapter) mockAdapter = new MockCalleAdapter();
  return mockAdapter;
}
