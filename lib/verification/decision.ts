import { randomUUID } from "node:crypto";
import type {
  Candidate,
  Claim,
  ConstraintEvaluation,
  ConstraintSpec,
  Decision,
  DecisionCandidate,
} from "@/lib/domain/types";
import { constraintSatisfiedWithConfidence } from "@/lib/verification/confidence";

/**
 * Decision engine (deterministic).
 *
 * A candidate is VIABLE only when every hard constraint has a verified claim
 * (deterministic pass + attached evidence). Soft preferences break ties.
 * The engine never invents success: if no candidate is viable the decision is
 * `no_match`, with the per-candidate failure breakdown the UI shows.
 */

const nowIso = () => new Date().toISOString();

export function rankCandidates(
  candidates: Candidate[],
  claims: Claim[],
  hardConstraints: ConstraintSpec[],
  softConstraints: ConstraintSpec[],
  evaluationsByCandidate: Map<string, ConstraintEvaluation[]>,
): DecisionCandidate[] {
  const ranked: DecisionCandidate[] = [];

  for (const candidate of candidates) {
    const evals = evaluationsByCandidate.get(candidate.id) ?? [];
    const candidateClaims = claims.filter((c) => c.candidateId === candidate.id);
    const reasons: string[] = [];

    let verifiedHard = 0;
    let failedHard = 0;
    let unknownHard = 0;

    for (const constraint of hardConstraints) {
      const ev = evals.find((e) => e.constraintId === constraint.id);
      if (!ev) {
        unknownHard += 1;
        continue;
      }
      const { satisfied } = constraintSatisfiedWithConfidence(ev, candidateClaims);
      if (ev.status === "fail") {
        failedHard += 1;
        reasons.push(ev.reason);
      } else if (satisfied && ev.status === "pass") {
        verifiedHard += 1;
      } else {
        unknownHard += 1;
        reasons.push(`${constraint.label}: ${ev.reason}`);
      }
    }

    // Soft preferences only affect ranking, never viability.
    let softBonus = 0;
    const priceClaim = candidateClaims.find((c) => c.type === "price" && c.status === "verified");
    if (priceClaim && typeof priceClaim.value === "object" && priceClaim.value) {
      const amount = (priceClaim.value as { amount?: number }).amount;
      const cheapest = softConstraints.find((c) => c.kind === "price_max");
      if (typeof amount === "number" && cheapest) {
        const ceiling = Number(cheapest.params.max ?? amount);
        if (ceiling > 0) softBonus += Math.max(0, (ceiling - amount) / ceiling) * 3;
      }
    }
    if (candidate.distanceKm != null) softBonus += Math.max(0, 2 - candidate.distanceKm / 25);

    const reachable = candidate.status !== "unreachable";
    const viable = reachable && failedHard === 0 && unknownHard === 0 && verifiedHard === hardConstraints.length;

    const score =
      verifiedHard * 10 - failedHard * 6 - unknownHard * 2 + softBonus + (viable ? 5 : 0);

    if (!reachable) reasons.push("candidate unreachable");
    if (candidate.rejectionReason && !reasons.includes(candidate.rejectionReason)) {
      reasons.push(candidate.rejectionReason);
    }

    ranked.push({
      candidateId: candidate.id,
      name: candidate.name,
      verifiedHard,
      failedHard,
      unknownHard,
      score: Math.round(score * 100) / 100,
      viable,
      reasons,
    });
  }

  return ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function buildDecision(
  taskId: string,
  candidates: Candidate[],
  claims: Claim[],
  hardConstraints: ConstraintSpec[],
  softConstraints: ConstraintSpec[],
  evaluationsByCandidate: Map<string, ConstraintEvaluation[]>,
  taskConfidence: number,
): Decision {
  const ranked = rankCandidates(
    candidates,
    claims,
    hardConstraints,
    softConstraints,
    evaluationsByCandidate,
  );
  const winner = ranked.find((r) => r.viable) ?? null;

  const unresolved: string[] = [];
  if (!winner) {
    for (const constraint of hardConstraints) {
      const anyPass = [...evaluationsByCandidate.values()].some((evals) =>
        evals.some((e) => e.constraintId === constraint.id && e.status === "pass"),
      );
      if (!anyPass) unresolved.push(constraint.label);
    }
  }

  // no_match: nothing was verified anywhere; partial: some PHONE-derived
  // constraints verified somewhere but no candidate satisfied all of them.
  // (Discovery-derived passes like distance don't count as progress.)
  const phoneDerivedIds = new Set(
    hardConstraints
      .filter((c) => c.kind !== "distance_max" && c.kind !== "custom")
      .map((c) => c.id),
  );
  const anyVerified = [...evaluationsByCandidate.values()].some((evals) =>
    evals.some((e) => e.status === "pass" && phoneDerivedIds.has(e.constraintId)),
  );
  const status: Decision["status"] = winner
    ? "success"
    : anyVerified
      ? "partial"
      : "no_match";
  const winnerCandidate = winner ? candidates.find((c) => c.id === winner.candidateId) : undefined;

  const explanation = winner
    ? winnerCandidate
      ? `${winnerCandidate.name} is the ${ranked.filter((r) => r.viable).length === 1 ? "only" : "best-ranked"} candidate that satisfied every hard requirement with evidence-backed claims.`
      : "A fully verified candidate was found."
    : status === "partial"
      ? `No candidate fully satisfied every hard requirement yet. Unresolved: ${unresolved.join(", ")}.`
      : "Every contacted candidate failed at least one hard requirement. No verified match exists under the current constraints.";

  return {
    id: randomUUID(),
    taskId,
    status,
    winnerCandidateId: winner?.candidateId ?? null,
    ranked,
    unresolvedConstraints: unresolved,
    confidence: winner ? taskConfidence : 0,
    explanation,
    createdAt: nowIso(),
  };
}
