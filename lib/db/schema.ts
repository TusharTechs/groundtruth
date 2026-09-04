import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * GroundTruth PostgreSQL schema (Drizzle ORM).
 *
 * Rich nested objects (goal, plan, call results, transcripts) are stored as
 * typed jsonb columns; queryable fields (ids, statuses, timestamps) are
 * normalized columns. Every table uses UUID primary keys and maintains
 * createdAt/updatedAt where appropriate.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

export const verificationTasks = pgTable("verification_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  input: text("input").notNull(),
  goal: jsonb("goal"),
  plan: jsonb("plan"),
  status: text("status").notNull().default("draft"),
  mode: text("mode").notNull().default("mock"),
  analyzer: text("analyzer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("verification_tasks_status_idx").on(t.status),
  index("verification_tasks_created_idx").on(t.createdAt),
]);

export const constraints = pgTable("constraints", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => verificationTasks.id, { onDelete: "cascade" }),
  spec: jsonb("spec").notNull(),
  hard: boolean("hard").notNull().default(true),
  kind: text("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("constraints_task_idx").on(t.taskId)]);

export const candidates = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => verificationTasks.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  region: text("region").notNull().default("IN"),
  locale: text("locale").notNull().default("en-IN"),
  distanceKm: doublePrecision("distance_km"),
  address: text("address"),
  provider: text("provider").notNull().default("demo"),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("pending"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("candidates_task_idx").on(t.taskId),
  index("candidates_status_idx").on(t.status),
]);

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => verificationTasks.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  calleCallId: text("calle_call_id").notNull(),
  attempt: integer("attempt").notNull().default(1),
  purpose: text("purpose").notNull().default("verify"),
  focusConstraints: jsonb("focus_constraints").notNull().default(sql`'[]'::jsonb`),
  task: text("task").notNull(),
  status: text("status").notNull().default("pending"),
  mode: text("mode").notNull().default("mock"),
  result: jsonb("result"),
  summary: text("summary"),
  taskCompleted: boolean("task_completed"),
  completionConfidence: doublePrecision("completion_confidence"),
  evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
  transcript: jsonb("transcript").notNull().default(sql`'[]'::jsonb`),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("calls_task_idx").on(t.taskId),
  index("calls_candidate_idx").on(t.candidateId),
  index("calls_status_idx").on(t.status),
  uniqueIndex("calls_calle_call_id_idx").on(t.calleCallId),
]);

export const callEvents = pgTable("call_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => verificationTasks.id, { onDelete: "cascade" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  level: text("level").notNull().default("info"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("call_events_task_idx").on(t.taskId),
  index("call_events_call_idx").on(t.callId),
]);

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => verificationTasks.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  statement: text("statement").notNull(),
  value: jsonb("value"),
  unit: text("unit"),
  status: text("status").notNull().default("unknown"),
  confidence: doublePrecision("confidence").notNull().default(0),
  evidenceIds: jsonb("evidence_ids").notNull().default(sql`'[]'::jsonb`),
  statusHistory: jsonb("status_history").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("claims_task_idx").on(t.taskId),
  index("claims_candidate_idx").on(t.candidateId),
  index("claims_status_idx").on(t.status),
]);

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => verificationTasks.id, { onDelete: "cascade" }),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id, { onDelete: "cascade" }),
  callId: uuid("call_id")
    .notNull()
    .references(() => calls.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id")
    .notNull()
    .references(() => candidates.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  excerpt: text("excerpt").notNull(),
  confidence: doublePrecision("confidence").notNull().default(0),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("evidence_claim_idx").on(t.claimId),
  index("evidence_call_idx").on(t.callId),
]);

export const decisions = pgTable("decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => verificationTasks.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  winnerCandidateId: uuid("winner_candidate_id").references(() => candidates.id, {
    onDelete: "set null",
  }),
  ranked: jsonb("ranked").notNull(),
  unresolvedConstraints: jsonb("unresolved_constraints").notNull().default(sql`'[]'::jsonb`),
  confidence: doublePrecision("confidence").notNull().default(0),
  explanation: text("explanation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("decisions_task_idx").on(t.taskId)]);

export const actions = pgTable("actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => verificationTasks.id, { onDelete: "cascade" }),
  candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "cascade" }),
  callId: uuid("call_id").references(() => calls.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  authorized: boolean("authorized").notNull().default(true),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("actions_task_idx").on(t.taskId)]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => verificationTasks.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_logs_task_idx").on(t.taskId),
  index("audit_logs_created_idx").on(t.createdAt),
]);

/** Idempotency ledger for CALL-E webhook deliveries (event id is unique). */
export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull(),
  type: text("type").notNull(),
  calleCallId: text("calle_call_id").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("webhook_events_event_id_idx").on(t.eventId)]);
