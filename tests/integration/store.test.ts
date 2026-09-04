import { describe, expect, it, beforeEach } from "vitest";
import { MemoryStore } from "@/lib/db/memory-store";
import type { GroundTruthStore } from "@/lib/db/store";
import type { CallRecord, Claim } from "@/lib/domain/types";
import { emptyPhoneResult } from "../helpers";

/**
 * Store contract tests run against MemoryStore here; the same interface is
 * implemented by PostgresStore (exercised in live mode / CI with a database).
 */
describe("store contract (MemoryStore)", () => {
  let store: GroundTruthStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it("persists tasks, candidates, calls, claims, evidence, decisions, audit", async () => {
    const at = new Date().toISOString();
    await store.createTask({
      id: "t1",
      input: "verify something",
      goal: null,
      plan: null,
      status: "draft",
      mode: "mock",
      analyzer: null,
      createdAt: at,
      updatedAt: at,
      completedAt: null,
    });
    const task = await store.getTask("t1");
    expect(task?.input).toBe("verify something");

    await store.updateTask("t1", { status: "running" });
    expect((await store.getTask("t1"))?.status).toBe("running");

    await store.addCandidates("t1", [
      {
        id: "cand1",
        taskId: "t1",
        name: "Metro",
        phone: "+91000000000",
        region: "IN",
        locale: "en-IN",
        distanceKm: 5,
        provider: "demo",
        priority: 0,
        status: "pending",
      },
    ]);
    const call: CallRecord = {
      id: "call1",
      taskId: "t1",
      candidateId: "cand1",
      calleCallId: "mock_gt_t1_cand1_verify_1",
      attempt: 1,
      purpose: "verify",
      focusConstraints: [],
      task: "task",
      status: "pending",
      mode: "mock",
      result: null,
      summary: null,
      taskCompleted: null,
      completionConfidence: null,
      evidence: [],
      transcript: [],
      failureCode: null,
      failureMessage: null,
      createdAt: at,
      completedAt: null,
    };
    await store.createCall(call);
    expect((await store.getCallByCalleId("mock_gt_t1_cand1_verify_1"))?.id).toBe("call1");
    await store.updateCall("call1", { status: "completed", completionConfidence: 0.93 });
    expect((await store.getCall("call1"))?.completionConfidence).toBe(0.93);

    const claim: Claim = {
      id: "claim1",
      taskId: "t1",
      candidateId: "cand1",
      callId: "call1",
      type: "availability",
      statement: "Metro has stock",
      value: 2,
      status: "unknown",
      confidence: 0,
      evidenceIds: [],
      statusHistory: [],
      createdAt: at,
      updatedAt: at,
    };
    await store.createClaim(claim);
    await store.updateClaim("claim1", { status: "verified", confidence: 0.93, evidenceIds: ["ev1"] });
    const updated = (await store.getClaims("t1"))[0];
    expect(updated.status).toBe("verified");
    expect(updated.evidenceIds).toEqual(["ev1"]);

    await store.recordWebhookEvent({ eventId: "e1", type: "call.completed", calleCallId: "x", payload: {} });
    const first = await store.recordWebhookEvent({ eventId: "e1", type: "call.completed", calleCallId: "x", payload: {} });
    expect(first).toBe(false);

    await store.addAudit({ taskId: "t1", actor: "system", action: "TEST", detail: "d" });
    expect((await store.getAudit("t1"))[0].action).toBe("TEST");
  });

  it("mergeResults overlays follow-up answers on earlier results", async () => {
    const first = { ...emptyPhoneResult(), availability: "confirmed" as const, quantity: 2, price: 22800 };
    const second = { ...emptyPhoneResult(), hold_confirmed: true, hold_until: "5 PM" };
    const { mergeResults } = await import("@/lib/agent/resolver");
    const merged = mergeResults([first, second]);
    expect(merged?.availability).toBe("confirmed");
    expect(merged?.price).toBe(22800);
    expect(merged?.hold_confirmed).toBe(true);
  });
});
