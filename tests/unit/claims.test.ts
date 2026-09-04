import { describe, expect, it } from "vitest";
import { extractClaim, applyClaimUpdate, MIN_COMPLETION_CONFIDENCE, claimTypeFromConstraintKind } from "@/lib/verification/claims";
import { buildEvidenceForClaim } from "@/lib/verification/evidence";
import type { CallRecord, Candidate, Claim, ConstraintSpec, TranscriptTurn } from "@/lib/domain/types";
import { emptyPhoneResult } from "../helpers";

const candidate: Candidate = {
  id: "cand_1",
  taskId: "t1",
  name: "Metro Components",
  phone: "+918000000000",
  region: "IN",
  locale: "en-IN",
  distanceKm: 18.4,
  provider: "demo",
  priority: 0,
  status: "contacted",
};

function call(overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    id: "call_1",
    taskId: "t1",
    candidateId: candidate.id,
    calleCallId: "mock_x",
    attempt: 1,
    purpose: "verify",
    focusConstraints: [],
    task: "task text",
    status: "completed",
    mode: "mock",
    result: emptyPhoneResult(),
    summary: null,
    taskCompleted: true,
    completionConfidence: 0.93,
    evidence: [],
    transcript: [],
    failureCode: null,
    failureMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function spec(kind: ConstraintSpec["kind"]): ConstraintSpec {
  return {
    id: `c_${kind}`,
    kind,
    label: kind,
    hard: true,
    params: {},
    question: "q",
    claimKey: "x",
  };
}

const availabilitySpec = spec("availability");
const compatibilitySpec = spec("compatibility");
const holdSpec = spec("hold_until");

describe("claim lifecycle", () => {
  it("hedges never become verified: availability=unknown keeps status unknown", () => {
    const result = { ...emptyPhoneResult(), availability: "uncertain" as const };
    const claim = extractClaim(availabilitySpec, call({ result }), candidate, true);
    expect(claim.status).toBe("unknown");
    expect(claim.confidence).toBe(0);
  });

  it("explicit confirmation with evidence becomes verified with call confidence", () => {
    const result = { ...emptyPhoneResult(), availability: "confirmed" as const, quantity: 2 };
    const claim = extractClaim(availabilitySpec, call({ result }), candidate, true);
    expect(claim.status).toBe("verified");
    expect(claim.confidence).toBe(0.93);
  });

  it("explicit confirmation WITHOUT evidence stays unknown", () => {
    const result = { ...emptyPhoneResult(), availability: "confirmed" as const };
    const claim = extractClaim(availabilitySpec, call({ result }), candidate, false);
    expect(claim.status).toBe("unknown");
  });

  it(`low CALL-E confidence (< ${MIN_COMPLETION_CONFIDENCE}) downgrades to unknown even with evidence`, () => {
    const result = { ...emptyPhoneResult(), availability: "confirmed" as const };
    const lowConfidence = call({ result, completionConfidence: 0.3 });
    const claim = extractClaim(availabilitySpec, lowConfidence, candidate, true);
    expect(claim.status).toBe("unknown");
  });

  it("not_available / not_compatible / hold impossible are failed claims", () => {
    const r1 = { ...emptyPhoneResult(), availability: "not_available" as const };
    expect(extractClaim(availabilitySpec, call({ result: r1 }), candidate, true).status).toBe("failed");
    const r2 = { ...emptyPhoneResult(), compatibility: "not_compatible" as const };
    expect(extractClaim(compatibilitySpec, call({ result: r2 }), candidate, true).status).toBe("failed");
    const r3 = { ...emptyPhoneResult(), hold_available: false };
    expect(extractClaim(holdSpec, call({ result: r3 }), candidate, true).status).toBe("failed");
  });

  it("verified claims are immutable under re-confirmation", () => {
    const result = { ...emptyPhoneResult(), hold_available: true, hold_confirmed: true, hold_until: "5 PM" };
    const first = extractClaim(holdSpec, call({ result }), candidate, true);
    first.evidenceIds = ["ev1"];
    const again = extractClaim(holdSpec, call({ result }), candidate, true);
    const merged = applyClaimUpdate(first, again, true);
    expect(merged).toBe(first);
  });

  it("verified requires evidence on update too", () => {
    const unknown = extractClaim(availabilitySpec, call(), candidate, false);
    const verified = {
      ...extractClaim(
        availabilitySpec,
        call({ result: { ...emptyPhoneResult(), availability: "confirmed" as const } }),
        candidate,
        true,
      ),
      evidenceIds: [],
    };
    expect(() => applyClaimUpdate(unknown, verified, false)).toThrow();
  });

  it("status history records transitions", () => {
    const unknown = extractClaim(availabilitySpec, call(), candidate, false);
    const result = { ...emptyPhoneResult(), availability: "confirmed" as const };
    const verified = extractClaim(availabilitySpec, call({ result }), candidate, true);
    verified.evidenceIds = ["ev1"];
    const merged = applyClaimUpdate(unknown, verified, true);
    expect(merged.statusHistory.at(-1)?.from).toBe("unknown");
    expect(merged.statusHistory.at(-1)?.to).toBe("verified");
  });

  it("maps constraint kinds to claim types", () => {
    expect(claimTypeFromConstraintKind("price_max")).toBe("price");
    expect(claimTypeFromConstraintKind("hold_until")).toBe("hold");
    expect(claimTypeFromConstraintKind("pickup_today")).toBe("pickup");
    expect(claimTypeFromConstraintKind("quantity_min")).toBe("quantity");
  });
});

describe("evidence engine", () => {
  it("builds structured-result + transcript evidence and pulls supporting turns", () => {
    const transcript: TranscriptTurn[] = [
      { offsetSeconds: 0, speaker: "bot", text: "Do you have the XZ-420 in stock?" },
      { offsetSeconds: 5, speaker: "user", text: "Yes, we have two units right now." },
      { offsetSeconds: 9, speaker: "bot", text: "Is it compatible with HVAC-200?" },
      { offsetSeconds: 14, speaker: "user", text: "I checked the catalogue, yes compatible." },
    ];
    const result = { ...emptyPhoneResult(), availability: "confirmed" as const, quantity: 2 };
    const c = extractClaim(availabilitySpec, call({ result, transcript }), candidate, true);
    const evidence = buildEvidenceForClaim(c, call({ result, transcript }));
    expect(evidence.some((e) => e.source === "structured_result")).toBe(true);
    const transcriptEvidence = evidence.filter((e) => e.source === "calle_transcript");
    expect(transcriptEvidence.length).toBeGreaterThan(0);
    expect(transcriptEvidence.some((e) => e.excerpt.includes("two units"))).toBe(true);
  });
});

describe("unused var guard", () => {
  it("claim type union is importable", () => {
    const c: Claim | null = null;
    expect(c).toBeNull();
  });
});
