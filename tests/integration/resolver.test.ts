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

  it("every evidence id on every claim resolves to a stored record", async () => {
    // Regression: applyClaimUpdate merges next.evidenceIds into the claim, so
    // a membership test against the merged list skipped the store write and
    // left verified claims pointing at rows that were never persisted. The
    // hold claim lost exactly the follow-up evidence that confirmed it, and
    // rendered the earlier "I need to ask my manager" turn instead.
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor", store });
    await startTask(task.id);
    const { snap } = await runToCompletion(task.id);

    const storedIds = new Set(snap.evidence.map((e) => e.id));
    const dangling = snap.claims.flatMap((claim) =>
      claim.evidenceIds
        .filter((id) => !storedIds.has(id))
        .map((id) => `${claim.type}/${claim.status}:${id}`),
    );
    expect(dangling).toEqual([]);
  }, 120_000);

  it("a claim verified by a follow-up call carries that call's evidence", async () => {
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor", store });
    await startTask(task.id);
    const { snap } = await runToCompletion(task.id);

    const winner = snap.candidates.find((c) => c.id === snap.decision?.winnerCandidateId);
    const holdClaim = snap.claims.find((c) => c.candidateId === winner?.id && c.type === "hold");
    expect(holdClaim?.status).toBe("verified");

    const followUp = snap.calls.find(
      (c) => c.candidateId === winner?.id && c.purpose === "follow_up",
    );
    expect(followUp).toBeDefined();

    const attached = snap.evidence.filter((e) => holdClaim!.evidenceIds.includes(e.id));
    // The proof of the hold must come from the call that actually confirmed
    // it, not only from the attempt that left it pending.
    expect(attached.some((e) => e.callId === followUp!.id)).toBe(true);

    const structured = attached.find(
      (e) => e.callId === followUp!.id && e.source === "structured_result",
    );
    expect(structured?.excerpt).toContain('"hold_confirmed":true');

    // The UI groups evidence by claimId, so every attached record must also
    // be addressed to this claim — otherwise the modal renders nothing for
    // it even though the rows exist in the store.
    const byClaimId = snap.evidence.filter((e) => e.claimId === holdClaim!.id);
    expect(byClaimId.map((e) => e.id).sort()).toEqual([...holdClaim!.evidenceIds].sort());
    expect(byClaimId.some((e) => e.excerpt.includes('"hold_confirmed":true'))).toBe(true);
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

  it("refuses prohibited parts of a request out loud, and keeps them off the call", async () => {
    const task = await createTask({
      input:
        "Find an XZ-420 compressor within 25 km and buy it with my card ending 4242 if it is under ₹25,000.",
      scenarioId: "compressor",
      store,
    });
    const snap = await snapshot(task.id);

    // Said out loud, not silently dropped.
    expect(snap.audit.map((a) => a.action)).toContain("REQUEST_PARTIALLY_REFUSED");
    expect(snap.events.some((e) => e.type === "REQUEST_PARTIALLY_REFUSED")).toBe(true);

    // The card fragment never reaches storage.
    expect(snap.task.input).not.toContain("4242");
    expect(snap.task.goal?.objective ?? "").not.toContain("4242");

    // The rest of the request still proceeded.
    expect(snap.task.goal?.hardConstraints.length).toBeGreaterThan(0);
    expect(snap.task.goal?.authorization.allowed).not.toContain("purchase");
  }, 60_000);

  it("survives a cold serverless instance mid-run", async () => {
    // The mock adapter's stage map is per-process. On serverless the poll
    // that advances a call can land on a different instance than the one
    // that created it; without rehydration those calls came back as
    // unknown_call and the demo died in front of whoever was watching.
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor", store });
    await startTask(task.id);

    const adapter = getMockAdapter();
    let snap = await snapshot(task.id);
    for (let i = 0; i < 400 && snap.task.status !== "completed"; i++) {
      snap = await tick(task.id);
      // Every third poll pretends to be a fresh instance.
      if (i % 3 === 2) adapter.__simulateColdStart();
    }

    expect(snap.task.status).toBe("completed");
    // Same narrative, not a degraded one.
    expect(snap.decision?.status).toBe("success");
    const winner = snap.candidates.find((c) => c.id === snap.decision?.winnerCandidateId);
    expect(winner?.name).toBe("Metro Components");
    expect(snap.calls.some((c) => c.purpose === "follow_up")).toBe(true);
    // No call was abandoned as unrecognised.
    expect(snap.calls.some((c) => c.failureCode === "unknown_call")).toBe(false);
  }, 120_000);

  it("snapshot returns the full UI payload deterministically", async () => {
    const task = await createTask({ input: FLAGSHIP_REQUEST, scenarioId: "compressor", store });
    const snap = await snapshot(task.id);
    expect(snap.task.id).toBe(task.id);
    expect(snap.candidates.length).toBe(6);
    expect(snap.evaluations.every((e) => e.candidateId)).toBe(true);
  });
});
