import type {
  Authorization,
  CallQuestion,
  PermittedAction,
  VerificationGoal,
  VerificationPlan,
} from "@/lib/domain/types";
import { actionForConstraintKind, assertActionAllowed } from "@/lib/safety/authorization";
import { assertCallTaskSafe, CALL_SAFETY_FOOTER } from "@/lib/safety/side-effects";

/**
 * Verification Planner.
 *
 * Turns a structured goal into a concrete call plan: per-constraint questions
 * (with fallbacks for hedged answers), the opening disclosure, authorization
 * gating per question, and stopping rules. Authorization violations throw at
 * plan time — before any call exists.
 */

const HOLD_DISCLOSURE =
  "no purchase is being made on this call — I am only asking you to reserve the item";

export function buildPlan(goal: VerificationGoal): VerificationPlan {
  const questions: CallQuestion[] = [];

  for (const constraint of goal.hardConstraints) {
    const action = actionForConstraintKind(constraint.kind);
    assertActionAllowed(goal.authorization, action);

    let question = constraint.question;
    let fallback: string | undefined;

    switch (constraint.kind) {
      case "compatibility":
        fallback = `Could you check the model compatibility for me before we finish? I want to be sure the ${goal.item} fits the ${goal.targetEquipment ?? "target equipment"}.`;
        break;
      case "availability":
        fallback = `To be clear: is the ${goal.item} physically in stock right now, or not?`;
        break;
      case "hold_until":
        question = `${constraint.question} (${HOLD_DISCLOSURE})`;
        break;
      default:
        break;
    }

    questions.push({
      constraintId: constraint.id,
      question,
      fallbackQuestion: fallback,
    });
  }

  return {
    questions,
    openingLine:
      "Hi, this is GroundTruth, an automated verification assistant calling on behalf of a buyer. I have a few quick factual questions — no purchase is being made on this call.",
    disclosure: goal.authorization.allowed.includes("request_hold")
      ? "This is an automated verification assistant. It will only ask factual questions and may request a temporary hold. It will not purchase, pay, or accept any offer."
      : "This is an automated verification assistant. It will only ask factual questions. It will not purchase, pay, or accept any offer.",
    stoppingRules: {
      stopOnFirstFullyVerified: true,
      maxCalls: 8,
      maxCallsPerCandidate: 2,
    },
    candidateLimit: 6,
  };
}

/**
 * Compose the CALL-E task text for one call. The safety footer is appended
 * here so every adapter call (mock or real) carries the same constraints,
 * and the result is run through the side-effect gate by the executor.
 */
export function composeCallTask(options: {
  goal: VerificationGoal;
  plan: VerificationPlan;
  candidate: { name: string; phone?: string; distanceKm?: number | null };
  questions: CallQuestion[];
  /** Reserved for attempt-aware composition on follow-up calls. */
  attempt: number;
  authorization: Authorization;
  priorContext?: string;
}): string {
  const { goal, plan, candidate, questions, authorization, priorContext } = options;
  void options.attempt;

  const lines: string[] = [];
  lines.push(
    `Call ${candidate.name} (${candidate.phone ?? "the supplier"}) and verify a ${goal.item}.`,
  );
  lines.push(
    `Start exactly with: "${plan.openingLine}"`,
  );
  if (priorContext) {
    lines.push(`Context from our previous call with this supplier: ${priorContext}`);
  }

  const permitted: PermittedAction[] = [];
  for (const q of questions) {
    const constraint = goal.hardConstraints.find((c) => c.id === q.constraintId);
    if (!constraint) continue;
    const action = actionForConstraintKind(constraint.kind);
    if (!authorization.allowed.includes(action)) continue;
    permitted.push(action);
    lines.push(`- ${q.question}`);
    if (q.fallbackQuestion) {
      lines.push(`  If the answer is hedged or uncertain, ask: "${q.fallbackQuestion}"`);
    }
  }

  lines.push(
    "Ask ONLY the listed questions. If the supplier raises a concern, politely acknowledge it and move to the next question.",
  );
  lines.push(
    "If the supplier offers to transfer you to someone who can answer better, accept the transfer politely.",
  );
  lines.push(CALL_SAFETY_FOOTER);

  const task = lines.join("\n");
  // Final orchestration-layer safety gate on the exact text handed to CALL-E.
  assertCallTaskSafe(task);
  return task;
}
