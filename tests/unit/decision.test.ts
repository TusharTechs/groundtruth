import { describe, expect, it } from "vitest";
import { rankCandidates, buildDecision } from "@/lib/verification/decision";
import { decisionConfidence, constraintSatisfiedWithConfidence } from "@/lib/verification/confidence";
import type {
  Candidate,
  Claim,
  ConstraintEvaluation,
  ConstraintSpec,
} from "@/lib/domain/types";

const hardConstraints: ConstraintSpec[] = [
  { id: "c_avail", kind: "availability", label: "In stock", hard: true, params: {}, question: "q", claimKey: "availability" },
  { id: "c_price", kind: "price_max", label: "Under budget", hard: true, params: { max: 25000 }, question: "q", claimKey: "price" },
];

const softConstraints: ConstraintSpec[] = [];

function candidate(id: string, name: string, distanceKm: number | null = 10): Candidate {
  return {
    id,
    taskId: "t1",
    name,
    phone: "+91000000000",
    region: "IN",
    locale: "en-IN",
    distanceKm,
    provider: "demo",
    priority: 0,
    status: "contacted",
  };
}

function claim(candidateId: string, type: Claim["type"], status: Claim["status"], value: unknown = null, confidence = 0.9): Claim {
  return {
    id: `claim_${candidateId}_${type}`,
    taskId: "t1",
    candidateId,
    type,
    statement: "s",
    value,
    status,
    confidence: status === "verified" ? confidence : 0,
    evidenceIds: status === "verified" ? ["ev"] : [],
    statusHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function evaluation(constraintId: string, status: ConstraintEvaluation["status"], claimId?: string): ConstraintEvaluation {
  return { constraintId, status, claimId, reason: "test" };
}

describe("decision engine", () => {
  it("viable only when every hard constraint has a verified claim", () => {
    const cand = candidate("A", "Metro");
    const claims = [
      claim("A", "availability", "verified", 2),
      claim("A", "price", "verified", { amount: 22800 }),
    ];
    const evals = new Map([
      ["A", [evaluation("c_avail", "pass", claims[0].id), evaluation("c_price", "pass", claims[1].id)]],
    ]);
    const ranked = rankCandidates([cand], claims, hardConstraints, softConstraints, evals);
    expect(ranked[0].viable).toBe(true);
  });

  it("a pass evaluation without a verified claim is NOT viable (no silent verify)", () => {
    const cand = candidate("A", "Metro");
    const claims = [claim("A", "availability", "unknown")];
    const evals = new Map([
      ["A", [evaluation("c_avail", "pass", claims[0].id), evaluation("c_price", "pass")]],
    ]);
    const ranked = rankCandidates([cand], claims, hardConstraints, softConstraints, evals);
    expect(ranked[0].viable).toBe(false);
    expect(ranked[0].unknownHard).toBeGreaterThan(0);
  });

  it("failed hard constraint blocks viability regardless of other passes", () => {
    const cand = candidate("B", "CoolTech");
    const claims = [
      claim("B", "availability", "verified", 1),
      claim("B", "price", "verified", { amount: 27500 }),
    ];
    const evals = new Map([
      ["B", [evaluation("c_avail", "pass", claims[0].id), evaluation("c_price", "fail")]],
    ]);
    const ranked = rankCandidates([cand], claims, hardConstraints, softConstraints, evals);
    expect(ranked[0].viable).toBe(false);
  });

  it("buildDecision returns no_match with unresolved constraint labels when nothing is viable", () => {
    const cand = candidate("C", "Nobody");
    const decision = buildDecision(
      "t1",
      [cand],
      [],
      hardConstraints,
      softConstraints,
      new Map([["C", [evaluation("c_avail", "unknown"), evaluation("c_price", "unknown")]]]),
      0,
    );
    expect(decision.status).toBe("no_match");
    expect(decision.winnerCandidateId).toBeNull();
    expect(decision.unresolvedConstraints).toContain("In stock");
    expect(decision.explanation).toMatch(/No fully verified|failed/i);
  });

  it("success decision names the only viable candidate", () => {
    const a = candidate("A", "Metro");
    const b = candidate("B", "CoolTech");
    const claims = [
      claim("A", "availability", "verified", 2, 0.93),
      claim("A", "price", "verified", { amount: 22800 }, 0.93),
      claim("B", "price", "verified", { amount: 27500 }),
    ];
    const evals = new Map([
      ["A", [evaluation("c_avail", "pass", claims[0].id), evaluation("c_price", "pass", claims[1].id)]],
      ["B", [evaluation("c_avail", "pass"), evaluation("c_price", "fail")]],
    ]);
    const decision = buildDecision("t1", [a, b], claims, hardConstraints, softConstraints, evals, 0.93);
    expect(decision.status).toBe("success");
    expect(decision.winnerCandidateId).toBe("A");
    expect(decision.explanation).toContain("only");
  });
});

describe("confidence model", () => {
  it("task confidence is the weakest verified leg", () => {
    const claims = [
      claim("A", "availability", "verified", 2, 0.93),
      claim("A", "price", "verified", { amount: 22800 }, 0.81),
    ];
    const evals = [
      evaluation("c_avail", "pass", claims[0].id),
      evaluation("c_price", "pass", claims[1].id),
    ];
    expect(decisionConfidence(evals, claims)).toBe(0.81);
  });

  it("satisfied flag requires a verified claim even when evaluation passes", () => {
    const verified = claim("A", "availability", "verified", 2, 0.9);
    expect(constraintSatisfiedWithConfidence(evaluation("c", "pass", verified.id), [verified]).satisfied).toBe(true);
    const unknown = claim("A", "availability", "unknown");
    expect(constraintSatisfiedWithConfidence(evaluation("c", "pass", unknown.id), [unknown]).satisfied).toBe(false);
    expect(constraintSatisfiedWithConfidence(evaluation("c", "fail"), []).satisfied).toBe(false);
  });

  it("high confidence never rescues a fail", () => {
    expect(constraintSatisfiedWithConfidence({ constraintId: "c", status: "fail", reason: "r" }, []).satisfied).toBe(false);
  });
});
