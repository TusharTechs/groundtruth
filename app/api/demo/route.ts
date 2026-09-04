import { NextResponse } from "next/server";
import { demoScenarios } from "@/lib/demo/scenarios";
import { resolveMode, isMockMode } from "@/lib/calle/client";
import { getStoreBackend } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Demo metadata: scenario list + runtime mode badges for the UI. */
export async function GET() {
  return NextResponse.json({
    mode: resolveMode(),
    demoMode: isMockMode(),
    store: getStoreBackend(),
    scenarios: demoScenarios.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      sampleRequest: s.sampleRequest,
    })),
  });
}
