import { randomUUID } from "node:crypto";
import type {
  CallRecord,
  Candidate,
  Claim,
  ConstraintEvaluation,
  PhoneResult,
  TaskSnapshot,
  VerificationPlan,
  VerificationTask,
} from "@/lib/domain/types";
import { getStore } from "@/lib/db";
import type { GroundTruthStore } from "@/lib/db/store";
import { getGoalAnalyzer } from "@/lib/ai/provider";
import { validateAuthorization, detectRequestedProhibitions } from "@/lib/safety/authorization";
import { redactTranscript, redactOperatorText, piiRedactionEnabled } from "@/lib/safety/pii";
import { discoverCandidates } from "@/lib/discovery/candidates";
import { buildPlan, composeCallTask } from "@/lib/agent/planner";
import {
  decideNextAction,
  failedConstraintsFor,
  resolvablePending,
} from "@/lib/agent/strategist";
import { getAdapter, isGoalExecution } from "@/lib/calle/adapter-index";
import { GoalIncompatibleError } from "@/lib/calle/goal-adapter";
import { availableVariablesFor } from "@/lib/calle/goal-binding";
import { PHONE_RESULT_JSON_SCHEMA } from "@/lib/calle/schemas";
import { extractClaim, applyClaimUpdate, claimTypeFromConstraintKind } from "@/lib/verification/claims";
import { buildEvidenceForClaim } from "@/lib/verification/evidence";
import { evaluateAll } from "@/lib/verification/constraints";
import { decisionConfidence } from "@/lib/verification/confidence";
import { buildDecision } from "@/lib/verification/decision";

/**
 * The Resolver is GroundTruth's orchestration state machine:
 *
 *   analyze goal -> plan -> discover candidates -> for each candidate:
 *   compose safe call task -> CALL-E call -> poll/webhook -> extract claims
 *   -> attach evidence -> evaluate constraints -> adapt (follow-up / next
 *   candidate / stop) -> decide.
 *
 * tick(taskId) advances the machine one step and is called by the UI poller
 * or the webhook. All state lives in the store, so ticks are idempotent and
 * survive restarts.
 */

const nowIso = () => new Date().toISOString();

/**
 * How long to leave a supplier alone before a follow-up call. Zero in mock
 * mode so the demo stays brisk; FOLLOW_UP_DELAY_MS overrides for real runs.
 */
