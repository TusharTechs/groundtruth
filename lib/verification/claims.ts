import { randomUUID } from "node:crypto";
import type {
  CallRecord,
  Candidate,
  Claim,
  ClaimStatus,
  ClaimType,
  ConstraintSpec,
  PhoneResult,
} from "@/lib/domain/types";

/**
 * Claim extraction + lifecycle.
 *
 * Rules enforced here (unit-tested):
 *  - A claim only becomes `verified` when a concrete, unhedged value exists
 *    AND evidence is attached (evidenceIds non-empty).
 *  - "probably", "I think", "we usually have it" style hedges (`uncertain`
 *    values or null fields) keep the claim `unknown`.
 *  - Verified claims are immutable: later calls can only confirm (no-op) or
 *    `contradict` (recorded in statusHistory). A low-confidence inference
 *    can never silently become verified.
 *  - CALL-E completion confidence < MIN_COMPLETION_CONFIDENCE downgrades a
 *    would-be verified claim to `unknown`.
 */

export const MIN_COMPLETION_CONFIDENCE = 0.5;

export class ClaimLifecycleError extends Error {
  constructor(from: ClaimStatus, to: ClaimStatus, why: string) {
    super(`Illegal claim transition ${from} -> ${to}: ${why}`);
    this.name = "ClaimLifecycleError";
  }
}

/** Map structured-result fields to claim types + statement builders. */
interface ClaimProjection {
  type: ClaimType;
  statement: (candidate: Candidate, result: PhoneResult) => string;
  value: (result: PhoneResult) => unknown;
  /** Concrete values that justify `verified`; null keeps `unknown`. */
  verifiedValue: (result: PhoneResult) => unknown;
  /** Values that mark the claim `failed` outright. */
  failedValue: (result: PhoneResult) => boolean;
}

const projections: Partial<Record<ClaimType, ClaimProjection>> = {
  availability: {
    type: "availability",
    statement: (c) => `${c.name} availability of the requested item`,
    value: (r) => r.availability,
    verifiedValue: (r) => (r.availability === "confirmed" ? r.quantity ?? "confirmed" : null),
    failedValue: (r) => r.availability === "not_available",
  },
  compatibility: {
    type: "compatibility",
    statement: (c) => `Item is compatible with the target equipment (${c.name} claim)`,
    value: (r) => r.compatibility,
    verifiedValue: (r) => (r.compatibility === "confirmed" ? "compatible" : null),
    failedValue: (r) => r.compatibility === "not_compatible",
  },
  price: {
    type: "price",
    statement: (c) => `${c.name} quoted price`,
    value: (r) => (r.price === null ? null : { amount: r.price, currency: r.currency }),
    verifiedValue: (r) => (typeof r.price === "number" ? { amount: r.price, currency: r.currency } : null),
    failedValue: () => false,
  },
  quantity: {
    type: "quantity",
    statement: (c) => `${c.name} units in stock`,
    value: (r) => r.quantity,
    verifiedValue: (r) => (typeof r.quantity === "number" ? r.quantity : null),
    failedValue: () => false,
  },
  pickup: {
    type: "pickup",
    statement: (c) => `${c.name} same-day pickup`,
    value: (r) => (r.pickup_available === null ? null : r.pickup_available ? r.pickup_time ?? true : false),
    verifiedValue: (r) => (r.pickup_available === true ? r.pickup_time ?? true : null),
    failedValue: (r) => r.pickup_available === false,
  },
  hold: {
    type: "hold",
    statement: (c) => `${c.name} temporary hold (no purchase)`,
    value: (r) =>
      r.hold_confirmed === true
        ? r.hold_until ?? "confirmed"
        : r.hold_available === true
          ? "possible_not_confirmed"
          : r.hold_available === false
            ? "not_possible"
            : null,
    verifiedValue: (r) => (r.hold_confirmed === true ? r.hold_until ?? "confirmed" : null),
    failedValue: (r) => r.hold_available === false,
  },
};

export function projectionFor(type: ClaimType): ClaimProjection | undefined {
  return projections[type];
}

