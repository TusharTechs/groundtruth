import type { ConstraintSpec, VerificationGoal } from "@/lib/domain/types";

/**
 * Binding between a GroundTruth constraint set and a PUBLISHED CALL-E Goal.
 *
 * A published Goal is CALL-E's reusable, version-pinned call spec: it owns
 * its own `inputSchema` (the variables each run supplies) and `resultSchema`
 * (the fields the run is guaranteed to return). Running one is a different
 * contract from composing an ad-hoc call task — the questions are the Goal's,
 * not ours.
 *
 * That creates a failure mode ad-hoc calls do not have: a Goal can be
 * perfectly healthy and still be structurally incapable of answering a hard
 * constraint, because its result schema has no field for it. Dialing anyway
 * would burn a real phone call to a real human and return a constraint that
 * can only ever be UNKNOWN.
 *
 * So GroundTruth type-checks the Goal against the constraint set BEFORE it
 * dials, and refuses an incompatible pairing. This is the same rule the rest
 * of the system runs on — never claim a verification the evidence cannot
 * support — pushed one step earlier, to before the call exists.
 */

/** The subset of a published Goal this module needs. Mirrors SDK `Goal`. */
export interface PublishedGoalSpec {
  id: string;
  title: string | null;
  description: string;
  publishedRunSpec: {
    id: string;
    version: number;
    inputSchema: Record<string, unknown>;
    resultSchema: Record<string, unknown>;
  };
}

/**
 * Result fields each constraint kind needs a Goal to declare. The first
 * present field wins; a constraint with none of them is unanswerable.
 */
const REQUIRED_RESULT_FIELDS: Record<string, string[]> = {
  availability: ["availability", "in_stock", "stock_status"],
  compatibility: ["compatibility", "compatible", "fits"],
  price_max: ["price", "quoted_price", "total_price"],
  quantity_min: ["quantity", "units_available", "stock_count"],
  pickup_today: ["pickup_available", "pickup_today", "can_pickup"],
  hold_until: ["hold_confirmed", "hold_available", "will_hold"],
  deadline: ["pickup_time", "ready_time", "lead_time"],
};

/**
 * Constraint kinds that are settled from candidate data, not from the call.
 * A Goal is never required to answer these.
 */
const NON_PHONE_KINDS = new Set(["distance_max"]);

export interface FieldBinding {
  constraintId: string;
  kind: string;
  /** The Goal result field this constraint will read. */
  resultField: string;
}

export interface GoalCompatibility {
  compatible: boolean;
  goalId: string;
  runSpecVersion: number;
  /** Constraints this Goal can answer, and the field each will read. */
  bindings: FieldBinding[];
  /** Constraints no declared result field can answer. */
  unanswerable: Array<{ constraintId: string; kind: string; label: string; lookedFor: string[] }>;
  /** Goal input variables we can populate from the goal + candidate. */
  boundVariables: string[];
  /** Required input variables we cannot populate. */
  missingVariables: string[];
  /** Human-readable summary for the audit log and the UI. */
  summary: string;
}

/** Read `properties` off a JSON-Schema-ish object, tolerating loose shapes. */
function schemaProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const props = schema?.properties;
  return props && typeof props === "object" ? (props as Record<string, unknown>) : {};
}

/** Read `required` off a JSON-Schema-ish object. */
function schemaRequired(schema: Record<string, unknown>): string[] {
  const req = schema?.required;
  return Array.isArray(req) ? req.filter((r): r is string => typeof r === "string") : [];
}

/**
 * Can this published Goal answer this constraint set?
 *
 * Pure and offline — no network, no credentials. Call it before every Goal
 * run and record the result in the audit log.
 */
