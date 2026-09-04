import type { CallStatus, TranscriptTurn } from "@/lib/domain/types";
import type { AdapterCallInput, AdapterCallState, CalleAdapter } from "@/lib/calle/adapter";
import { getCalleClient, logCalle } from "@/lib/calle/client";
import { normalizePhoneResult } from "@/lib/calle/schemas";
import {
  checkGoalCompatibility,
  filterToDeclaredVariables,
  mapGoalResultToPhoneResult,
  type FieldBinding,
  type PublishedGoalSpec,
} from "@/lib/calle/goal-binding";

/**
 * GoalCalleAdapter — verification executed through a PUBLISHED CALL-E Goal.
 *
 * The other two adapters compose a call task per candidate. This one does
 * not: it runs a Goal that CALL-E already published, version-pinned, with its
 * own input and result schemas. GroundTruth supplies only the phone number,
 * the run variables, and an idempotency key.
 *
 * What that buys, and why it is worth a third path:
 *
 *  - The verification protocol becomes a shareable artifact. Anyone can run
 *    the same pinned RunSpec version and get the same questions asked the
 *    same way — the protocol stops living in one repo's prompt strings.
 *  - The result contract is enforced by CALL-E against the published schema,
 *    upstream of our own validation.
 *  - Errors arrive as a typed enum (`no_answer`, `declined`, `result_invalid`,
 *    ...) instead of prose to be pattern-matched.
 *
 * What it costs, and why the adapter is honest about it: a Goal run exposes
 * no transcript. Claims produced this way carry structured-result evidence
 * and the correlated call id, but no verbatim quote. `evidence` therefore
 * states the provenance explicitly rather than implying a quote exists.
 */

interface GoalRuntime {
  goalRunId: string;
  bindings: FieldBinding[];
  candidateId: string | null;
}

/** Terminal Goal run errors that mean "the phone call itself did not happen". */
const CALL_LEVEL_ERRORS = new Set(["no_answer", "call_failed", "declined", "timed_out", "canceled"]);

export class GoalCalleAdapter implements CalleAdapter {
  readonly mode = "real" as const;

  /** Cached published Goal spec — one fetch per process, version pinned by CALL-E. */
  private goalSpec: PublishedGoalSpec | null = null;
  private runtimes = new Map<string, GoalRuntime>();

  constructor(private readonly goalId: string) {}

  async loadGoalSpec(): Promise<PublishedGoalSpec> {
    if (this.goalSpec) return this.goalSpec;
    const client = getCalleClient();
    const goal = await client.goals.get(this.goalId);
    this.goalSpec = {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      publishedRunSpec: {
        id: goal.publishedRunSpec.id,
        version: goal.publishedRunSpec.version,
        inputSchema: goal.publishedRunSpec.inputSchema,
        resultSchema: goal.publishedRunSpec.resultSchema,
      },
    };
    logCalle("GOAL LOADED", {
      goalId: goal.id,
      title: goal.title,
      runSpecVersion: goal.publishedRunSpec.version,
      resultFields: Object.keys(
        (goal.publishedRunSpec.resultSchema?.properties as Record<string, unknown>) ?? {},
      ),
    });
    return this.goalSpec;
  }

  async createCall(input: AdapterCallInput): Promise<{ calleCallId: string }> {
    const spec = await this.loadGoalSpec();
    const constraints = (input.metadata.constraints ?? []) as Parameters<
      typeof checkGoalCompatibility
    >[1];
    const variables = (input.metadata.goalVariables ?? {}) as Record<
      string,
      string | number | boolean
    >;

    // Type-check the Goal against this task BEFORE dialing a human.
    const compatibility = checkGoalCompatibility(spec, constraints, variables);
    logCalle("GOAL COMPATIBILITY", {
      goalId: spec.id,
      runSpecVersion: compatibility.runSpecVersion,
      compatible: compatibility.compatible,
      bound: compatibility.bindings.length,
      unanswerable: compatibility.unanswerable.map((u) => u.label),
      missingVariables: compatibility.missingVariables,
    });
    if (!compatibility.compatible) {
      throw new GoalIncompatibleError(compatibility.summary, compatibility);
    }

    const client = getCalleClient();
    const run = await client.goals.run({
      goalId: spec.id,
      phone: input.phone,
      variables: filterToDeclaredVariables(spec, variables),
      idempotencyKey: input.idempotencyKey,
    });

    this.runtimes.set(run.id, {
      goalRunId: run.id,
      bindings: compatibility.bindings,
      candidateId: (input.metadata.candidateId as string) ?? null,
    });

    logCalle("GOAL RUN CREATED", {
      goalId: spec.id,
      goalRunId: run.id,
      runSpecVersion: run.runSpec.version,
      status: run.status,
      taskId: input.metadata.taskId,
      candidateId: input.metadata.candidateId,
      idempotencyKey: input.idempotencyKey,
    });
    return { calleCallId: run.id };
  }

