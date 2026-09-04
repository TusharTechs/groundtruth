import { z } from "zod";

/**
 * GroundTruth domain model.
 *
 * The core product abstraction:
 *   USER GOAL -> CONSTRAINTS -> CANDIDATES -> PHONE CALLS -> CLAIMS
 *             -> EVIDENCE -> VERIFICATION -> DECISION
 *
 * Claims and evidence are first-class objects. A claim NEVER becomes
 * `verified` without attached evidence, and hedges ("probably", "I think",
 * "we usually have it") are never promoted to `verified`.
 */

// ---------------------------------------------------------------------------
// Verification statuses
// ---------------------------------------------------------------------------

export const claimStatusSchema = z.enum([
  "unknown",
  "pending",
  "verified",
  "contradicted",
  "failed",
  "expired",
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const taskStatusSchema = z.enum([
  "draft",
  "analyzed",
  "running",
  "completed",
  "failed",
  "canceled",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** Our mirror of CALL-E call lifecycle states (from @call-e/calle CallStatus). */
export const callStatusSchema = z.enum([
  "pending",
  "queued",
  "dialing",
  "in_progress",
  "completed",
  "failed",
  "canceled",
]);
export type CallStatus = z.infer<typeof callStatusSchema>;

// ---------------------------------------------------------------------------
// Authorization (safety)
// ---------------------------------------------------------------------------

export const permittedActionSchema = z.enum([
  "ask_question",
  "request_availability",
  "request_pricing",
  "request_delivery_estimate",
  "request_hold",
  "request_pickup_window",
]);
export type PermittedAction = z.infer<typeof permittedActionSchema>;

export const prohibitedActionSchema = z.enum([
  "purchase",
  "payment",
  "contract_acceptance",
  "legally_binding_commitment",
  "disclose_credentials",
  "disclose_payment_info",
]);
export type ProhibitedAction = z.infer<typeof prohibitedActionSchema>;

export const authorizationSchema = z.object({
  allowed: z.array(permittedActionSchema),
  prohibited: z.array(prohibitedActionSchema),
  /** Free-form note shown to the operator, e.g. "hold until 5 PM only". */
  note: z.string().optional(),
});
export type Authorization = z.infer<typeof authorizationSchema>;

export const DEFAULT_AUTHORIZATION: Authorization = {
  allowed: [
    "ask_question",
    "request_availability",
    "request_pricing",
    "request_delivery_estimate",
    "request_pickup_window",
  ],
  prohibited: [
    "purchase",
    "payment",
    "contract_acceptance",
    "legally_binding_commitment",
    "disclose_credentials",
    "disclose_payment_info",
  ],
};

// ---------------------------------------------------------------------------
// Verification goal (output of the Goal Analyzer)
// ---------------------------------------------------------------------------

export const constraintKindSchema = z.enum([
  "availability",
  "compatibility",
  "price_max",
  "quantity_min",
  "distance_max",
  "pickup_today",
  "hold_until",
  "deadline",
  "custom",
]);
export type ConstraintKind = z.infer<typeof constraintKindSchema>;

export const constraintSpecSchema = z.object({
  id: z.string(),
  kind: constraintKindSchema,
  label: z.string(),
  /** Hard requirements are deterministic gates; soft preferences only rank. */
  hard: z.boolean(),
  /** Parameters, e.g. { max: 25000, currency: "INR" } or { until: "17:00" }. */
  params: z.record(z.string(), z.unknown()),
  /** Question the planner will ask on the phone for this constraint. */
  question: z.string(),
  /** Structured-result field this constraint maps to. */
  claimKey: z.string(),
});
export type ConstraintSpec = z.infer<typeof constraintSpecSchema>;

export const verificationGoalSchema = z.object({
  objective: z.string(),
  item: z.string(),
  /** Equipment the item must work with, when relevant (e.g. "ACME HVAC-200"). */
  targetEquipment: z.string().optional(),
  hardConstraints: z.array(constraintSpecSchema),
  softPreferences: z.array(constraintSpecSchema),
  deadline: z.string().optional(),
  geography: z.string().optional(),
  authorization: authorizationSchema,
  successCriteria: z.string(),
  /** Demo-only: deterministic scenario the task was created from. */
  demoScenarioId: z.string().optional(),
});
export type VerificationGoal = z.infer<typeof verificationGoalSchema>;

export const goalAnalysisSchema = z.object({
  goal: verificationGoalSchema,
  /** Analyzer used: "heuristic" (deterministic, default) or "llm". */
  analyzer: z.enum(["heuristic", "llm"]),
});
export type GoalAnalysis = z.infer<typeof goalAnalysisSchema>;

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const candidateSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  name: z.string(),
  phone: z.string(),
  /** E.164 region code used for CALL-E routing (e.g. "IN", "US"). */
  region: z.string().default("IN"),
  locale: z.string().default("en-IN"),
  distanceKm: z.number().nullable().optional(),
  address: z.string().optional(),
  provider: z.enum(["demo", "manual", "web"]),
  priority: z.number().default(0),
  status: z.enum(["pending", "contacted", "viable", "rejected", "unreachable"]),
  rejectionReason: z.string().optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;

// ---------------------------------------------------------------------------
// Structured phone result (requested from CALL-E via resultSchema)
// ---------------------------------------------------------------------------

export const phoneResultSchema = z.object({
  availability: z.enum(["confirmed", "not_available", "uncertain"]).nullable(),
  quantity: z.number().int().nonnegative().nullable(),
  compatibility: z
    .enum(["confirmed", "not_compatible", "uncertain"])
    .nullable(),
  price: z.number().nonnegative().nullable(),
  currency: z.string().default("INR"),
  pickup_available: z.boolean().nullable(),
  pickup_time: z.string().nullable(),
  hold_available: z.boolean().nullable(),
  hold_confirmed: z.boolean().nullable(),
  hold_until: z.string().nullable(),
  notes: z.string().nullable(),
});
export type PhoneResult = z.infer<typeof phoneResultSchema>;

// ---------------------------------------------------------------------------
// Claims + Evidence
// ---------------------------------------------------------------------------

export const claimTypeSchema = z.enum([
  "availability",
  "compatibility",
  "price",
  "quantity",
  "pickup",
  "hold",
  "deadline",
  "service_area",
  "other",
]);
export type ClaimType = z.infer<typeof claimTypeSchema>;

export const claimStatusTransitionSchema = z.object({
  from: claimStatusSchema,
  to: claimStatusSchema,
  at: z.string(),
  reason: z.string(),
});
export type ClaimStatusTransition = z.infer<typeof claimStatusTransitionSchema>;

export const claimSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  candidateId: z.string(),
  callId: z.string().optional(),
  type: claimTypeSchema,
  statement: z.string(),
  value: z.unknown().nullable(),
  unit: z.string().optional(),
  status: claimStatusSchema,
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
  statusHistory: z.array(claimStatusTransitionSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Claim = z.infer<typeof claimSchema>;

export const evidenceSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  claimId: z.string(),
  callId: z.string(),
  candidateId: z.string(),
  source: z.enum(["calle_call", "calle_transcript", "structured_result"]),
  excerpt: z.string(),
  confidence: z.number().min(0).max(1),
  capturedAt: z.string(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

// ---------------------------------------------------------------------------
// Calls + events
// ---------------------------------------------------------------------------

export const transcriptTurnSchema = z.object({
  offsetSeconds: z.number().nullable(),
  speaker: z.enum(["bot", "user", "unknown"]),
  text: z.string(),
});
export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export const callRecordSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  candidateId: z.string(),
  /** CALL-E call id (calle_...). Equals local id in mock mode. */
  calleCallId: z.string(),
  attempt: z.number().int().min(1),
  purpose: z.enum(["verify", "follow_up"]),
  focusConstraints: z.array(z.string()),
  task: z.string(),
  status: callStatusSchema,
  mode: z.enum(["mock", "real"]),
  result: phoneResultSchema.nullable(),
  summary: z.string().nullable(),
  taskCompleted: z.boolean().nullable(),
  completionConfidence: z.number().nullable(),
  evidence: z.array(z.string()).default([]),
  transcript: z.array(transcriptTurnSchema).default([]),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type CallRecord = z.infer<typeof callRecordSchema>;

export const callEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  callId: z.string().optional(),
  candidateId: z.string().optional(),
  type: z.string(),
  message: z.string(),
  level: z.enum(["debug", "info", "warning", "error"]).default("info"),
  createdAt: z.string(),
});
export type CallEvent = z.infer<typeof callEventSchema>;

// ---------------------------------------------------------------------------
// Constraint evaluation
// ---------------------------------------------------------------------------

export const constraintEvaluationSchema = z.object({
  constraintId: z.string(),
  status: z.enum(["pass", "fail", "unknown"]),
  claimId: z.string().optional(),
  reason: z.string(),
  /** Set when evaluations are grouped per candidate for the UI. */
  candidateId: z.string().optional(),
});
export type ConstraintEvaluation = z.infer<typeof constraintEvaluationSchema>;

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export const decisionCandidateSchema = z.object({
  candidateId: z.string(),
  name: z.string(),
  verifiedHard: z.number().int(),
  failedHard: z.number().int(),
  unknownHard: z.number().int(),
  score: z.number(),
  viable: z.boolean(),
  reasons: z.array(z.string()),
});
export type DecisionCandidate = z.infer<typeof decisionCandidateSchema>;

export const decisionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  status: z.enum(["success", "no_match", "partial"]),
  winnerCandidateId: z.string().nullable(),
  ranked: z.array(decisionCandidateSchema),
  unresolvedConstraints: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  createdAt: z.string(),
});
export type Decision = z.infer<typeof decisionSchema>;

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export const auditLogSchema = z.object({
  id: z.string(),
  taskId: z.string().optional(),
  actor: z.enum(["system", "user", "calle"]),
  action: z.string(),
  detail: z.string(),
  createdAt: z.string(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

// ---------------------------------------------------------------------------
// Verification task (aggregate root)
// ---------------------------------------------------------------------------

export const verificationTaskSchema = z.object({
  id: z.string(),
  input: z.string(),
  goal: verificationGoalSchema.nullable(),
  plan: z.unknown().nullable(),
  status: taskStatusSchema,
  mode: z.enum(["mock", "real"]),
  analyzer: z.enum(["heuristic", "llm"]).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type VerificationTask = z.infer<typeof verificationTaskSchema>;

// ---------------------------------------------------------------------------
// Plan (output of the Verification Planner)
// ---------------------------------------------------------------------------

export const callQuestionSchema = z.object({
  constraintId: z.string(),
  question: z.string(),
  /** Question to ask only if the primary answer is hedged or uncertain. */
  fallbackQuestion: z.string().optional(),
});
export type CallQuestion = z.infer<typeof callQuestionSchema>;

export const stoppingRulesSchema = z.object({
  stopOnFirstFullyVerified: z.boolean().default(true),
  maxCalls: z.number().int().min(1).default(8),
  maxCallsPerCandidate: z.number().int().min(1).default(2),
});
export type StoppingRules = z.infer<typeof stoppingRulesSchema>;

export const verificationPlanSchema = z.object({
  questions: z.array(callQuestionSchema),
  openingLine: z.string(),
  disclosure: z.string(),
  stoppingRules: stoppingRulesSchema,
  candidateLimit: z.number().int().min(1).default(6),
});
export type VerificationPlan = z.infer<typeof verificationPlanSchema>;

// ---------------------------------------------------------------------------
// Task snapshot returned to the UI (single hydration payload)
// ---------------------------------------------------------------------------

export const taskSnapshotSchema = z.object({
  task: verificationTaskSchema,
  candidates: z.array(candidateSchema),
  calls: z.array(callRecordSchema),
  events: z.array(callEventSchema),
  claims: z.array(claimSchema),
  evidence: z.array(evidenceSchema),
  evaluations: z.array(constraintEvaluationSchema),
  decision: decisionSchema.nullable(),
  audit: z.array(auditLogSchema),
});
export type TaskSnapshot = z.infer<typeof taskSnapshotSchema>;
