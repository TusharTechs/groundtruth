import { NextResponse } from "next/server";
import { startTask, tick } from "@/lib/agent/resolver";

export const dynamic = "force-dynamic";

/**
 * Orchestration tick. The dashboard polls this every ~1.2s while a task is
 * running; each call advances the state machine one step (poll the in-flight
 * CALL-E call, or process the terminal result and decide the next action).
 * Real CALL-E calls are driven by the same tick plus the webhook.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const snap = await tick(id);
    return NextResponse.json(snap);
  } catch (error) {
    const message = error instanceof Error ? error.message : "tick failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/** Convenience start endpoint: POST /api/tasks/:id/tick?start=1 starts then ticks. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const start = new URL(request.url).searchParams.get("start");
  try {
    if (start) await startTask(id);
    const snap = await tick(id);
    return NextResponse.json(snap);
  } catch (error) {
    const message = error instanceof Error ? error.message : "tick failed";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
