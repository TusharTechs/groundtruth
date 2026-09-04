import type {
  Candidate,
  ConstraintEvaluation,
  ConstraintSpec,
  PhoneResult,
} from "@/lib/domain/types";

/**
 * Deterministic constraint evaluation.
 *
 * Hard constraints are pure functions of (constraint, phone result, candidate).
 * They NEVER consult an LLM and NEVER convert uncertainty into success:
 * a missing or hedged field evaluates to `unknown`, not `pass`.
 */

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parse "5 PM", "17:00", "5:30 PM" into minutes since midnight. */
export function parseClock(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const mer = m[3]?.toUpperCase();
  if (mer === "PM" && h < 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function evaluateConstraint(
  constraint: ConstraintSpec,
  result: PhoneResult | null,
  candidate?: Pick<Candidate, "distanceKm"> | null,
): ConstraintEvaluation {
  const { kind, params, id } = constraint;
  const max = num(params.max);
  const min = num(params.min);

  const enumish = (
    value: "confirmed" | "not_available" | "not_compatible" | "uncertain" | null,
    passValue: string,
    failValues: string[],
    label: string,
  ): ConstraintEvaluation => {
    if (value === null) {
      return { constraintId: id, status: "unknown", reason: `${label} was not answered` };
    }
    if (value === passValue) {
      return { constraintId: id, status: "pass", reason: `${label} explicitly confirmed` };
    }
    if (failValues.includes(value)) {
      return { constraintId: id, status: "fail", reason: `${label}: ${value}` };
    }
    return { constraintId: id, status: "unknown", reason: `${label} answer was hedged or uncertain` };
  };

  switch (kind) {
    case "availability":
      return enumish(result?.availability ?? null, "confirmed", ["not_available"], "Availability");

    case "compatibility":
      return enumish(result?.compatibility ?? null, "confirmed", ["not_compatible"], "Compatibility");

    case "price_max": {
      const price = result ? num(result.price) : null;
      if (price === null) {
        return { constraintId: id, status: "unknown", reason: "Price was not quoted" };
      }
      if (max === null) {
        return { constraintId: id, status: "unknown", reason: "No price ceiling configured" };
      }
      return price <= max
        ? {
            constraintId: id,
            status: "pass",
            reason: `Quoted price ${price} ≤ ceiling ${max}`,
          }
        : {
            constraintId: id,
            status: "fail",
            reason: `Quoted price ${price} exceeds ceiling ${max}`,
          };
    }

    case "quantity_min": {
      const q = result ? num(result.quantity) : null;
      if (q === null) {
        return { constraintId: id, status: "unknown", reason: "Quantity was not confirmed" };
      }
      if (min === null) {
        return { constraintId: id, status: "unknown", reason: "No minimum quantity configured" };
      }
      return q >= min
        ? { constraintId: id, status: "pass", reason: `${q} units ≥ required ${min}` }
        : { constraintId: id, status: "fail", reason: `Only ${q} units < required ${min}` };
    }

    case "distance_max": {
      // Distance comes from the candidate record (discovery), not the call.
      const d = candidate?.distanceKm ?? null;
      if (d === null) {
        return { constraintId: id, status: "unknown", reason: "Candidate distance unknown" };
      }
      if (max === null) {
        return { constraintId: id, status: "unknown", reason: "No distance ceiling configured" };
      }
      return d <= max
        ? { constraintId: id, status: "pass", reason: `${d} km ≤ ${max} km` }
        : { constraintId: id, status: "fail", reason: `${d} km exceeds ${max} km` };
    }

    case "pickup_today": {
      const p = result?.pickup_available;
      if (p === null || p === undefined) {
        return { constraintId: id, status: "unknown", reason: "Pickup availability not answered" };
      }
      return p
        ? {
            constraintId: id,
            status: "pass",
            reason: result?.pickup_time
              ? `Pickup today confirmed (window: ${result.pickup_time})`
              : "Pickup today confirmed",
          }
        : { constraintId: id, status: "fail", reason: "Pickup today not possible" };
    }

    case "hold_until": {
      if (result?.hold_confirmed === true) {
        return {
          constraintId: id,
          status: "pass",
          reason: result.hold_until
            ? `Hold confirmed until ${result.hold_until}`
            : "Hold confirmed",
        };
      }
      if (result?.hold_available === false) {
        return { constraintId: id, status: "fail", reason: "Supplier cannot hold items" };
      }
      if (result?.hold_confirmed === false && result?.hold_available === true) {
        return {
          constraintId: id,
          status: "unknown",
          reason: "Hold is possible but not yet confirmed — follow-up needed",
        };
      }
      return { constraintId: id, status: "unknown", reason: "Hold status not established" };
    }

    case "deadline": {
      const until = parseClock(String(params.until ?? ""));
      const offered = parseClock(result?.pickup_time ?? result?.hold_until ?? null);
      if (until === null || offered === null) {
        return {
          constraintId: id,
          status: "unknown",
          reason: "Deadline or offered time could not be established",
        };
      }
      return offered <= until
        ? { constraintId: id, status: "pass", reason: `Offered time is before the ${params.until} deadline` }
        : { constraintId: id, status: "fail", reason: `Offered time is after the ${params.until} deadline` };
    }

    case "custom":
    default: {
      const key = constraint.claimKey;
      const value = result ? (result as unknown as Record<string, unknown>)[key] : undefined;
      const expected = params.equals;
      if (value === undefined || value === null) {
        return { constraintId: id, status: "unknown", reason: `Field "${key}" not answered` };
      }
      if (value === "uncertain") {
        return { constraintId: id, status: "unknown", reason: `Field "${key}" answered as uncertain` };
      }
      if (expected !== undefined) {
        return value === expected
          ? { constraintId: id, status: "pass", reason: `"${key}" equals "${expected}"` }
          : { constraintId: id, status: "fail", reason: `"${key}" is "${String(value)}", expected "${expected}"` };
      }
      return { constraintId: id, status: "pass", reason: `"${key}" answered: ${String(value)}` };
    }
  }
}

export function evaluateAll(
  constraints: ConstraintSpec[],
  result: PhoneResult | null,
  candidate?: Pick<Candidate, "distanceKm"> | null,
): ConstraintEvaluation[] {
  return constraints.map((c) => evaluateConstraint(c, result, candidate));
}
