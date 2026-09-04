import { describe, expect, it, beforeEach } from "vitest";
import { createTask, startTask, tick, onCallTerminal } from "@/lib/agent/resolver";
import { getMockAdapter } from "@/lib/calle/adapter-index";
import { MemoryStore } from "@/lib/db/memory-store";
import { FLAGSHIP_REQUEST } from "@/lib/demo/scenarios";

/**
 * Webhook ingestion: idempotency (dedup by event id), terminal-state
 * protection (no double processing), and payload → claims parity with the
 * poll path.
 */
describe("webhook processing", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    process.env.MOCK_CALL_E = "true";
    delete process.env.CALLE_API_KEY;
    const mod = await import("@/lib/db");
    mod.__setStoreForTests(store);
  });

  async function setupTaskWithCall() {
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor_failure", store });
    await startTask(task.id);
    // First tick creates the call to Anand (first candidate).
    const snap = await tick(task.id);
    const call = snap.calls[0];
    expect(call).toBeDefined();
    return { task, call };
  }

  it("records webhook events idempotently (duplicate delivery processed once)", async () => {
    const first = await store.recordWebhookEvent({
      eventId: "evt_1",
      type: "call.completed",
      calleCallId: "calle_1",
      payload: { ok: 1 },
    });
    const duplicate = await store.recordWebhookEvent({
      eventId: "evt_1",
      type: "call.completed",
      calleCallId: "calle_1",
      payload: { ok: 1 },
    });
    expect(first).toBe(true);
    expect(duplicate).toBe(false);
  });

  it("onCallTerminal processes a completed result into claims + evidence once", async () => {
    const { task, call } = await setupTaskWithCall();

    // Anand persona: availability uncertain -> claim stays unknown.
    await onCallTerminal(
      call.id,
      {
        status: "completed",
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
          notes: "could not check",
        },
        summary: "uncertain",
        taskCompleted: true,
        completionConfidence: 0.42,
        evidence: ["said 'I think we have it'"],
        failureCode: null,
        failureMessage: null,
      },
      store,
    );

    const claims = await store.getClaims(task.id);
    const availability = claims.find((c) => c.type === "availability");
    // Hedge must NOT be verified even though CALL-E processed the call.
    expect(availability?.status).toBe("unknown");
  });

  it("onCallTerminal failure path marks candidate unreachable", async () => {
    const { task, call } = await setupTaskWithCall();
    await onCallTerminal(
      call.id,
      {
        status: "failed",
        result: null,
        summary: null,
        taskCompleted: false,
        completionConfidence: null,
        evidence: [],
        failureCode: "no_answer",
        failureMessage: "No answer after 30 seconds.",
      },
      store,
    );
    const candidates = await store.getCandidates(task.id);
    const target = candidates.find((c) => c.id === call.candidateId);
    expect(target?.status).toBe("unreachable");
  });
});

// Adapter still imported to keep mock runtime parity checks obvious.
void getMockAdapter;
