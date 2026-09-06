import type {
  CallRecord,
  Claim,
  ConstraintSpec,
  VerificationGoal,
} from "@/lib/domain/types";
import { evaluateConstraint } from "@/lib/verification/constraints";

/**
 * Adaptive Strategy Engine.
 *
 * After each terminal call it inspects the deterministic state and decides:
 *  - askAnother: same candidate again (follow-up) when a constraint is
 *    verifiable but unresolved (e.g. hold pending manager approval).
 *  - tryNextCandidate: move on when this candidate failed a hard constraint
 *    or cannot resolve an unknown.
 *  - stop: stopping rules satisfied.
 *
 * The engine reacts to STATE, never to a fixed script: the second question
 * is generated because the first response left the constraint UNKNOWN.
 */

export interface StrategyDecision {
  kind: "follow_up" | "next_candidate" | "stop";
  reason: string;
  /** Constraints the follow-up call should focus on. */
  focusConstraints: string[];
}

export interface StrategyContext {
  goal: VerificationGoal;
  /** Constraints still unresolved for the current candidate. */
  pendingConstraints: Array<{ constraint: ConstraintSpec; evaluation: { status: string; reason: string } }>;
  failedConstraints: Array<{ constraint: ConstraintSpec; evaluation: { status: string; reason: string } }>;
  callsForCandidate: CallRecord[];
  claims: Claim[];
  plan: { stoppingRules: { maxCalls: number; maxCallsPerCandidate: number; stopOnFirstFullyVerified: boolean } };
  hasViableWinner: boolean;
  remainingCandidates: number;
}

export function decideNextAction(ctx: StrategyContext): StrategyDecision {
  const { pendingConstraints, failedConstraints, callsForCandidate, plan } = ctx;

  // 1. Stop: a fully verified winner exists and the plan says stop early.
  if (ctx.hasViableWinner && plan.stoppingRules.stopOnFirstFullyVerified) {
    return { kind: "stop", reason: "Fully verified winner found — stopping early.", focusConstraints: [] };
  }

  // 2. Stop: global call budget exhausted.
  const totalCalls = ctx.callsForCandidate.length;
  if (totalCalls >= plan.stoppingRules.maxCallsPerCandidate && !ctx.hasViableWinner) {
    if (ctx.remainingCandidates > 0) return nextCandidate(ctx);
    return {
      kind: "stop",
      reason: "Call budget exhausted and no viable winner remains.",
      focusConstraints: [],
    };
  }

  // 3. Follow-up: a pending constraint is resolvable with one more question
  //    (e.g. hold needs manager approval). Never follow up on failures.
  if (
    failedConstraints.length === 0 &&
    pendingConstraints.length > 0 &&
    callsForCandidate.length < plan.stoppingRules.maxCallsPerCandidate
  ) {
    return {
      kind: "follow_up",
      reason: `Resolvable unknowns remain: ${pendingConstraints.map((p) => p.constraint.label).join(", ")}.`,
      focusConstraints: pendingConstraints.map((p) => p.constraint.id),
    };
  }

  // 4. This candidate cannot improve — move on.
  return nextCandidate(ctx);
}

function nextCandidate(ctx: StrategyContext): StrategyDecision {
  if (ctx.remainingCandidates <= 0) {
    return {
      kind: "stop",
      reason: "No untried candidates remain.",
      focusConstraints: [],
    };
  }
  return {
    kind: "next_candidate",
    reason:
      ctx.failedConstraints.length > 0
        ? `Candidate failed a hard requirement (${ctx.failedConstraints.map((f) => f.constraint.label).join(", ")}).`
        : "Candidate could not resolve the remaining unknowns within the call budget.",
    focusConstraints: [],
  };
}

/**
 * Which constraints should a follow-up call focus on? Only constraints whose
 * evaluation is `unknown` AND that the transcript suggests are resolvable
 * (the supplier engaged but could not answer yet).
 */
export function resolvablePending(
  goal: VerificationGoal,
  calls: CallRecord[],
  _claims: Claim[],
): Array<{ constraint: ConstraintSpec; evaluation: { status: string; reason: string } }> {
  const lastCall = calls.at(-1);
  if (!lastCall || lastCall.status !== "completed") return [];

  const pending: Array<{ constraint: ConstraintSpec; evaluation: { status: string; reason: string } }> = [];
  for (const constraint of goal.hardConstraints) {
    const evaluation = evaluateConstraint(constraint, lastCall.result, { distanceKm: null });
    if (evaluation.status !== "unknown") continue;
    // Constraint-level resolvability heuristics: the mock scenario scripts
    // hold-approval and catalog-check follow-ups; anything else is not worth
    // a second call.
    if (constraint.kind === "hold_until" && holdIsStillOpen(lastCall.result)) {
      pending.push({ constraint, evaluation });
    } else if (constraint.kind === "compatibility" && lastCall.result?.compatibility === "uncertain") {
      pending.push({ constraint, evaluation });
    }
    // Availability hedges ("I think we have it") are NOT worth a follow-up:
    // the supplier already declined to check, so the constraint moves on.
  }
  return pending;
}

/**
 * Is a hold still worth one more call?
 *
 * Keyed on refusal, not on a positive flag. A real supplier saying "I can
 * hold it, but I need to check with my manager first" is the exact case a
 * follow-up exists for, and on a live call CALL-E extracted that as
 * `hold_available: null, hold_confirmed: false` — the earlier condition
 * required `hold_available === true`, which only the deterministic mock ever
 * produced, so the follow-up never fired against a real conversation.
 *
 * Only an explicit refusal closes the door; anything short of that is an
 * unresolved answer, and unresolved answers are what follow-ups are for.
 */
function holdIsStillOpen(result: CallRecord["result"]): boolean {
  if (!result) return false;
  if (result.hold_available === false) return false; // supplier said no
  if (result.hold_confirmed === true) return false; // already settled
  return true;
}

export function failedConstraintsFor(
  goal: VerificationGoal,
  calls: CallRecord[],
): Array<{ constraint: ConstraintSpec; evaluation: { status: string; reason: string } }> {
  const failed: Array<{ constraint: ConstraintSpec; evaluation: { status: string; reason: string } }> = [];
  const best = calls
    .filter((c) => c.status === "completed")
    .map((c) => c.result)
    .at(-1);
  if (!best) return failed;
  for (const constraint of goal.hardConstraints) {
    const evaluation = evaluateConstraint(constraint, best, { distanceKm: null });
    if (evaluation.status === "fail") failed.push({ constraint, evaluation });
  }
  return failed;
}

