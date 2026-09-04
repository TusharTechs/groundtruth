import { NextResponse } from "next/server";
import { onCallTerminal } from "@/lib/agent/resolver";
import { getStore } from "@/lib/db";
import { normalizePhoneResult } from "@/lib/calle/schemas";
import { logCalle } from "@/lib/calle/client";

export const dynamic = "force-dynamic";

/**
 * CALL-E terminal webhook receiver: POST /api/webhook/calle?token=...
 *
 * - Authentication: current CALL-E webhook deliveries are unsigned (the SDK's
 *   signature helpers are deprecated), so GroundTruth authenticates with a
 *   shared token in the registered webhook URL. A wrong/missing token gets 401.
 * - Idempotency: the webhook event id is inserted into a unique ledger first;
 *   duplicate deliveries are acknowledged (2xx) but NOT processed twice.
 * - Payload: { id, type: call.completed|call.failed|call.result_validation_failed,
 *   created_at, data: <terminal CallTask snapshot> }.
 */
export async function POST(request: Request) {
  const token = process.env.WEBHOOK_TOKEN;
  const url = new URL(request.url);
  const provided = url.searchParams.get("token") ?? request.headers.get("x-webhook-token");
  if (!token || provided !== token) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const event = body as {
    id?: string;
    type?: string;
    created_at?: string;
    data?: {
      id?: string;
      status?: string;
      structured_result?: unknown;
      summary?: string | null;
      task_completed?: boolean | null;
      completion_confidence?: { score?: number } | null;
      evidence?: string[];
      failure_code?: string | null;
      failure_message?: string | null;
      recipients?: Array<{
        structured_result?: unknown;
        summary?: string | null;
        attempts?: Array<{
          transcript_turns?: Array<{ offset_seconds: number | null; speaker: string; text: string }>;
        }>;
      }>;
    };
  };

  if (!event.id || !event.type || !event.data?.id) {
    return NextResponse.json({ ok: false, error: "missing event fields" }, { status: 400 });
  }

  const store = getStore();
  const firstDelivery = await store.recordWebhookEvent({
    eventId: event.id,
    type: event.type,
    calleCallId: event.data.id,
    payload: body,
  });
  if (!firstDelivery) {
    logCalle("WEBHOOK DUPLICATE IGNORED", { eventId: event.id, calleCallId: event.data.id });
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const call = await store.getCallByCalleId(event.data.id);
  if (!call) {
    // Unknown call: acknowledge so CALL-E does not retry forever, but surface
    // the mismatch in the response for debuggability.
    logCalle("WEBHOOK UNKNOWN CALL", { eventId: event.id, calleCallId: event.data.id });
    return NextResponse.json({ ok: true, unknownCall: true });
  }

  if (call.status === "completed" || call.status === "failed" || call.status === "canceled") {
    // Terminal already recorded via polling; do not double-process.
    return NextResponse.json({ ok: true, alreadyTerminal: true });
  }

  const recipient = event.data.recipients?.[0];
  const rawResult = recipient?.structured_result ?? event.data.structured_result;
  const transcript = (recipient?.attempts?.[0]?.transcript_turns ?? []).map((t) => ({
    offsetSeconds: t.offset_seconds,
    speaker: (t.speaker as "bot" | "user" | "unknown") ?? "unknown",
    text: t.text,
  }));

  const status =
    event.type === "call.failed" || event.data.status === "failed"
      ? "failed"
      : event.type === "call.result_validation_failed"
        ? "failed"
        : "completed";

  logCalle("WEBHOOK RECEIVED", { eventId: event.id, type: event.type, calleCallId: event.data.id, status });

  await onCallTerminal(call.id, {
    status: status as "completed" | "failed",
    result: status === "completed" ? normalizePhoneResult(rawResult) : null,
    summary: recipient?.summary ?? event.data.summary ?? null,
    taskCompleted: event.data.task_completed ?? null,
    completionConfidence: event.data.completion_confidence?.score ?? null,
    evidence: event.data.evidence ?? [],
    failureCode: event.data.failure_code ?? (event.type === "call.result_validation_failed" ? "result_validation_failed" : null),
    failureMessage: event.data.failure_message ?? null,
  }, store);

  // Persist transcript separately for audit completeness.
  if (transcript.length > 0) {
    await store.updateCall(call.id, { transcript });
  }

  return NextResponse.json({ ok: true });
}
