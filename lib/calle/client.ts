import { CalleClient } from "@call-e/calle";

/**
 * CALL-E client access + mode resolution.
 *
 * MOCK_CALL_E=true (default) -> MockCalleAdapter, always labeled DEMO MODE.
 * CALLE_API_KEY set and MOCK_CALL_E!=true -> RealCalleAdapter using the
 * official @call-e/calle SDK. Credentials are server-only.
 */

export function isMockMode(): boolean {
  if (process.env.CALLE_API_KEY && process.env.MOCK_CALL_E?.toLowerCase() !== "true") {
    return false;
  }
  return true;
}

export function resolveMode(): "mock" | "real" {
  return isMockMode() ? "mock" : "real";
}

let client: CalleClient | null = null;

export function getCalleClient(): CalleClient {
  if (!client) {
    const apiKey = process.env.CALLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "CALLE_API_KEY is not set. Set it for real mode, or keep MOCK_CALL_E=true for demo mode.",
      );
    }
    client = new CalleClient({
      apiKey,
      baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
    });
  }
  return client;
}

export function buildWebhookUrl(): string | undefined {
  const origin = process.env.APP_ORIGIN;
  const token = process.env.WEBHOOK_TOKEN;
  if (!origin || !token) return undefined;
  return `${origin.replace(/\/$/, "")}/api/webhook/calle?token=${encodeURIComponent(token)}`;
}

/** Structured, judge-visible CALL-E logging (spec section 18). */
export function logCalle(event: string, data: Record<string, unknown> = {}): void {
  const line = `[CALL-E] ${event} ${JSON.stringify(sanitize(data))}`;
  console.log(line);
}

/** Never log secrets or full phone numbers. */
function sanitize(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.toLowerCase().includes("key") || k.toLowerCase().includes("token")) {
      out[k] = "[redacted]";
    } else if (k === "phone" && typeof v === "string") {
      out[k] = v.replace(/\d(?=\d{2})/g, "•");
    } else {
      out[k] = v;
    }
  }
  return out;
}
