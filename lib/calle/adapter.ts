import type { JsonObject } from "@call-e/calle";
import type { CallStatus, PhoneResult, TranscriptTurn } from "@/lib/domain/types";
import { buildWebhookUrl, getCalleClient, logCalle } from "@/lib/calle/client";
import { normalizePhoneResult } from "@/lib/calle/schemas";

/**
 * CalleAdapter: the single seam between GroundTruth orchestration and CALL-E.
 *
 * Real mode uses the official @call-e/calle SDK:
 *   client.calls.create(...)   with an idempotency key derived from the task
 *   client.calls.get(callId)   polled by the orchestrator's tick loop
 *   webhook /api/webhook/calle completes calls without polling latency
 *
 * The interface is intentionally small so MockCalleAdapter can simulate the
 * same lifecycle deterministically (DEMO MODE).
 */

export interface AdapterCallInput {
  /** Full composed call task text (already safety-checked). */
  task: string;
  phone: string;
  region: string;
  locale: string;
  resultSchema: JsonObject;
  metadata: Record<string, unknown>;
  /** Deterministic idempotency key: same logical call never dials twice. */
  idempotencyKey: string;
}

export interface AdapterCallState {
  calleCallId: string;
  status: CallStatus;
  /** Transcript turns visible so far (grows as the call progresses). */
  transcript: TranscriptTurn[];
  result: PhoneResult | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: number | null;
  evidence: string[];
  failureCode: string | null;
  failureMessage: string | null;
}

export interface CalleAdapter {
  readonly mode: "mock" | "real";
  createCall(input: AdapterCallInput): Promise<{ calleCallId: string }>;
  getCallState(calleCallId: string): Promise<AdapterCallState>;
}

// ---------------------------------------------------------------------------
// Real adapter (official SDK)
// ---------------------------------------------------------------------------

export class RealCalleAdapter implements CalleAdapter {
  readonly mode = "real" as const;

  async createCall(input: AdapterCallInput): Promise<{ calleCallId: string }> {
    const client = getCalleClient();
    const webhookUrl = buildWebhookUrl();
    const call = await client.calls.create(
      {
        task: input.task,
        recipient: {
          phone: input.phone,
          region: input.region,
          locale: input.locale,
        },
        resultSchema: input.resultSchema,
        metadata: input.metadata,
        ...(webhookUrl ? { webhookUrl } : {}),
      },
      { idempotencyKey: input.idempotencyKey },
    );
    logCalle("CALL CREATED", {
      calleCallId: call.id,
      status: call.status,
      taskId: input.metadata.taskId,
      candidateId: input.metadata.candidateId,
      idempotencyKey: input.idempotencyKey,
    });
    return { calleCallId: call.id };
  }

  async getCallState(calleCallId: string): Promise<AdapterCallState> {
    const client = getCalleClient();
    const call = await client.calls.get(calleCallId);
    const state = mapSdkCall(call);
    if (
      call.status === "completed" ||
      call.status === "failed" ||
      call.status === "canceled"
    ) {
      logCalle("CALL COMPLETED", {
        calleCallId: call.id,
        status: call.status,
        taskCompleted: call.taskCompleted,
        completionConfidence: call.completionConfidence?.score ?? null,
      });
      if (call.structuredResult) {
        logCalle("RESULT RECEIVED", { calleCallId: call.id, structuredResult: call.structuredResult });
      }
    }
    return state;
  }
}

/** Map an SDK Call to our adapter state (single source of truth for both paths). */
export function mapSdkCall(call: {
  id: string;
  status: string;
  structuredResult: JsonObject | null;
  summary: string | null;
  taskCompleted: boolean | null;
  completionConfidence: { score: number } | null;
  evidence: string[];
  failureCode: string | null;
  failureMessage: string | null;
  recipients?: Array<{
    structuredResult?: JsonObject | null;
    summary?: string | null;
    attempts?: Array<{
      transcriptTurns?: Array<{ offset_seconds: number | null; speaker: string; text: string }>;
    }>;
  }>;
}): AdapterCallState {
  const recipient = call.recipients?.[0];
  const rawResult = recipient?.structuredResult ?? call.structuredResult;
  const transcript: TranscriptTurn[] = (recipient?.attempts?.[0]?.transcriptTurns ?? []).map(
    (t) => ({
      offsetSeconds: t.offset_seconds,
      speaker: (t.speaker as TranscriptTurn["speaker"]) ?? "unknown",
      text: t.text,
    }),
  );
  return {
    calleCallId: call.id,
    status: call.status as CallStatus,
    transcript,
    result: rawResult ? normalizePhoneResult(rawResult) : null,
    summary: recipient?.summary ?? call.summary,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence?.score ?? null,
    evidence: call.evidence ?? [],
    failureCode: call.failureCode,
    failureMessage: call.failureMessage,
  };
}