  async getCallState(goalRunId: string): Promise<AdapterCallState> {
    const client = getCalleClient();
    const run = await client.goals.getRun(this.goalId, goalRunId);
    const bindings = this.runtimes.get(goalRunId)?.bindings ?? [];
    const state = mapGoalRun(run, bindings);

    if (state.status === "completed" || state.status === "failed") {
      logCalle("GOAL RUN COMPLETED", {
        goalId: this.goalId,
        goalRunId: run.id,
        callId: run.callId,
        status: run.status,
        errorCode: run.error?.code ?? null,
      });
      if (run.result) {
        logCalle("GOAL RESULT RECEIVED", { goalRunId: run.id, result: run.result });
      }
    }
    return state;
  }
}

export class GoalIncompatibleError extends Error {
  constructor(
    message: string,
    public readonly compatibility: ReturnType<typeof checkGoalCompatibility>,
  ) {
    super(message);
    this.name = "GoalIncompatibleError";
  }
}

/**
 * Map a Goal run onto the adapter's call state. Exported for tests, and the
 * single place the Goal contract is translated into GroundTruth's.
 */
export function mapGoalRun(
  run: {
    id: string;
    status: string;
    callId: string | null;
    runSpec: { id: string; version: number };
    result: Record<string, string | number | boolean> | null;
    error: { code: string; message: string; detailCode: string | null } | null;
  },
  bindings: FieldBinding[],
): AdapterCallState {
  // A completed run can briefly carry neither result nor error while CALL-E
  // parses; treat that as still in progress rather than as an empty success.
  const settling = run.status === "completed" && !run.result && !run.error;
  const status: CallStatus = settling
    ? "in_progress"
    : run.error
      ? "failed"
      : (run.status as CallStatus);

  const mapped = run.result ? mapGoalResultToPhoneResult(run.result, bindings) : null;

  // Goal runs expose no transcript turns. Rather than fabricate one, evidence
  // records the provenance: the pinned RunSpec and the correlated call id.
  const transcript: TranscriptTurn[] = [];
  const evidence = run.result
    ? [
        `CALL-E Goal run ${run.id} (RunSpec ${run.runSpec.id} v${run.runSpec.version}) returned a schema-validated result. Goal runs do not expose transcript turns, so no verbatim quote is available for this claim.`,
      ]
    : [];

  return {
    calleCallId: run.id,
    status,
    transcript,
    result: mapped ? normalizePhoneResult(mapped) : null,
    summary: run.error
      ? run.error.message
      : run.result
        ? `Goal run completed against RunSpec v${run.runSpec.version}.`
        : null,
    taskCompleted: run.error ? false : run.result ? true : null,
    // A published Goal validates its own result against a pinned schema, so a
    // returned result is a stronger signal than a free-form extraction. It is
    // still not certainty: hedges survive as "uncertain" enum members.
    completionConfidence: run.result ? 0.9 : null,
    evidence,
    failureCode: run.error?.code ?? null,
    failureMessage: run.error?.message ?? null,
  };
}

/** Did this Goal run fail because the call never happened? */
export function isCallLevelFailure(errorCode: string | null): boolean {
  return errorCode !== null && CALL_LEVEL_ERRORS.has(errorCode);
}
