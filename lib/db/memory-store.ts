import { randomUUID } from "node:crypto";
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
import type { GroundTruthStore } from "@/lib/db/store";

const nowIso = () => new Date().toISOString();

/**
 * In-process store. Selected when DATABASE_URL is unset: local demos and the
 * test suite run with zero external dependencies and deterministic state.
 */
export class MemoryStore implements GroundTruthStore {
  private tasks = new Map<string, VerificationTask>();
  private constraints = new Map<string, ConstraintSpec[]>();
  private candidates = new Map<string, Candidate>();
  private calls = new Map<string, CallRecord>();
  private callsByCalle = new Map<string, string>();
  private events = new Map<string, CallEvent>();
  private claims = new Map<string, Claim>();
  private evidence = new Map<string, Evidence>();
  private decisions = new Map<string, Decision>();
  private actions: unknown[] = [];
  private audit = new Map<string, AuditLog>();
  private webhookEventIds = new Set<string>();

  async createTask(task: VerificationTask): Promise<VerificationTask> {
    this.tasks.set(task.id, { ...task });
    return task;
  }

  async getTask(id: string): Promise<VerificationTask | null> {
    return this.tasks.get(id) ?? null;
  }

  async updateTask(
    id: string,
    patch: Partial<Pick<VerificationTask, "goal" | "plan" | "status" | "completedAt" | "analyzer">>,
  ): Promise<VerificationTask | null> {
    const t = this.tasks.get(id);
    if (!t) return null;
    const updated = { ...t, ...patch, updatedAt: nowIso() };
    this.tasks.set(id, updated);
    return updated;
  }

  async listTasks(limit = 50): Promise<VerificationTask[]> {
    return [...this.tasks.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async saveConstraints(taskId: string, specs: ConstraintSpec[]): Promise<void> {
    this.constraints.set(taskId, specs);
  }

  async getConstraints(taskId: string): Promise<ConstraintSpec[]> {
    return this.constraints.get(taskId) ?? [];
  }

  async addCandidates(taskId: string, candidates: Candidate[]): Promise<Candidate[]> {
    for (const c of candidates) this.candidates.set(c.id, { ...c, taskId });
    return candidates;
  }

  async getCandidates(taskId: string): Promise<Candidate[]> {
    return [...this.candidates.values()].filter((c) => c.taskId === taskId);
  }

  async updateCandidate(
    id: string,
    patch: Partial<Pick<Candidate, "status" | "rejectionReason" | "priority">>,
  ): Promise<Candidate | null> {
    const c = this.candidates.get(id);
    if (!c) return null;
    const updated = { ...c, ...patch };
    this.candidates.set(id, updated);
    return updated;
  }

  async createCall(call: CallRecord): Promise<CallRecord> {
    this.calls.set(call.id, { ...call });
    this.callsByCalle.set(call.calleCallId, call.id);
    return call;
  }

  async updateCall(
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
  ): Promise<CallRecord | null> {
    const c = this.calls.get(id);
    if (!c) return null;
    const updated = { ...c, ...patch };
    this.calls.set(id, updated);
    return updated;
  }

  async getCall(id: string): Promise<CallRecord | null> {
    return this.calls.get(id) ?? null;
  }

  async getCallByCalleId(calleCallId: string): Promise<CallRecord | null> {
    const id = this.callsByCalle.get(calleCallId);
    return id ? this.calls.get(id) ?? null : null;
  }

  async getCalls(taskId: string): Promise<CallRecord[]> {
    return [...this.calls.values()].filter((c) => c.taskId === taskId);
  }

  async addEvent(
    event: Omit<CallEvent, "id" | "createdAt" | "level"> & { level?: CallEvent["level"] },
  ): Promise<CallEvent> {
    const full: CallEvent = { level: "info", ...event, id: randomUUID(), createdAt: nowIso() };
    this.events.set(full.id, full);
    return full;
  }

  async getEvents(taskId: string): Promise<CallEvent[]> {
    return [...this.events.values()]
      .filter((e) => e.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createClaim(claim: Claim): Promise<Claim> {
    this.claims.set(claim.id, { ...claim });
    return claim;
  }

  async updateClaim(
    id: string,
    patch: Partial<Pick<Claim, "status" | "value" | "confidence" | "evidenceIds" | "callId" | "statusHistory">>,
  ): Promise<Claim | null> {
    const c = this.claims.get(id);
    if (!c) return null;
    const updated = { ...c, ...patch, updatedAt: nowIso() };
    this.claims.set(id, updated);
    return updated;
  }

  async getClaims(taskId: string): Promise<Claim[]> {
    return [...this.claims.values()].filter((c) => c.taskId === taskId);
  }

  async addEvidence(evidence: Evidence): Promise<Evidence> {
    this.evidence.set(evidence.id, { ...evidence });
    return evidence;
  }

  async getEvidence(taskId: string): Promise<Evidence[]> {
    return [...this.evidence.values()].filter((e) => e.taskId === taskId);
  }

  async saveDecision(decision: Decision): Promise<Decision> {
    this.decisions.set(decision.taskId, decision);
    return decision;
  }

  async getDecision(taskId: string): Promise<Decision | null> {
    return this.decisions.get(taskId) ?? null;
  }

  async addAction(action: {
    taskId?: string;
    candidateId?: string;
    callId?: string;
    type: string;
    authorized: boolean;
    detail?: unknown;
  }): Promise<void> {
    this.actions.push({ id: randomUUID(), createdAt: nowIso(), ...action });
  }

  async addAudit(entry: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog> {
    const full: AuditLog = { ...entry, id: randomUUID(), createdAt: nowIso() };
    this.audit.set(full.id, full);
    return full;
  }

  async getAudit(taskId: string): Promise<AuditLog[]> {
    return [...this.audit.values()]
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async recordWebhookEvent(event: {
    eventId: string;
    type: string;
    calleCallId: string;
    payload: unknown;
  }): Promise<boolean> {
    if (this.webhookEventIds.has(event.eventId)) return false;
    this.webhookEventIds.add(event.eventId);
    return true;
  }

  async close(): Promise<void> {}
}