function followUpDelayMs(): number {
  if (process.env.MOCK_CALL_E?.toLowerCase() !== "false") return 0;
  const raw = Number(process.env.FOLLOW_UP_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 90_000;
}

export class ResolverError extends Error {}

/** Per-process tick lock (single Next.js server process). */
const ticking = new Set<string>();

// ---------------------------------------------------------------------------
// Task creation
// ---------------------------------------------------------------------------

export async function createTask(options: {
  input: string;
  scenarioId?: string;
  store?: GroundTruthStore;
}): Promise<VerificationTask> {
  const store = options.store ?? getStore();
  const at = nowIso();
  // Analysis reads the raw request (prices and deadlines must survive), but
  // only the redacted form is ever persisted or rendered.
  const storedInput = piiRedactionEnabled()
    ? redactOperatorText(options.input)
    : options.input;
  const task: VerificationTask = {
    id: randomUUID(),
    input: storedInput,
    goal: null,
    plan: null,
    status: "draft",
    mode: process.env.MOCK_CALL_E?.toLowerCase() === "false" && process.env.CALLE_API_KEY ? "real" : "mock",
    analyzer: null,
    createdAt: at,
    updatedAt: at,
    completedAt: null,
  };
  await store.createTask(task);
  await store.addAudit({
    taskId: task.id,
    actor: "user",
    action: "TASK_CREATED",
    detail: `Verification request submitted (${task.mode} mode).`,
  });

  // Phase 1: goal analysis.
  const analysis = await getGoalAnalyzer().analyze(options.input);
  if (piiRedactionEnabled()) {
    analysis.goal.objective = redactOperatorText(analysis.goal.objective);
  }

  // Say out loud which parts of the request are being declined. The
  // structural gate already drops them; silence would let the operator
  // believe they were accepted.
  const refused = detectRequestedProhibitions(options.input);
  if (refused.length > 0) {
    await store.addAudit({
      taskId: task.id,
      actor: "system",
      action: "REQUEST_PARTIALLY_REFUSED",
      detail: `Refused prohibited action(s) in the request: ${refused.join(", ")}. GroundTruth verifies by phone only; these will not be attempted.`,
    });
    await store.addEvent({
      taskId: task.id,
      type: "REQUEST_PARTIALLY_REFUSED",
      level: "warning",
      message: `Not doing: ${refused.join(", ")}. GroundTruth only asks questions — the rest of the request proceeds.`,
    });
    for (const action of refused) {
      await store.addAction({
        taskId: task.id,
        type: "blocked_action",
        authorized: false,
        detail: { action, source: "operator_request" },
      });
    }
  }

  const authProblems = validateAuthorization(analysis.goal.authorization);
  if (authProblems.length > 0) {
    await store.addAudit({
      taskId: task.id,
      actor: "system",
      action: "GOAL_REJECTED",
      detail: `Authorization validation failed: ${authProblems.join("; ")}`,
    });
    throw new ResolverError(authProblems.join("; "));
  }

  // Phase 2: plan (authorization is enforced here — violations throw).
  const plan = buildPlan(analysis.goal);

  // Phase 3: candidate discovery.
  const candidates = await discoverCandidates(task.id, analysis.goal, undefined, {
    scenarioId: options.scenarioId,
    limit: plan.candidateLimit,
  });

  await store.updateTask(task.id, {
    goal: { ...analysis.goal, ...(options.scenarioId ? { demoScenarioId: options.scenarioId } : {}) },
    plan,
    analyzer: analysis.analyzer,
    status: "analyzed",
  });
  await store.saveConstraints(task.id, analysis.goal.hardConstraints);
  await store.addCandidates(task.id, candidates);
  await store.addAudit({
    taskId: task.id,
    actor: "system",
    action: "GOAL_ANALYZED",
    detail: `Goal analyzed (${analysis.analyzer}): ${analysis.goal.hardConstraints.length} hard constraints, ${candidates.length} candidates discovered, plan built.`,
  });
  await store.addEvent({
    taskId: task.id,
    type: "TASK_ANALYZED",
    message: `Understood goal: ${analysis.goal.objective}`,
  });

  const updated = await store.getTask(task.id);
  if (!updated) throw new ResolverError("task vanished after creation");
  return updated;
}

// ---------------------------------------------------------------------------
// Start + tick
// ---------------------------------------------------------------------------

export async function startTask(taskId: string): Promise<void> {
  const store = getStore();
  const task = await store.getTask(taskId);
  if (!task) throw new ResolverError("task not found");
  if (task.status !== "analyzed" && task.status !== "draft") return;
  await store.updateTask(taskId, { status: "running" });
  await store.addAudit({
    taskId,
    actor: "user",
    action: "TASK_STARTED",
    detail: "Verification run started.",
  });
  await store.addEvent({ taskId, type: "TASK_STARTED", message: "Verification run started" });
}

export async function tick(taskId: string): Promise<TaskSnapshot> {
  const store = getStore();
  const task = await store.getTask(taskId);
  if (!task) throw new ResolverError("task not found");
  if (task.status !== "running") return snapshot(taskId);

  if (ticking.has(taskId)) return snapshot(taskId);
  ticking.add(taskId);
  try {
    await advanceTask(taskId, store);
  } finally {
    ticking.delete(taskId);
  }
  return snapshot(taskId);
}

async function advanceTask(taskId: string, store: GroundTruthStore): Promise<void> {
  const task = (await store.getTask(taskId))!;
  const goal = task.goal;
  const plan = task.plan as ReturnType<typeof buildPlan> | null;
  if (!goal || !plan) return;

  const adapter = getAdapter();
  const calls = await store.getCalls(taskId);

  // 1. Poll any in-flight call.
  const inFlight = calls.find((c) => ["pending", "queued", "dialing", "in_progress"].includes(c.status));
  if (inFlight) {
    await pollCall(inFlight, adapter, store, taskId);
    return;
  }

  // 2. No in-flight call: decide next work.
  const candidates = await store.getCandidates(taskId);
  const pendingCandidates = candidates.filter((c) => c.status === "pending");

  if (calls.length === 0) {
    if (pendingCandidates.length === 0) return finalize(taskId, store);
    await createCallForCandidate(taskId, pendingCandidates[0], "verify", goal.hardConstraints.map((c) => c.id), store, plan, goal);
    return;
  }

  // Find the candidate of the most recent call and run strategy on it.
  const lastCall = calls.at(-1)!;
  const currentCandidate = candidates.find((c) => c.id === lastCall.candidateId);
  if (!currentCandidate) return finalize(taskId, store);

  const candidateCalls = calls.filter((c) => c.candidateId === currentCandidate.id);
  const claims = await store.getClaims(taskId);
  const constraints = await store.getConstraints(taskId);
  const pending = resolvablePending(goal, candidateCalls, claims);
  const failed = failedConstraintsFor(goal, candidateCalls);
  const decision = decideNextAction({
    goal,
    pendingConstraints: pending,
    failedConstraints: failed,
    callsForCandidate: candidateCalls,
    claims,
    plan,
    hasViableWinner: isFullyVerified(currentCandidate, constraints, claims, candidateCalls),
    remainingCandidates: pendingCandidates.length,
  });

  await store.addEvent({
    taskId,
    candidateId: currentCandidate.id,
    type: "STRATEGY_DECISION",
    message: decision.reason,
  });

  if (decision.kind === "follow_up") {
    // Hold the follow-up for a beat. Redialling the same person seconds after
    // hanging up is both socially wrong — they were asked to go check with a
    // manager — and technically fragile: on a live run CALL-E failed exactly
    // such a redial with a zero-duration provider 500. The mock has no wall
    // clock, so this only ever surfaces against real calls.
    const lastCompletedAt = candidateCalls.at(-1)?.completedAt;
    const waitMs = followUpDelayMs();
    if (lastCompletedAt && Date.now() - new Date(lastCompletedAt).getTime() < waitMs) {
      return; // a later tick will place it
    }
    await createCallForCandidate(taskId, currentCandidate, "follow_up", decision.focusConstraints, store, plan, goal, {
      attempt: candidateCalls.length + 1,
      priorContext: candidateCalls.at(-1)?.summary ?? undefined,
    });
    return;
  }

  if (decision.kind === "next_candidate") {
    // Terminal candidate states (unreachable/rejected) are never downgraded;
    // only a contacted candidate with failures becomes rejected.
    if (currentCandidate.status === "contacted") {
      await store.updateCandidate(currentCandidate.id, {
        status: failed.length > 0 ? "rejected" : currentCandidate.status,
        rejectionReason:
          failed.length > 0 ? failed.map((f) => f.evaluation.reason).join("; ") : undefined,
      });
    }
    if (pendingCandidates.length > 0) {
      await createCallForCandidate(taskId, pendingCandidates[0], "verify", goal.hardConstraints.map((c) => c.id), store, plan, goal);
      return;
    }
    return finalize(taskId, store);
  }

  // stop
  return finalize(taskId, store);
}

/**
 * Early-stop check: is every hard constraint of this candidate satisfied —
 * deterministic pass AND (for phone-derived constraints) a verified claim?
 */
function isFullyVerified(
  candidate: Candidate,
  constraints: Awaited<ReturnType<GroundTruthStore["getConstraints"]>>,
  claims: Claim[],
  candidateCalls: CallRecord[],
): boolean {
  const completed = candidateCalls
    .filter((c) => c.status === "completed")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const merged = mergeResults(completed.map((c) => c.result));
  if (!merged) return false;
  const evals = evaluateAll(constraints, merged, candidate);
  return evals.every((ev) => {
    if (ev.status !== "pass") return false;
    const constraint = constraints.find((c) => c.id === ev.constraintId);
    if (!constraint || claimTypeFromConstraintKind(constraint.kind) === "other") return true;
    const type = claimTypeFromConstraintKind(constraint.kind);
    const claim = claims.find((c) => c.candidateId === candidate.id && c.type === type);
    return claim?.status === "verified";
  });
}

// ---------------------------------------------------------------------------
// Call lifecycle
// ---------------------------------------------------------------------------

async function createCallForCandidate(
  taskId: string,
  candidate: Candidate,
  purpose: "verify" | "follow_up",
  focusConstraints: string[],
  store: GroundTruthStore,
  plan: VerificationPlan,
  goal: NonNullable<VerificationTask["goal"]>,
  options?: { attempt?: number; priorContext?: string },
): Promise<CallRecord> {
  const attempt = options?.attempt ?? 1;
  const questions = plan.questions.filter((q) => focusConstraints.includes(q.constraintId));
  const focus = questions.length > 0 ? questions : plan.questions;

  const taskText = composeCallTask({
    goal,
    plan,
    candidate,
    questions: focus,
    attempt,
    authorization: goal.authorization,
    priorContext: options?.priorContext,
  });

  const callId = randomUUID();
  const idempotencyKey = `gt_${taskId.slice(0, 8)}_${candidate.id.slice(0, 8)}_${purpose}_${attempt}`;
  const call: CallRecord = {
    id: callId,
    taskId,
    candidateId: candidate.id,
    calleCallId: "",
    attempt,
    purpose,
    focusConstraints: focus.map((q) => q.constraintId),
    task: taskText,
    status: "pending",
    mode: "mock",
    result: null,
    summary: null,
    taskCompleted: null,
    completionConfidence: null,
    evidence: [],
    transcript: [],
    failureCode: null,
    failureMessage: null,
    createdAt: nowIso(),
    completedAt: null,
  };

  // Idempotency: a duplicate orchestration tick must not double-dial.
  const existing = await store.getCallByCalleId(idempotencyKey.replace(/^gt_/, "mock_gt_"));
  if (existing) return existing;

  const adapter = getAdapter();

  // The Goal path needs the constraint set (to type-check the published
  // result schema) and the flat scalar variables the Goal declares. The
  // call path ignores both.
  const goalMetadata = isGoalExecution()
    ? {
        constraints: goal.hardConstraints,
        goalVariables: availableVariablesFor(goal, candidate),
      }
    : {};

  let calleCallId: string;
  try {
    ({ calleCallId } = await adapter.createCall({
      task: taskText,
      phone: candidate.phone,
      region: candidate.region,
      locale: candidate.locale,
      resultSchema: PHONE_RESULT_JSON_SCHEMA,
      metadata: {
        taskId,
        candidateId: candidate.id,
        purpose,
        attempt,
        scenarioId: (goal as { demoScenarioId?: string }).demoScenarioId,
        ...goalMetadata,
      },
      idempotencyKey,
    }));
  } catch (error) {
    // A published Goal that cannot answer a hard constraint is a
    // configuration error, not a supplier outcome: no human was called, and
    // no candidate should be marked unreachable for it. Fail the task loudly.
    if (error instanceof GoalIncompatibleError) {
      await store.addAudit({
        taskId,
        actor: "system",
        action: "GOAL_INCOMPATIBLE",
        detail: error.message,
      });
      await store.addEvent({
        taskId,
        type: "GOAL_INCOMPATIBLE",
        level: "warning",
        message: `${error.message} No call was placed.`,
      });
      await store.updateTask(taskId, { status: "failed", completedAt: nowIso() });
    }
    throw error;
  }

  call.calleCallId = calleCallId;
  call.mode = adapter.mode;
  await store.createCall(call);
  await store.updateCandidate(candidate.id, { status: "contacted" });
  await store.addAction({
    taskId,
    candidateId: candidate.id,
    callId,
    type: purpose === "follow_up" ? "follow_up_call" : "verification_call",
    authorized: true,
    detail: { calleCallId, purpose, attempt },
  });
  await store.addEvent({
    taskId,
    callId,
    candidateId: candidate.id,
    type: "CALL_STARTED",
    message: `${purpose === "follow_up" ? "Follow-up call" : "Call"} placed to ${candidate.name} via CALL-E (${adapter.mode === "mock" ? "DEMO MODE" : "real CALL-E call"}).`,
  });
  await store.addAudit({
    taskId,
    actor: "system",
    action: "CALLE_CALL_CREATED",
    detail: `CALL-E call ${calleCallId} created for ${candidate.name} (attempt ${attempt}, ${purpose}).`,
  });
  return call;
}

async function pollCall(
  call: CallRecord,
  adapter: Awaited<ReturnType<typeof getAdapter>>,
  store: GroundTruthStore,
  taskId: string,
): Promise<void> {
  let state;
  try {
    state = await adapter.getCallState(call.calleCallId);
  } catch (error) {
    await store.addEvent({
      taskId,
      callId: call.id,
      type: "CALL_POLL_ERROR",
      level: "warning",
      message: `CALL-E poll failed (${error instanceof Error ? error.message : "unknown"}); will retry.`,
    });
    return;
  }

  if (state.status === call.status && state.transcript.length === call.transcript.length) return;

  const patch: Partial<CallRecord> = { status: state.status };
  if (state.transcript.length > call.transcript.length) {
    const newTurns = state.transcript.slice(call.transcript.length);
    patch.transcript = piiRedactionEnabled() ? redactTranscript(state.transcript) : state.transcript;
    const last = newTurns.at(-1);
    if (last && state.status === "in_progress") {
      await store.addEvent({
        taskId,
        callId: call.id,
        candidateId: call.candidateId,
        type: "TRANSCRIPT_UPDATE",
        message: `${last.speaker === "bot" ? "GroundTruth" : "Supplier"}: "${last.text}"`,
      });
    }
  }

  if (state.status === "in_progress" && call.status !== "in_progress") {
    await store.addEvent({
      taskId,
      callId: call.id,
      candidateId: call.candidateId,
      type: "SUPPLIER_ANSWERED",
      message: "Supplier answered — conversation in progress.",
    });
  }

  const becameTerminal = ["completed", "failed", "canceled"].includes(state.status);
  if (becameTerminal) {
    patch.result = state.result;
    patch.summary = state.summary;
    patch.taskCompleted = state.taskCompleted;
    patch.completionConfidence = state.completionConfidence;
    patch.evidence = state.evidence;
    patch.failureCode = state.failureCode;
    patch.failureMessage = state.failureMessage;
    patch.completedAt = nowIso();
    patch.transcript = piiRedactionEnabled() ? redactTranscript(state.transcript) : state.transcript;
  }

  await store.updateCall(call.id, patch);

  if (becameTerminal) {
    await onCallTerminal(call.id, state, store);
  }
}

/**
 * Apply a terminal CALL-E state to the verification state machine. Shared by
 * the poll path AND the webhook path, so both ingestion routes produce the
 * same claims/evidence/events.
 */
export async function onCallTerminal(
  callId: string,
  state: {
    status: CallRecord["status"];
    result: PhoneResult | null;
    summary: string | null;
    taskCompleted: boolean | null;
    completionConfidence: number | null;
    evidence: string[];
    failureCode: string | null;
    failureMessage: string | null;
  },
  store: GroundTruthStore = getStore(),
): Promise<void> {
  const call = await store.getCall(callId);
  if (!call) return;
  const taskId = call.taskId;
  const task = await store.getTask(taskId);
  if (!task?.goal) return;
  const candidate = (await store.getCandidates(taskId)).find((c) => c.id === call.candidateId);
  if (!candidate) return;

  if (state.status !== "completed") {
    await store.updateCandidate(candidate.id, {
      status: "unreachable",
      rejectionReason: state.failureMessage ?? "call failed",
    });
    await store.addEvent({
      taskId,
      callId: call.id,
      candidateId: candidate.id,
      type: "CALL_FAILED",
      level: "warning",
      message: `Call to ${candidate.name} did not complete${state.failureMessage ? `: ${state.failureMessage}` : ""}.`,
    });
    await store.addAudit({
      taskId,
      actor: "calle",
      action: "CALLE_CALL_FAILED",
      detail: `CALL-E call ${call.calleCallId} ended ${state.status}${state.failureCode ? ` (${state.failureCode})` : ""}.`,
    });
    return;
  }

  await store.addEvent({
    taskId,
    callId: call.id,
    candidateId: candidate.id,
    type: "CALL_COMPLETED",
    message: `Call to ${candidate.name} completed. CALL-E task completed: ${state.taskCompleted ? "yes" : "no"}${state.completionConfidence !== null ? `, confidence ${Math.round(state.completionConfidence * 100)}%` : ""}.`,
  });
  await store.addAudit({
    taskId,
    actor: "calle",
    action: "CALLE_CALL_COMPLETED",
    detail: `CALL-E call ${call.calleCallId} completed with confidence ${state.completionConfidence ?? "n/a"}.`,
  });

  // Merge results across attempts (follow-up overrides earlier unknowns).
  const candidateCalls = (await store.getCalls(taskId))
    .filter((c) => c.candidateId === candidate.id && c.status === "completed")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const merged = mergeResults(candidateCalls.map((c) => c.result));

  // Claims + evidence + evaluations.
  const constraints = await store.getConstraints(taskId);
  const existingClaims = await store.getClaims(taskId);
  const evaluations: ConstraintEvaluation[] = [];

  for (const constraint of constraints) {
    const evaluation = evaluateAll([constraint], merged, candidate)[0];
    // Distance (and other discovery-derived constraints) have no phone claim;
    // their pass comes from candidate data, not a supplier's words.
    const phoneDerived = claimTypeFromConstraintKind(constraint.kind) !== "other";
    if (!phoneDerived || evaluation.status === "unknown") {
      // UNKNOWN is still recorded as a first-class claim with its provenance,
      // so "we could not confirm X" is auditable rather than invisible.
      if (phoneDerived) {
        const type = claimTypeFromConstraintKind(constraint.kind);
        const existing = (await store.getClaims(taskId)).find(
          (c) => c.candidateId === candidate.id && c.type === type,
        );
        if (!existing) {
          const draft = extractClaim(constraint, { ...call, result: merged }, candidate, true);
          draft.status = "unknown";
          draft.confidence = 0;
          const evidenceRecords = buildEvidenceForClaim(draft, { ...call, result: merged });
          const stored = await store.createClaim(draft);
          for (const rec of evidenceRecords) {
            await store.addEvidence(rec);
            stored.evidenceIds.push(rec.id);
          }
          await store.updateClaim(stored.id, { evidenceIds: stored.evidenceIds });
          await store.addAudit({
            taskId,
            actor: "system",
            action: "CLAIM_RECORDED",
            detail: `${draft.statement} -> unknown (unresolved after call ${call.calleCallId}).`,
          });
        }
      }
      evaluations.push(evaluation);
      continue;
    }

    const type = claimTypeFromConstraintKind(constraint.kind);
    const existing = existingClaims.find(
      (c) => c.candidateId === candidate.id && c.type === type,
    );

    const draft = extractClaim(constraint, { ...call, result: merged }, candidate, true);
    const evidenceRecords = buildEvidenceForClaim(draft, { ...call, result: merged });

    if (existing) {
      const hasEvidence = existing.evidenceIds.length > 0 || evidenceRecords.length > 0;
      // The draft carries a fresh id, so its evidence was addressed to a
      // claim that is never stored. Re-point it at the claim being updated
      // before writing: the UI groups evidence by claimId, and records filed
      // under the draft would be invisible even though they exist.
      for (const rec of evidenceRecords) {
        rec.claimId = existing.id;
      }
      // Persist the new evidence BEFORE merging the claim. applyClaimUpdate
      // already folds next.evidenceIds into the claim, so testing membership
      // against the merged list skips every record and leaves the claim
      // pointing at rows that were never written — a follow-up call's proof
      // would silently vanish behind the earlier, weaker evidence.
      for (const rec of evidenceRecords) {
        await store.addEvidence(rec);
      }
      const updated = applyClaimUpdate(existing, { ...draft, evidenceIds: evidenceRecords.map((e) => e.id) }, hasEvidence);
      // A confirming call on an already-verified claim is a value no-op
      // (applyClaimUpdate returns `existing`), but its evidence still belongs
      // to the claim — union the ids so nothing is orphaned either way.
      const evidenceIds = Array.from(
        new Set([...updated.evidenceIds, ...evidenceRecords.map((e) => e.id)]),
      );
      await store.updateClaim(existing.id, { ...updated, evidenceIds });
      evaluation.claimId = existing.id;
    } else {
      let stored = await store.createClaim(draft);
      for (const rec of evidenceRecords) {
        await store.addEvidence(rec);
        stored.evidenceIds.push(rec.id);
      }
      if (stored.status === "verified" && stored.evidenceIds.length === 0) {
        stored.status = "unknown";
      }
      await store.updateClaim(stored.id, {
        evidenceIds: stored.evidenceIds,
        status: stored.status,
      });
      stored = (await store.getClaims(taskId)).find((c) => c.id === draft.id) ?? stored;
      evaluation.claimId = stored.id;
      await store.addAudit({
        taskId,
        actor: "system",
        action: stored.status === "verified" ? "CLAIM_VERIFIED" : "CLAIM_RECORDED",
        detail: `${stored.statement} -> ${stored.status}${stored.confidence ? ` (confidence ${Math.round(stored.confidence * 100)}%)` : ""}.`,
      });
    }
    evaluations.push(evaluation);

    // Human-readable per-constraint events (spec section 13 examples).
    const label = constraint.label.split("(")[0].trim();
    const eventType =
      evaluation.status === "pass"
        ? `${label.toUpperCase()} VERIFIED`
        : `${label.toUpperCase()} FAILED`;
    await store.addEvent({
      taskId,
      callId: call.id,
      candidateId: candidate.id,
      type: eventType,
      level: evaluation.status === "pass" ? "info" : "warning",
      message: evaluation.reason,
    });
  }

  // Persist evaluations by storing them on the candidate via decision-time
  // recomputation; they are derived deterministically from stored claims.
  await store.addEvent({
    taskId,
    candidateId: candidate.id,
    type: "CANDIDATE_EVALUATED",
    message: `${candidate.name}: ${evaluations.filter((e) => e.status === "pass").length} verified, ${evaluations.filter((e) => e.status === "fail").length} failed, ${evaluations.filter((e) => e.status === "unknown").length} unresolved.`,
  });
}

/** Merge results across multiple calls to the same candidate. */
export function mergeResults(results: Array<PhoneResult | null>): PhoneResult | null {
  const valid = results.filter((r): r is PhoneResult => r !== null);
  if (valid.length === 0) return null;
  const merged: PhoneResult = { ...valid[0] };
  for (const r of valid.slice(1)) {
    for (const [k, v] of Object.entries(r)) {
      if (v !== null && v !== undefined && v !== "") {
        (merged as unknown as Record<string, unknown>)[k] = v;
      }
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

async function finalize(taskId: string, store: GroundTruthStore): Promise<void> {
  const task = await store.getTask(taskId);
  if (!task?.goal) return;
  const goal = task.goal;

  const candidates = await store.getCandidates(taskId);
  const claims = await store.getClaims(taskId);
  const constraints = await store.getConstraints(taskId);

  const evaluationsByCandidate = new Map<string, ConstraintEvaluation[]>();
  const allCalls = await store.getCalls(taskId);
  for (const candidate of candidates) {
    const candidateCalls = allCalls
      .filter((c) => c.candidateId === candidate.id && c.status === "completed")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const merged = mergeResults(candidateCalls.map((c) => c.result));
    const evals = evaluateAll(constraints, merged, candidate);
    // Link claims to evaluations.
    for (const ev of evals) {
      ev.candidateId = candidate.id;
      const constraint = constraints.find((c) => c.id === ev.constraintId);
      if (!constraint) continue;
      const type = claimTypeFromConstraintKind(constraint.kind);
      const claim = claims.find((c) => c.candidateId === candidate.id && c.type === type);
      if (claim) ev.claimId = claim.id;
    }
    evaluationsByCandidate.set(candidate.id, evals);
  }

  const soft = goal.softPreferences;
  // Winner-aware early stop: if a candidate is fully verified and the plan
  // says stop, finalize with success immediately.
  const decision = buildDecision(
    taskId,
    candidates,
    claims,
    goal.hardConstraints,
    soft,
    evaluationsByCandidate,
    0,
  );
  const confidence = decision.winnerCandidateId
    ? decisionConfidence(
        evaluationsByCandidate.get(decision.winnerCandidateId) ?? [],
        claims,
      )
    : 0;
  const finalDecision = { ...decision, confidence };
  await store.saveDecision(finalDecision);
  await store.updateTask(taskId, { status: "completed", completedAt: nowIso() });
  await store.addAudit({
    taskId,
    actor: "system",
    action: "DECISION_REACHED",
    detail: `Decision: ${finalDecision.status}${finalDecision.winnerCandidateId ? ` (winner ${candidates.find((c) => c.id === finalDecision.winnerCandidateId)?.name})` : ""}; confidence ${Math.round(finalDecision.confidence * 100)}%.`,
  });
  await store.addEvent({
    taskId,
    type: "DECISION_REACHED",
    message:
      finalDecision.status === "success"
        ? `Reality verified: ${candidates.find((c) => c.id === finalDecision.winnerCandidateId)?.name ?? "a candidate"} satisfies every hard requirement.`
        : finalDecision.status === "partial"
          ? "No fully verified match yet — constraints remain unresolved."
          : "No fully verified match — every candidate failed at least one hard requirement.",
  });
}

// ---------------------------------------------------------------------------
// Snapshot for the UI
// ---------------------------------------------------------------------------

export async function snapshot(taskId: string): Promise<TaskSnapshot> {
  const store = getStore();
  const task = await store.getTask(taskId);
  if (!task) throw new ResolverError("task not found");
  const [candidates, calls, events, claims, evidence, decision, audit] = await Promise.all([
    store.getCandidates(taskId),
    store.getCalls(taskId),
    store.getEvents(taskId),
    store.getClaims(taskId),
    store.getEvidence(taskId),
    store.getDecision(taskId),
    store.getAudit(taskId),
  ]);
  const constraints = await store.getConstraints(taskId);
  const evaluations: ConstraintEvaluation[] = [];
  for (const candidate of candidates) {
    const candidateCalls = calls
      .filter((c) => c.candidateId === candidate.id && c.status === "completed")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const merged = mergeResults(candidateCalls.map((c) => c.result));
    const evals = evaluateAll(constraints, merged, candidate);
    for (const ev of evals) {
      ev.candidateId = candidate.id;
      const constraint = constraints.find((c) => c.id === ev.constraintId);
      if (!constraint) continue;
      const type = claimTypeFromConstraintKind(constraint.kind);
      const claim = claims.find((c) => c.candidateId === candidate.id && c.type === type);
      if (claim) ev.claimId = claim.id;
    }
    evaluations.push(...evals);
  }
  return {
    task,
    candidates,
    calls,
    events,
    claims,
    evidence,
    evaluations,
    decision,
    audit,
  };
}
