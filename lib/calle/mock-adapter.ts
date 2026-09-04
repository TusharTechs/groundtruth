import type { CallStatus, TranscriptTurn } from "@/lib/domain/types";
import type { AdapterCallInput, AdapterCallState, CalleAdapter } from "@/lib/calle/adapter";
import { logCalle } from "@/lib/calle/client";
import { findPersonaByPhone, type MockAttemptScript } from "@/lib/demo/scenarios";

/**
 * MockCalleAdapter — deterministic CALL-E simulator (DEMO MODE).
 *
 * - Never contacts CALL-E; every UI surface labels it DEMO MODE.
 * - Supplier personas are scripted per (phone, attempt) in lib/demo/scenarios.
 * - Each getCallState() poll advances the call ONE stage (dial -> conversation
 *   turns revealed pairwise -> terminal result), which is what makes the live
 *   timeline stream realistically without wall-clock dependence.
 * - Failure, ambiguity, and adaptive follow-up behavior are all scripted so
 *   the demo narrative is always reproducible.
 */

interface MockRuntime {
  calleCallId: string;
  script: MockAttemptScript;
  stage: number;
  createdAt: number;
}

const DEFAULT_SCRIPT: MockAttemptScript = {
  purpose: "verify",
  turns: [
    { offsetSeconds: 0, speaker: "bot", text: "Hi, this is GroundTruth, an automated verification assistant. Am I speaking with the right store?" },
    { offsetSeconds: 4, speaker: "user", text: "Yes, speaking. What is this about?" },
    { offsetSeconds: 8, speaker: "bot", text: "I am checking availability of a part on behalf of a buyer. Do you have it in stock right now?" },
    { offsetSeconds: 13, speaker: "user", text: "I would have to check the store; I cannot say for sure right now." },
    { offsetSeconds: 17, speaker: "bot", text: "Understood — no purchase is being made. Thank you for your time." },
  ],
  result: {
    availability: "uncertain",
    quantity: null,
    compatibility: null,
    price: null,
    currency: "INR",
    pickup_available: null,
    pickup_time: null,
    hold_available: null,
    hold_confirmed: null,
    hold_until: null,
    notes: "Store could not confirm availability during the call.",
  },
  evidence: ["The store said they would have to check and could not confirm availability."],
  completionConfidence: 0.4,
  taskCompleted: true,
  summary: "Availability remains uncertain; no definitive answers were given.",
};

export class MockCalleAdapter implements CalleAdapter {
  readonly mode = "mock" as const;
  private runtimes = new Map<string, MockRuntime>();

  async createCall(input: AdapterCallInput): Promise<{ calleCallId: string }> {
    // Deterministic id: identical logical calls (same idempotency key) share
    // a calleCallId, mirroring real-mode idempotency.
    const calleCallId = `mock_${input.idempotencyKey}`;
    const attempt = Number(input.metadata.attempt ?? 1);
    const purpose = (input.metadata.purpose as "verify" | "follow_up") ?? "verify";
    const persona = findPersonaByPhone(
      input.phone,
      typeof input.metadata.scenarioId === "string" ? input.metadata.scenarioId : undefined,
    );
    const script =
      persona?.attempts.find((a) => a.purpose === purpose && a.attempt === attempt) ??
      persona?.attempts.find((a) => a.purpose === purpose) ??
      DEFAULT_SCRIPT;

    this.runtimes.set(calleCallId, {
      calleCallId,
      script,
      stage: 0,
      createdAt: Date.now(),
    });
    logCalle("CALL CREATED (MOCK)", {
      calleCallId,
      taskId: input.metadata.taskId,
      candidateId: input.metadata.candidateId,
      persona: persona?.name ?? "generic",
      demoMode: true,
    });
    return { calleCallId };
  }

  async getCallState(calleCallId: string): Promise<AdapterCallState> {
    const rt = this.runtimes.get(calleCallId);
    if (!rt) {
      return {
        calleCallId,
        status: "failed",
        transcript: [],
        result: null,
        summary: null,
        taskCompleted: false,
        completionConfidence: null,
        evidence: [],
        failureCode: "unknown_call",
        failureMessage: "Mock call not found",
      };
    }

    // Advance one stage per poll: dialing stages first, then reveal the
    // conversation in bot+user pairs, then the terminal result.
    rt.stage += 1;
    const totalTurnStages = Math.ceil(rt.script.turns.length / 2);
    const dialStages = rt.script.failure ? 2 : 1;
    const totalStages = dialStages + totalTurnStages;

    if (rt.script.failure && rt.stage >= totalStages) {
      logCalle("CALL COMPLETED (MOCK)", {
        calleCallId,
        status: "failed",
        failureCode: rt.script.failure.code,
        demoMode: true,
      });
      return terminal(rt, "failed");
    }

    if (rt.stage >= totalStages) {
      logCalle("CALL COMPLETED (MOCK)", {
        calleCallId,
        status: "completed",
        taskCompleted: rt.script.taskCompleted,
        completionConfidence: rt.script.completionConfidence,
        demoMode: true,
      });
      logCalle("RESULT RECEIVED (MOCK)", {
        calleCallId,
        structuredResult: rt.script.result,
        demoMode: true,
      });
      return terminal(rt, "completed");
    }

    if (rt.stage <= dialStages) {
      const status: CallStatus = rt.stage === 1 ? "dialing" : "dialing";
      return snapshot(rt, status, []);
    }

    const revealedTurns = rt.stage - dialStages;
    const visibleCount = Math.min(rt.script.turns.length, revealedTurns * 2);
    return snapshot(rt, "in_progress", rt.script.turns.slice(0, visibleCount));
  }

  /** Force terminal state (used when a webhook-equivalent shortcut is needed). */
  completeNow(calleCallId: string): AdapterCallState | null {
    const rt = this.runtimes.get(calleCallId);
    if (!rt) return null;
    const status: CallStatus = rt.script.failure ? "failed" : "completed";
    logCalle("CALL COMPLETED (MOCK)", { calleCallId, status, demoMode: true });
    return terminal(rt, status);
  }
}

function snapshot(rt: MockRuntime, status: CallStatus, transcript: TranscriptTurn[]): AdapterCallState {
  return {
    calleCallId: rt.calleCallId,
    status,
    transcript,
    result: null,
    summary: null,
    taskCompleted: null,
    completionConfidence: null,
    evidence: [],
    failureCode: rt.script.failure?.code ?? null,
    failureMessage: rt.script.failure?.message ?? null,
  };
}

function terminal(rt: MockRuntime, status: CallStatus): AdapterCallState {
  const failed = status === "failed";
  return {
    calleCallId: rt.calleCallId,
    status,
    transcript: failed ? [] : rt.script.turns,
    result: failed ? null : rt.script.result,
    summary: failed ? null : rt.script.summary,
    taskCompleted: failed ? false : rt.script.taskCompleted,
    completionConfidence: failed ? null : rt.script.completionConfidence,
    evidence: failed ? [] : rt.script.evidence,
    failureCode: rt.script.failure?.code ?? null,
    failureMessage: rt.script.failure?.message ?? null,
  };
}
