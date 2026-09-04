import type {
  AuditLog,
  CallEvent,
  CallRecord,
  Candidate,
  Claim,
  ConstraintSpec,
  Decision,
  Evidence,
  VerificationTask,
} from "@/lib/domain/types";

/**
 * Persistence interface for GroundTruth.
 *
 * Two implementations:
 *  - MemoryStore: in-process, deterministic, used when DATABASE_URL is unset
 *    (local demos, tests). Resets on restart.
 *  - PostgresStore: Drizzle ORM over PostgreSQL (Neon/Supabase/local).
 *
 * Application code never imports an implementation directly; it uses
 * getStore() from lib/db/index.ts.
 */
export interface GroundTruthStore {
  // Tasks
  createTask(task: VerificationTask): Promise<VerificationTask>;
  getTask(id: string): Promise<VerificationTask | null>;
  updateTask(
    id: string,
    patch: Partial<Pick<VerificationTask, "goal" | "plan" | "status" | "completedAt" | "analyzer">>,
  ): Promise<VerificationTask | null>;
  listTasks(limit?: number): Promise<VerificationTask[]>;

  // Constraint specs (normalized copy of goal constraints)
  saveConstraints(taskId: string, specs: ConstraintSpec[]): Promise<void>;
  getConstraints(taskId: string): Promise<ConstraintSpec[]>;

  // Candidates
  addCandidates(taskId: string, candidates: Candidate[]): Promise<Candidate[]>;
  getCandidates(taskId: string): Promise<Candidate[]>;
  updateCandidate(
    id: string,
    patch: Partial<Pick<Candidate, "status" | "rejectionReason" | "priority">>,
  ): Promise<Candidate | null>;

  // Calls
  createCall(call: CallRecord): Promise<CallRecord>;
  updateCall(
    id: string,
    patch: Partial<
      Pick<
        CallRecord,
        | "status"
        | "result"
        | "summary"
        | "taskCompleted"
        | "completionConfidence"
        | "evidence"
        | "transcript"
        | "failureCode"
        | "failureMessage"
        | "completedAt"
      >
    >,
  ): Promise<CallRecord | null>;
  getCall(id: string): Promise<CallRecord | null>;
  getCallByCalleId(calleCallId: string): Promise<CallRecord | null>;
  getCalls(taskId: string): Promise<CallRecord[]>;

  // Events
  addEvent(
    event: Omit<CallEvent, "id" | "createdAt" | "level"> & { level?: CallEvent["level"] },
  ): Promise<CallEvent>;
  getEvents(taskId: string): Promise<CallEvent[]>;

  // Claims
  createClaim(claim: Claim): Promise<Claim>;
  updateClaim(
    id: string,
    patch: Partial<Pick<Claim, "status" | "value" | "confidence" | "evidenceIds" | "callId" | "statusHistory">>,
  ): Promise<Claim | null>;
  getClaims(taskId: string): Promise<Claim[]>;

  // Evidence
  addEvidence(evidence: Evidence): Promise<Evidence>;
  getEvidence(taskId: string): Promise<Evidence[]>;

  // Decisions
  saveDecision(decision: Decision): Promise<Decision>;
  getDecision(taskId: string): Promise<Decision | null>;

  // Actions (authorized/blocked action ledger)
  addAction(action: {
    taskId?: string;
    candidateId?: string;
    callId?: string;
    type: string;
    authorized: boolean;
    detail?: unknown;
  }): Promise<void>;

  // Audit log
  addAudit(entry: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog>;
  getAudit(taskId: string): Promise<AuditLog[]>;

  // Webhook idempotency ledger. Returns false when the event was already seen.
  recordWebhookEvent(event: {
    eventId: string;
    type: string;
    calleCallId: string;
    payload: unknown;
  }): Promise<boolean>;

  close(): Promise<void>;
}