export function checkGoalCompatibility(
  goalSpec: PublishedGoalSpec,
  constraints: ConstraintSpec[],
  availableVariables: Record<string, string | number | boolean>,
): GoalCompatibility {
  const resultFields = new Set(Object.keys(schemaProperties(goalSpec.publishedRunSpec.resultSchema)));
  const inputProps = schemaProperties(goalSpec.publishedRunSpec.inputSchema);
  const requiredInputs = schemaRequired(goalSpec.publishedRunSpec.inputSchema);

  const bindings: FieldBinding[] = [];
  const unanswerable: GoalCompatibility["unanswerable"] = [];

  for (const constraint of constraints) {
    if (NON_PHONE_KINDS.has(constraint.kind)) continue;
    const candidates = REQUIRED_RESULT_FIELDS[constraint.kind] ?? [constraint.claimKey ?? constraint.kind];
    const match = candidates.find((f) => resultFields.has(f));
    if (match) {
      bindings.push({ constraintId: constraint.id, kind: constraint.kind, resultField: match });
    } else {
      unanswerable.push({
        constraintId: constraint.id,
        kind: constraint.kind,
        label: constraint.label,
        lookedFor: candidates,
      });
    }
  }

  const boundVariables = Object.keys(inputProps).filter((v) => availableVariables[v] !== undefined);
  const missingVariables = requiredInputs.filter((v) => availableVariables[v] === undefined);

  const compatible = unanswerable.length === 0 && missingVariables.length === 0;
  const name = goalSpec.title ?? goalSpec.id;
  const summary = compatible
    ? `Goal "${name}" v${goalSpec.publishedRunSpec.version} can answer all ${bindings.length} phone-derived constraint(s).`
    : [
        `Goal "${name}" v${goalSpec.publishedRunSpec.version} is not compatible with this task.`,
        unanswerable.length > 0
          ? `Its result schema declares no field for: ${unanswerable.map((u) => u.label).join(", ")}.`
          : "",
        missingVariables.length > 0
          ? `Required input variable(s) unavailable: ${missingVariables.join(", ")}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

  return {
    compatible,
    goalId: goalSpec.id,
    runSpecVersion: goalSpec.publishedRunSpec.version,
    bindings,
    unanswerable,
    boundVariables,
    missingVariables,
    summary,
  };
}

/**
 * Narrow a variable map to the keys the Goal actually declares. CALL-E
 * validates run variables against the pinned input schema, so an undeclared
 * key is a rejected run rather than a harmless extra.
 */
export function filterToDeclaredVariables(
  goalSpec: PublishedGoalSpec,
  variables: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const declared = new Set(Object.keys(schemaProperties(goalSpec.publishedRunSpec.inputSchema)));
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(variables)) {
    if (declared.has(k) && v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Everything GroundTruth could supply to a Goal, under the conventional
 * names used by the verification Goal family. A Goal declaring a subset gets
 * that subset; a Goal declaring something we cannot supply is refused by
 * checkGoalCompatibility rather than run with a hole in it.
 */
export function availableVariablesFor(
  goal: VerificationGoal,
  candidate: { name: string; distanceKm?: number | null },
): Record<string, string | number | boolean> {
  const vars: Record<string, string | number | boolean> = {
    item: goal.item,
    supplier_name: candidate.name,
  };
  if (goal.targetEquipment) vars.target_equipment = goal.targetEquipment;

  for (const c of goal.hardConstraints) {
    if (c.kind === "price_max" && typeof c.params.max === "number") {
      vars.max_price = c.params.max;
      if (typeof c.params.currency === "string") vars.currency = c.params.currency;
    }
    if (c.kind === "quantity_min" && typeof c.params.min === "number") {
      vars.min_quantity = c.params.min;
    }
    if (c.kind === "hold_until" && c.params.until !== undefined) {
      vars.hold_until = String(c.params.until);
    }
    if (c.kind === "deadline" && c.params.by !== undefined) {
      vars.deadline = String(c.params.by);
    }
  }
  if (candidate.distanceKm != null) vars.distance_km = candidate.distanceKm;
  return vars;
}

/**
 * Map a Goal run's flat scalar result onto the PhoneResult field names the
 * constraint evaluator reads, using the bindings established at check time.
 * Unbound fields are left absent so evaluation sees an explicit gap.
 */
export function mapGoalResultToPhoneResult(
  result: Record<string, string | number | boolean>,
  bindings: FieldBinding[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const binding of bindings) {
    const raw = result[binding.resultField];
    if (raw === undefined || raw === null) continue;
    switch (binding.kind) {
      case "availability":
        out.availability = normalizeTriState(raw, "confirmed", "not_available");
        break;
      case "compatibility":
        out.compatibility = normalizeTriState(raw, "confirmed", "not_compatible");
        break;
      case "price_max":
        if (typeof raw === "number") out.price = raw;
        else if (typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Number(raw.replace(/[^\d.]/g, "")))) {
          out.price = Number(raw.replace(/[^\d.]/g, ""));
        }
        break;
      case "quantity_min":
        if (typeof raw === "number") out.quantity = Math.trunc(raw);
        else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) out.quantity = Number(raw.trim());
        break;
      case "pickup_today":
        out.pickup_available = toBool(raw);
        break;
      case "hold_until":
        out.hold_confirmed = toBool(raw);
        if (binding.resultField === "hold_available") {
          out.hold_available = toBool(raw);
          delete out.hold_confirmed;
        }
        break;
      case "deadline":
        out.pickup_time = String(raw);
        break;
      default:
        break;
    }
  }
  // Carry a currency and free-text notes through when the Goal declares them.
  if (typeof result.currency === "string") out.currency = result.currency;
  if (typeof result.notes === "string") out.notes = result.notes;
  if (typeof result.hold_until === "string") out.hold_until = result.hold_until;
  if (typeof result.pickup_time === "string") out.pickup_time = result.pickup_time;
  return out;
}

/**
 * Goals are encouraged to use string enums with an explicit `unknown` member
 * rather than booleans, precisely so a hedged answer survives extraction.
 * Anything that is not clearly positive or clearly negative becomes
 * "uncertain" — which GroundTruth treats as an unresolved constraint, never
 * as a pass.
 */
function normalizeTriState(
  raw: string | number | boolean,
  positive: string,
  negative: string,
): string {
  if (typeof raw === "boolean") return raw ? positive : negative;
  const v = String(raw).trim().toLowerCase();
  if (["yes", "true", "confirmed", "available", "in_stock", "compatible", positive].includes(v)) {
    return positive;
  }
  if (
    ["no", "false", "not_available", "unavailable", "out_of_stock", "not_compatible", "incompatible", negative].includes(v)
  ) {
    return negative;
  }
  return "uncertain";
}

function toBool(raw: string | number | boolean): boolean | null {
  if (typeof raw === "boolean") return raw;
  const v = String(raw).trim().toLowerCase();
  if (["yes", "true", "confirmed", "1"].includes(v)) return true;
  if (["no", "false", "declined", "0"].includes(v)) return false;
  return null;
}
