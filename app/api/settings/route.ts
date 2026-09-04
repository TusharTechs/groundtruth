import { NextResponse } from "next/server";
import { resolveMode, isMockMode } from "@/lib/calle/client";
import { getStoreBackend } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Runtime settings for the UI. Deliberately excludes every secret: it reports
 * only booleans about whether credentials are configured.
 */
export async function GET() {
  return NextResponse.json({
    mode: resolveMode(),
    demoMode: isMockMode(),
    calleConfigured: Boolean(process.env.CALLE_API_KEY),
    webhookConfigured: Boolean(process.env.WEBHOOK_TOKEN && process.env.APP_ORIGIN),
    database: getStoreBackend(),
    piiRedaction: (process.env.REDACT_PII ?? "true").toLowerCase() !== "false",
    sdkPackage: "@call-e/calle@0.7.0",
  });
}
