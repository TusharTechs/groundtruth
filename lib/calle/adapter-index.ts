import { RealCalleAdapter, type CalleAdapter } from "@/lib/calle/adapter";
import { MockCalleAdapter } from "@/lib/calle/mock-adapter";
import { GoalCalleAdapter } from "@/lib/calle/goal-adapter";
import { getGoalId, isMockMode, logCalle, resolveExecution } from "@/lib/calle/client";

let mockAdapter: MockCalleAdapter | null = null;
let realAdapter: RealCalleAdapter | null = null;
let goalAdapter: GoalCalleAdapter | null = null;
let goalAdapterId: string | null = null;

/**
 * Adapter factory. Three execution paths behind one interface:
 *
 *   mock  MOCK_CALL_E=true (default)      deterministic simulator, DEMO MODE
 *   goal  CALLE_GOAL_ID set               published CALL-E Goal (goals.run)
 *   call  otherwise                       ad-hoc call task (calls.create)
 *
 * The active mode is asserted on every factory call so a misconfigured
 * environment fails loudly, and the mock is reachable in tests via
 * getMockAdapter() for forced completion.
 */
export function getAdapter(): CalleAdapter {
  const execution = resolveExecution();

  if (execution === "mock") {
    if (!mockAdapter) mockAdapter = new MockCalleAdapter();
    return mockAdapter;
  }

  if (!process.env.CALLE_API_KEY) {
    throw new Error(
      "Real CALL-E mode requested but CALLE_API_KEY is missing. Set CALLE_API_KEY or keep MOCK_CALL_E=true.",
    );
  }

  if (execution === "goal") {
    const goalId = getGoalId()!;
    // A changed CALLE_GOAL_ID must not keep serving the old cached spec.
    if (!goalAdapter || goalAdapterId !== goalId) {
      goalAdapter = new GoalCalleAdapter(goalId);
      goalAdapterId = goalId;
      logCalle("MODE", {
        mode: "real",
        execution: "goal",
        goalId,
        baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
      });
    }
    return goalAdapter;
  }

  if (!realAdapter) {
    realAdapter = new RealCalleAdapter();
    logCalle("MODE", {
      mode: "real",
      execution: "call",
      baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
    });
  }
  return realAdapter;
}

/** Test/demo hook for the mock adapter (force-complete calls). */
export function getMockAdapter(): MockCalleAdapter {
  if (!mockAdapter) mockAdapter = new MockCalleAdapter();
  return mockAdapter;
}

/** Is the current execution path a published Goal? */
export function isGoalExecution(): boolean {
  return resolveExecution() === "goal";
}

export { isMockMode };
