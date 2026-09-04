import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
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

const toIso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : d;
const toDate = (s: string | null | undefined): Date | null =>
  s == null ? null : new Date(s);

/**
 * PostgreSQL store (Drizzle ORM). Selected when DATABASE_URL is set.
 * Rich nested objects are stored as typed jsonb columns; the row mapping is
 * intentionally explicit so referential integrity lives in the schema.
 */
export class PostgresStore implements GroundTruthStore {
  private db: NodePgDatabase<typeof schema>;
  private pool: Pool;

  constructor(connectionString: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool: PgPool } = require("pg") as typeof import("pg");
    this.pool = new PgPool({ connectionString, max: 5 });
    this.db = drizzle(this.pool, { schema });
  }

  // -- Tasks ---------------------------------------------------------------

  async createTask(task: VerificationTask): Promise<VerificationTask> {
    await this.db.insert(schema.verificationTasks).values({
      id: task.id,
      input: task.input,
      goal: task.goal,
      plan: task.plan,
      status: task.status,
      mode: task.mode,
      analyzer: task.analyzer,
      createdAt: new Date(task.createdAt),
      updatedAt: new Date(task.updatedAt),
    });
    return task;
  }

  async getTask(id: string): Promise<VerificationTask | null> {
    const rows = await this.db
      .select()
      .from(schema.verificationTasks)
      .where(eq(schema.verificationTasks.id, id))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      input: r.input,
      goal: (r.goal as VerificationTask["goal"]) ?? null,
      plan: (r.plan as VerificationTask["plan"]) ?? null,
      status: r.status as VerificationTask["status"],
      mode: r.mode as VerificationTask["mode"],
      analyzer: (r.analyzer as VerificationTask["analyzer"]) ?? null,
      createdAt: toIso(r.createdAt)!,
      updatedAt: toIso(r.updatedAt)!,
      completedAt: toIso(r.completedAt),
    };
  }

  async updateTask(
    id: string,
    patch: Partial<Pick<VerificationTask, "goal" | "plan" | "status" | "completedAt" | "analyzer">>,
  ): Promise<VerificationTask | null> {
    await this.db
      .update(schema.verificationTasks)
      .set({
        ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
        ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.analyzer !== undefined ? { analyzer: patch.analyzer } : {}),
        ...(patch.completedAt !== undefined
          ? { completedAt: toDate(patch.completedAt) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.verificationTasks.id, id));
    return this.getTask(id);
  }

  async listTasks(limit = 50): Promise<VerificationTask[]> {
    const rows = await this.db
      .select()
      .from(schema.verificationTasks)
      .orderBy(desc(schema.verificationTasks.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      input: r.input,
      goal: (r.goal as VerificationTask["goal"]) ?? null,
      plan: (r.plan as VerificationTask["plan"]) ?? null,
      status: r.status as VerificationTask["status"],
      mode: r.mode as VerificationTask["mode"],
      analyzer: (r.analyzer as VerificationTask["analyzer"]) ?? null,
      createdAt: toIso(r.createdAt)!,
      updatedAt: toIso(r.updatedAt)!,
      completedAt: toIso(r.completedAt),
    }));
  }

  // -- Constraints -----------------------------------------------------------

  async saveConstraints(taskId: string, specs: ConstraintSpec[]): Promise<void> {
    await this.db
      .delete(schema.constraints)
      .where(eq(schema.constraints.taskId, taskId));
    if (specs.length === 0) return;
    await this.db.insert(schema.constraints).values(
      specs.map((spec) => ({
        taskId,
        spec,
        hard: spec.hard,
        kind: spec.kind,
      })),
    );
  }

  async getConstraints(taskId: string): Promise<ConstraintSpec[]> {
    const rows = await this.db
      .select()
      .from(schema.constraints)
      .where(eq(schema.constraints.taskId, taskId));
    return rows.map((r) => r.spec as ConstraintSpec);
  }

  // -- Candidates ------------------------------------------------------------

  async addCandidates(taskId: string, candidates: Candidate[]): Promise<Candidate[]> {
    if (candidates.length === 0) return candidates;
    await this.db.insert(schema.candidates).values(
      candidates.map((c) => ({
        id: c.id,
        taskId,
        name: c.name,
        phone: c.phone,
        region: c.region,
        locale: c.locale,
        distanceKm: c.distanceKm ?? null,
        address: c.address ?? null,
        provider: c.provider,
        priority: c.priority,
        status: c.status,
        rejectionReason: c.rejectionReason ?? null,
      })),
    );
    return candidates;
  }

  private mapCandidate(r: typeof schema.candidates.$inferSelect): Candidate {
    return {
      id: r.id,
      taskId: r.taskId,
      name: r.name,
      phone: r.phone,
      region: r.region,
      locale: r.locale,
      distanceKm: r.distanceKm ?? null,
      address: r.address ?? undefined,
      provider: r.provider as Candidate["provider"],
      priority: r.priority,
      status: r.status as Candidate["status"],
      rejectionReason: r.rejectionReason ?? undefined,
    };
  }

  async getCandidates(taskId: string): Promise<Candidate[]> {
    const rows = await this.db
      .select()
      .from(schema.candidates)
      .where(eq(schema.candidates.taskId, taskId))
      .orderBy(schema.candidates.priority);
    return rows.map((r) => this.mapCandidate(r));
  }

  async updateCandidate(
    id: string,
    patch: Partial<Pick<Candidate, "status" | "rejectionReason" | "priority">>,
  ): Promise<Candidate | null> {
    await this.db
      .update(schema.candidates)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rejectionReason !== undefined
          ? { rejectionReason: patch.rejectionReason }
          : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.candidates.id, id));
    const rows = await this.db
      .select()
      .from(schema.candidates)
      .where(eq(schema.candidates.id, id))
      .limit(1);
    return rows[0] ? this.mapCandidate(rows[0]) : null;
  }

  // -- Calls -----------------------------------------------------------------

  async createCall(call: CallRecord): Promise<CallRecord> {
    await this.db.insert(schema.calls).values({
      id: call.id,
      taskId: call.taskId,
      candidateId: call.candidateId,
      calleCallId: call.calleCallId,
      attempt: call.attempt,
      purpose: call.purpose,
      focusConstraints: call.focusConstraints,
      task: call.task,
      status: call.status,
      mode: call.mode,
      result: call.result,
      summary: call.summary,
      taskCompleted: call.taskCompleted,
      completionConfidence: call.completionConfidence,
      evidence: call.evidence,
      transcript: call.transcript,
      failureCode: call.failureCode,
      failureMessage: call.failureMessage,
      createdAt: new Date(call.createdAt),
      completedAt: toDate(call.completedAt),
    });
    return call;
  }

  private mapCall(r: typeof schema.calls.$inferSelect): CallRecord {
    return {
      id: r.id,
      taskId: r.taskId,
      candidateId: r.candidateId,
      calleCallId: r.calleCallId,
      attempt: r.attempt,
      purpose: r.purpose as CallRecord["purpose"],
      focusConstraints: (r.focusConstraints as string[]) ?? [],
      task: r.task,
      status: r.status as CallRecord["status"],
      mode: r.mode as CallRecord["mode"],
      result: (r.result as CallRecord["result"]) ?? null,
      summary: r.summary,
      taskCompleted: r.taskCompleted,
      completionConfidence: r.completionConfidence,
      evidence: (r.evidence as string[]) ?? [],
      transcript: (r.transcript as CallRecord["transcript"]) ?? [],
      failureCode: r.failureCode,
      failureMessage: r.failureMessage,
      createdAt: toIso(r.createdAt)!,
      completedAt: toIso(r.completedAt),
    };
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
    await this.db
      .update(schema.calls)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.result !== undefined ? { result: patch.result } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.taskCompleted !== undefined
          ? { taskCompleted: patch.taskCompleted }
          : {}),
        ...(patch.completionConfidence !== undefined
          ? { completionConfidence: patch.completionConfidence }
          : {}),
        ...(patch.evidence !== undefined ? { evidence: patch.evidence } : {}),
        ...(patch.transcript !== undefined ? { transcript: patch.transcript } : {}),
        ...(patch.failureCode !== undefined ? { failureCode: patch.failureCode } : {}),
        ...(patch.failureMessage !== undefined
          ? { failureMessage: patch.failureMessage }
          : {}),
        ...(patch.completedAt !== undefined
          ? { completedAt: toDate(patch.completedAt) }
          : {}),
      })
      .where(eq(schema.calls.id, id));
    const rows = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.id, id))
      .limit(1);
    return rows[0] ? this.mapCall(rows[0]) : null;
  }

  async getCall(id: string): Promise<CallRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.id, id))
      .limit(1);
    return rows[0] ? this.mapCall(rows[0]) : null;
  }

  async getCallByCalleId(calleCallId: string): Promise<CallRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.calleCallId, calleCallId))
      .limit(1);
    return rows[0] ? this.mapCall(rows[0]) : null;
  }

  async getCalls(taskId: string): Promise<CallRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.calls)
      .where(eq(schema.calls.taskId, taskId))
      .orderBy(schema.calls.createdAt);
    return rows.map((r) => this.mapCall(r));
  }

  // -- Events ----------------------------------------------------------------

  async addEvent(
    event: Omit<CallEvent, "id" | "createdAt" | "level"> & { level?: CallEvent["level"] },
  ): Promise<CallEvent> {
    const id = randomUUID();
    const createdAt = new Date();
    await this.db.insert(schema.callEvents).values({
      id,
      taskId: event.taskId,
      callId: event.callId ?? null,
      candidateId: event.candidateId ?? null,
      type: event.type,
      message: event.message,
      level: event.level ?? "info",
      createdAt,
    });
    return { level: "info", ...event, id, createdAt: createdAt.toISOString() };
  }

  async getEvents(taskId: string): Promise<CallEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.callEvents)
      .where(eq(schema.callEvents.taskId, taskId))
      .orderBy(schema.callEvents.createdAt);
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      callId: r.callId ?? undefined,
      candidateId: r.candidateId ?? undefined,
      type: r.type,
      message: r.message,
      level: r.level as CallEvent["level"],
      createdAt: toIso(r.createdAt)!,
    }));
  }

  // -- Claims ------------------------------------------------------------------

  private mapClaim(r: typeof schema.claims.$inferSelect): Claim {
    return {
      id: r.id,
      taskId: r.taskId,
      candidateId: r.candidateId,
      callId: r.callId ?? undefined,
      type: r.type as Claim["type"],
      statement: r.statement,
      value: r.value ?? null,
      unit: r.unit ?? undefined,
      status: r.status as Claim["status"],
      confidence: r.confidence,
      evidenceIds: (r.evidenceIds as string[]) ?? [],
      statusHistory: (r.statusHistory as Claim["statusHistory"]) ?? [],
      createdAt: toIso(r.createdAt)!,
      updatedAt: toIso(r.updatedAt)!,
    };
  }

  async createClaim(claim: Claim): Promise<Claim> {
    await this.db.insert(schema.claims).values({
      id: claim.id,
      taskId: claim.taskId,
      candidateId: claim.candidateId,
      callId: claim.callId ?? null,
      type: claim.type,
      statement: claim.statement,
      value: claim.value as never,
      unit: claim.unit ?? null,
      status: claim.status,
      confidence: claim.confidence,
      evidenceIds: claim.evidenceIds,
      statusHistory: claim.statusHistory,
      createdAt: new Date(claim.createdAt),
      updatedAt: new Date(claim.updatedAt),
    });
    return claim;
  }

  async updateClaim(
    id: string,
    patch: Partial<Pick<Claim, "status" | "value" | "confidence" | "evidenceIds" | "callId" | "statusHistory">>,
  ): Promise<Claim | null> {
    await this.db
      .update(schema.claims)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.value !== undefined ? { value: patch.value as never } : {}),
        ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
        ...(patch.evidenceIds !== undefined ? { evidenceIds: patch.evidenceIds } : {}),
        ...(patch.callId !== undefined ? { callId: patch.callId } : {}),
        ...(patch.statusHistory !== undefined
          ? { statusHistory: patch.statusHistory }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.claims.id, id));
    const rows = await this.db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.id, id))
      .limit(1);
    return rows[0] ? this.mapClaim(rows[0]) : null;
  }

  async getClaims(taskId: string): Promise<Claim[]> {
    const rows = await this.db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.taskId, taskId))
      .orderBy(schema.claims.createdAt);
    return rows.map((r) => this.mapClaim(r));
  }

  // -- Evidence ----------------------------------------------------------------

  async addEvidence(e: Evidence): Promise<Evidence> {
    await this.db.insert(schema.evidence).values({
      id: e.id,
      taskId: e.taskId,
      claimId: e.claimId,
      callId: e.callId,
      candidateId: e.candidateId,
      source: e.source,
      excerpt: e.excerpt,
      confidence: e.confidence,
      capturedAt: new Date(e.capturedAt),
    });
    return e;
  }

  async getEvidence(taskId: string): Promise<Evidence[]> {
    const rows = await this.db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.taskId, taskId))
      .orderBy(schema.evidence.capturedAt);
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      claimId: r.claimId,
      callId: r.callId,
      candidateId: r.candidateId,
      source: r.source as Evidence["source"],
      excerpt: r.excerpt,
      confidence: r.confidence,
      capturedAt: toIso(r.capturedAt)!,
    }));
  }

  // -- Decisions ---------------------------------------------------------------

  async saveDecision(decision: Decision): Promise<Decision> {
    await this.db
      .delete(schema.decisions)
      .where(eq(schema.decisions.taskId, decision.taskId));
    await this.db.insert(schema.decisions).values({
      id: decision.id,
      taskId: decision.taskId,
      status: decision.status,
      winnerCandidateId: decision.winnerCandidateId,
      ranked: decision.ranked,
      unresolvedConstraints: decision.unresolvedConstraints,
      confidence: decision.confidence,
      explanation: decision.explanation,
      createdAt: new Date(decision.createdAt),
    });
    return decision;
  }

  async getDecision(taskId: string): Promise<Decision | null> {
    const rows = await this.db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.taskId, taskId))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      taskId: r.taskId,
      status: r.status as Decision["status"],
      winnerCandidateId: r.winnerCandidateId,
      ranked: (r.ranked as Decision["ranked"]) ?? [],
      unresolvedConstraints: (r.unresolvedConstraints as string[]) ?? [],
      confidence: r.confidence,
      explanation: r.explanation,
      createdAt: toIso(r.createdAt)!,
    };
  }

  // -- Actions ---------------------------------------------------------------

  async addAction(action: {
    taskId?: string;
    candidateId?: string;
    callId?: string;
    type: string;
    authorized: boolean;
    detail?: unknown;
  }): Promise<void> {
    await this.db.insert(schema.actions).values({
      taskId: action.taskId ?? null,
      candidateId: action.candidateId ?? null,
      callId: action.callId ?? null,
      type: action.type,
      authorized: action.authorized,
      detail: (action.detail as never) ?? null,
    });
  }

  // -- Audit -----------------------------------------------------------------

  async addAudit(entry: Omit<AuditLog, "id" | "createdAt">): Promise<AuditLog> {
    const id = randomUUID();
    const createdAt = new Date();
    await this.db.insert(schema.auditLogs).values({
      id,
      taskId: entry.taskId ?? null,
      actor: entry.actor,
      action: entry.action,
      detail: entry.detail,
      createdAt,
    });
    return { ...entry, id, createdAt: createdAt.toISOString() };
  }

  async getAudit(taskId: string): Promise<AuditLog[]> {
    const rows = await this.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.taskId, taskId))
      .orderBy(schema.auditLogs.createdAt);
    return rows.map((r) => ({
      id: r.id,
      taskId: r.taskId ?? undefined,
      actor: r.actor as AuditLog["actor"],
      action: r.action,
      detail: r.detail,
      createdAt: toIso(r.createdAt)!,
    }));
  }

  // -- Webhook idempotency -----------------------------------------------------

  async recordWebhookEvent(event: {
    eventId: string;
    type: string;
    calleCallId: string;
    payload: unknown;
  }): Promise<boolean> {
    const inserted = await this.db
      .insert(schema.webhookEvents)
      .values({
        eventId: event.eventId,
        type: event.type,
        calleCallId: event.calleCallId,
        payload: event.payload as never,
      })
      .onConflictDoNothing({ target: schema.webhookEvents.eventId })
      .returning({ id: schema.webhookEvents.id });
    return inserted.length > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Re-export for drizzle-kit push health checks.
export { sql, and };
