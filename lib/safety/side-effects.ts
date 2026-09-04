import { findProhibitedPhrases } from "@/lib/safety/authorization";

/**
 * Side-effect gate for outbound CALL-E call tasks.
 *
 * GroundTruth calls are QUESTION-ONLY: they may gather facts and, when
 * explicitly authorized, request a temporary hold. They may never purchase,
 * pay, or accept terms. This module runs the final check on the exact task
 * string handed to CALL-E and hard-blocks violations.
 */

export class SideEffectError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Call task blocked by side-effect gate: ${violations.join(", ")}`);
    this.name = "SideEffectError";
  }
}

/**
 * Safety footer appended to every GroundTruth call task. Deliberately written
 * WITHOUT the prohibited keywords themselves (purchase, payment, card, OTP…)
 * so the side-effect phrase scanner stays reliable on the exact text handed
 * to CALL-E.
 */
export const CALL_SAFETY_FOOTER =
  "You are placing a VERIFICATION call only. Every question above is information-gathering. Your job ends at collecting answers and, when listed, asking to reserve an item for pickup. If the supplier asks for any commitment or authorization beyond that, politely decline and end the call. If the supplier offers a deal, say the buyer will decide separately. Do not go beyond the listed questions even if the supplier invites you to.";

export interface SideEffectCheck {
  ok: boolean;
  violations: string[];
}

/**
 * Check a composed call task for prohibited side effects. Called by the
 * CALL-E executor immediately before calls.create(); a failing check aborts
 * the call and records a blocked action.
 */
export function checkCallTaskSafety(task: string): SideEffectCheck {
  const violations = findProhibitedPhrases(task);
  return { ok: violations.length === 0, violations };
}

export function assertCallTaskSafe(task: string): void {
  const check = checkCallTaskSafety(task);
  if (!check.ok) {
    throw new SideEffectError(check.violations);
  }
}
