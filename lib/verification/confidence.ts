import type { CallRecord, Claim, ConstraintEvaluation } from "@/lib/domain/types";

/**
 * Confidence model.
 *
 * Confidence is NOT cosmetic and never overrides verification state:
 *  - A claim's confidence is the CALL-E completion confidence of the call
 *    that produced it (default 0.8 in mock mode when CALL-E reports none).
 *  - Ambiguous evidence keeps status `unknown` regardless of confidence
 *    (enforced in claims.ts, re-asserted here for decisions).
 *  - A failed hard constraint is failed at ANY confidence level.
 *  - Task-level confidence is the minimum over the winning candidate's hard
 *    constraints — one weak leg lowers the whole verdict.
 */

export const DEFAULT_CALL_CONFIDENCE = 0.8;

export function callConfidence(call: CallRecord): number {
  return call.completionConfidence ?? DEFAULT_CALL_CONFIDENCE;
}

/** Combine CALL-E's judgment with our deterministic state for one claim. */
export function claimConfidence(claim: Claim, call: CallRecord): number {
  if (claim.status !== "verified") return 0;
  return clamp(callConfidence(call));
}

/** Task confidence: weakest verified hard-constraint leg of the winner. */
export function decisionConfidence(
  evaluations: ConstraintEvaluation[],
  claims: Claim[],
): number {
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const confidences: number[] = [];
  for (const ev of evaluations) {
    if (ev.status === "pass" && ev.claimId) {
      const claim = claimById.get(ev.claimId);
      if (claim) confidences.push(claim.status === "verified" ? claim.confidence : 0.5);
    }
  }
  if (confidences.length === 0) return 0;
  return clamp(Math.min(...confidences));
}

/**
 * Guard used by the decision engine: a constraint only counts as satisfied
 * when BOTH the deterministic evaluation passes AND the backing claim (if
 * any) is verified. High model confidence never flips a fail/unknown.
 */
export function constraintSatisfiedWithConfidence(
  evaluation: ConstraintEvaluation,
  claims: Claim[],
): { satisfied: boolean; effectiveConfidence: number } {
  if (evaluation.status !== "pass") {
    return { satisfied: false, effectiveConfidence: 0 };
  }
  const claim = evaluation.claimId
    ? claims.find((c) => c.id === evaluation.claimId)
    : undefined;
  if (claim && claim.status !== "verified") {
    // Pass evaluation without a verified claim stays provisional.
    return { satisfied: false, effectiveConfidence: 0 };
  }
  return { satisfied: true, effectiveConfidence: claim?.confidence ?? 0.75 };
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
