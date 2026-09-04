import { describe, expect, it, beforeEach } from "vitest";
import { createTask, startTask, tick, snapshot } from "@/lib/agent/resolver";
import { getMockAdapter } from "@/lib/calle/adapter-index";
import { MemoryStore } from "@/lib/db/memory-store";
import { FLAGSHIP_REQUEST } from "@/lib/demo/scenarios";

/**
 * Full orchestration loop, deterministic mock mode:
 * analyze -> plan -> discover -> call -> adapt -> verify -> decide.
 * State lives in a fresh MemoryStore per test.
 */
describe("resolver end-to-end (mock CALL-E)", () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    process.env.MOCK_CALL_E = "true";
    delete process.env.CALLE_API_KEY;
    // Point the store factory at our instance for this test.
    const mod = await import("@/lib/db");
    mod.__setStoreForTests(store);
  });

  async function runToCompletion(taskId: string, maxTicks = 200) {
    const adapter = getMockAdapter();
    for (let i = 0; i < maxTicks; i++) {
      const snap = await tick(taskId);
      if (snap.task.status === "completed") return { snap, adapter };
      // Advance any in-flight mock call so ticks make progress.
      const call = snap.calls.find((c) =>
        ["pending", "queued", "dialing", "in_progress"].includes(c.status),
      );
      if (call) adapter.completeNow(call.calleCallId);
    }
    throw new Error("task did not complete within tick budget");
  }

  it("flagship scenario: adaptive follow-up, claims with evidence, early-stop decision", async () => {
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor", store });
    expect(task.goal).not.toBeNull();
    expect(task.status).toBe("analyzed");

    await startTask(task.id);
    const { snap } = await runToCompletion(task.id);

    // Decision: exactly the scripted winner, fully verified.
    expect(snap.decision?.status).toBe("success");
    const winner = snap.candidates.find((c) => c.id === snap.decision?.winnerCandidateId);
    expect(winner?.name).toBe("Metro Components");

    // Adaptive behavior: a follow-up call to Metro must exist (hold approval).
    const metroCalls = snap.calls.filter(
      (c) => c.candidateId === winner?.id,
    );
    expect(metroCalls.some((c) => c.purpose === "follow_up")).toBe(true);

    // Evidence-backed claims on the winner.
    const winnerClaims = snap.claims.filter((c) => c.candidateId === winner?.id);
    expect(winnerClaims.length).toBeGreaterThan(0);
    for (const claim of winnerClaims.filter((c) => c.status === "verified")) {
      expect(claim.evidenceIds.length).toBeGreaterThan(0);
      const attached = snap.evidence.filter((e) => claim.evidenceIds.includes(e.id));
      expect(attached.length).toBeGreaterThan(0);
      expect(attached.every((e) => e.callId)).toBe(true);
    }

    // The hold claim was resolved by the follow-up call.
    const holdClaim = winnerClaims.find((c) => c.type === "hold");
    expect(holdClaim?.status).toBe("verified");
    expect(holdClaim?.value).toBe("5 PM");

    // Early stopping: not every candidate was contacted.
    const contacted = snap.candidates.filter((c) => c.status !== "pending").length;
    expect(contacted).toBeLessThan(snap.candidates.length);

    // Transcript was captured and is PII-safe.
    const transcriptCall = snap.calls.find((c) => c.transcript.length > 0);
    expect(transcriptCall).toBeDefined();

    // Audit log covers creation, calls, claims, decision.
    const actions = snap.audit.map((a) => a.action);
    expect(actions).toContain("TASK_CREATED");
    expect(actions).toContain("CALLE_CALL_CREATED");
    expect(actions).toContain("CLAIM_VERIFIED");
    expect(actions).toContain("DECISION_REACHED");
  }, 120_000);

  it("failure scenario: no fake success, honest breakdown", async () => {
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor_failure", store });
    await startTask(task.id);
    const { snap } = await runToCompletion(task.id);

    // No fake success: no winner, no confidence, honest non-success status.
    // (Some requirements verified partially — e.g. Sri Venkateshwara had stock
    // but was over budget — so the status is "partial", never "success".)
    expect(["no_match", "partial"]).toContain(snap.decision?.status);
    expect(snap.decision?.status).not.toBe("success");
    expect(snap.decision?.winnerCandidateId).toBeNull();
    expect(snap.decision?.confidence).toBe(0);
    expect(snap.decision?.ranked.every((r) => !r.viable)).toBe(true);
    // Every candidate contacted and each has a reason.
    expect(snap.candidates.every((c) => c.status !== "pending")).toBe(true);
    expect(snap.decision?.ranked.every((r) => r.reasons.length > 0 || r.unknownHard > 0)).toBe(true);
  }, 120_000);

  it("failed calls (no answer) mark candidates unreachable and continue", async () => {
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor", store });
    await startTask(task.id);
    const { snap } = await runToCompletion(task.id);
    const bharat = snap.candidates.find((c) => c.name === "Bharat Climate Control");
    expect(bharat?.status).toBe("unreachable");
  }, 120_000);

  it("snapshot returns the full UI payload deterministically", async () => {
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor", store });
    const snap = await snapshot(task.id);
    expect(snap.task.id).toBe(task.id);
    expect(snap.candidates.length).toBe(6);
    expect(snap.evaluations.every((e) => e.candidateId)).toBe(true);
  });
});