export function claimTypeFromConstraintKind(kind: string): ClaimType {
  switch (kind) {
    case "availability":
      return "availability";
    case "compatibility":
      return "compatibility";
    case "price_max":
      return "price";
    case "quantity_min":
      return "quantity";
    case "pickup_today":
    case "deadline":
      return "pickup";
    case "hold_until":
      return "hold";
    default:
      return "other";
  }
}

export interface ExtractedClaim {
  claim: Claim;
  /** Whether this call's result justifies the recorded status. */
  justified: boolean;
}

const nowIso = () => new Date().toISOString();

/**
 * Extract (or update) a claim for one constraint from a completed call.
 * Returns a NEW claim object; lifecycle validation happens in applyClaimUpdate.
 */
export function extractClaim(
  constraint: ConstraintSpec,
  call: CallRecord,
  candidate: Candidate,
  hasEvidence: boolean,
): Claim {
  const type = claimTypeFromConstraintKind(constraint.kind);
  const proj = projectionFor(type);
  const result = call.result;
  const at = nowIso();
  const callConfidence = call.completionConfidence ?? 0.8;

  let status: ClaimStatus = "unknown";
  let value: unknown = null;

  if (proj && result) {
    value = proj.value(result);
    if (proj.failedValue(result)) {
      status = "failed";
    } else if (proj.verifiedValue(result) !== null) {
      const lowConfidence = callConfidence < MIN_COMPLETION_CONFIDENCE;
      status = hasEvidence && !lowConfidence ? "verified" : "unknown";
    }
  }

  const statement = proj
    ? proj.statement(candidate, result ?? emptyResult())
    : `${constraint.label} (${candidate.name})`;

  return {
    id: randomUUID(),
    taskId: call.taskId,
    candidateId: candidate.id,
    callId: call.id,
    type,
    statement,
    value,
    unit: type === "price" ? result?.currency : undefined,
    status,
    confidence: status === "verified" ? callConfidence : 0,
    evidenceIds: [],
    statusHistory: [{ from: "unknown", to: status, at, reason: `Call ${call.calleCallId} terminal result` }],
    createdAt: at,
    updatedAt: at,
  };
}

function emptyResult(): PhoneResult {
  return {
    availability: null,
    quantity: null,
    compatibility: null,
    price: null,
    currency: "INR",
    pickup_available: null,
    pickup_time: null,
    hold_available: null,
    hold_confirmed: null,
    hold_until: null,
    notes: null,
  };
}

/**
 * Apply a new extraction onto an existing claim, enforcing lifecycle rules.
 * Throws ClaimLifecycleError on illegal transitions so bugs surface in tests.
 */
export function applyClaimUpdate(
  existing: Claim,
  next: Claim,
  hasEvidence: boolean,
): Claim {
  const at = nowIso();
  const from = existing.status;
  const to = next.status;

  const legal: Record<ClaimStatus, ClaimStatus[]> = {
    unknown: ["pending", "verified", "contradicted", "failed", "unknown"],
    pending: ["verified", "contradicted", "failed", "unknown", "pending"],
    verified: ["verified", "contradicted"],
    contradicted: ["contradicted", "verified"],
    failed: ["failed", "verified", "contradicted"],
    expired: ["unknown", "pending", "verified", "contradicted", "failed", "expired"],
  };

  if (!legal[from].includes(to)) {
    throw new ClaimLifecycleError(from, to, "transition not allowed");
  }
  if (to === "verified" && !hasEvidence) {
    throw new ClaimLifecycleError(from, to, "verified requires attached evidence");
  }

  // Verified claims are immutable in value: a later confirming call is a
  // no-op; a contradicting call flips status and records history.
  if (from === "verified" && to === "verified") {
    return existing;
  }

  return {
    ...existing,
    status: to,
    value: to === "unknown" ? existing.value : next.value ?? existing.value,
    confidence: next.confidence,
    callId: next.callId ?? existing.callId,
    evidenceIds: [...existing.evidenceIds, ...next.evidenceIds],
    statusHistory: [
      ...existing.statusHistory,
      { from, to, at, reason: next.statusHistory.at(-1)?.reason ?? "updated" },
    ],
    updatedAt: at,
  };
}
