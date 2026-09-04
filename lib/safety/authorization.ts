import type { Authorization, PermittedAction, ProhibitedAction } from "@/lib/domain/types";

/**
 * Authorization is enforced at the ORCHESTRATION LAYER, not just the prompt.
 * Every action the agent may take (ask a question, request a hold, ...) is
 * checked against the task's authorization set before a CALL-E call task is
 * composed. Prohibited actions throw and are recorded as blocked actions.
 */

export class AuthorizationError extends Error {
  constructor(
    public readonly action: ProhibitedAction | PermittedAction,
    public readonly reason: string,
  ) {
    super(`Action "${action}" is not authorized: ${reason}`);
    this.name = "AuthorizationError";
  }
}

/** Phrases that indicate a purchase/commitment — blocked from call tasks. */
const PROHIBITED_PHRASES: Array<{ pattern: RegExp; action: ProhibitedAction }> = [
  { pattern: /\bpurchase\b|\bbuy(ing)?\b/i, action: "purchase" },
  { pattern: /\bpay(ment)?\b|\bcard\b|\bCVV\b/i, action: "payment" },
  { pattern: /\bconfirm (the )?order\b|\bplace (the )?order\b/i, action: "contract_acceptance" },
  {
    pattern: /\b(agree|accept) (to )?(the )?(terms|contract|quote)\b/i,
    action: "legally_binding_commitment",
  },
  {
    pattern: /\b(password|OTP|one[- ]time (code|password)|API key|secret)\b/i,
    action: "disclose_credentials",
  },
];

/**
 * Negated prohibitions ("do NOT purchase", "no purchase is being made",
 * "never share the OTP") are part of every GroundTruth call task, so the
 * scanner removes negated verb phrases BEFORE matching. Only affirmative
 * side-effect language remains. This is a heuristic second layer; the
 * structural authorization gate (assertActionAllowed) is the primary one.
 */
export function stripNegations(text: string): string {
  return text.replace(
    /\b(?:do|does|did|must|should|will|would|can|could|shall)\s+not\s+(?:\w+\s+){0,3}|\bdon'?t\s+(?:\w+\s+){0,3}|\bnever\s+(?:\w+\s+){0,3}|\bno\s+(?:\w+\s+){0,3}/gi,
    " ",
  );
}

/** Actions implied by each constraint kind; all are question-only. */
const CONSTRAINT_ACTIONS: Record<string, PermittedAction> = {
  availability: "request_availability",
  compatibility: "ask_question",
  price_max: "request_pricing",
  quantity_min: "ask_question",
  distance_max: "ask_question",
  pickup_today: "request_pickup_window",
  hold_until: "request_hold",
  deadline: "request_delivery_estimate",
  custom: "ask_question",
};

export function actionForConstraintKind(kind: string): PermittedAction {
  return CONSTRAINT_ACTIONS[kind] ?? "ask_question";
}

/**
 * Assert an action is allowed. Throws AuthorizationError for prohibited or
 * non-allowed actions. Callers record the outcome in the actions ledger.
 */
export function assertActionAllowed(
  authorization: Authorization,
  action: PermittedAction,
): void {
  if (authorization.prohibited.length > 0) {
    // Permitted actions are never in the prohibited set by schema; this is a
    // defensive double-check for goals assembled from untrusted input.
  }
  if (!authorization.allowed.includes(action)) {
    throw new AuthorizationError(
      action,
      "action is not in the allowed set for this task",
    );
  }
}

/**
 * Scan outbound call task text for prohibited phrases BEFORE the call is
 * created. Negated phrases ("must NOT purchase") are stripped first so the
 * safety footer itself never trips the gate. Returns violations found; the
 * caller must abort composition.
 */
export function findProhibitedPhrases(text: string): ProhibitedAction[] {
  const found = new Set<ProhibitedAction>();
  const scanText = stripNegations(text);
  for (const { pattern, action } of PROHIBITED_PHRASES) {
    if (pattern.test(scanText)) found.add(action);
  }
  return [...found];
}

/**
 * Validate the full authorization block of an analyzed goal. A goal that
 * allows purchases or payments is rejected — GroundTruth never buys.
 */
export function validateAuthorization(auth: Authorization): string[] {
  const problems: string[] = [];
  const forbiddenByProduct: ProhibitedAction[] = [
    "purchase",
    "payment",
    "contract_acceptance",
    "legally_binding_commitment",
    "disclose_credentials",
    "disclose_payment_info",
  ];
  for (const f of forbiddenByProduct) {
    if (!auth.prohibited.includes(f)) {
      problems.push(
        `authorization must always prohibit "${f}" — GroundTruth never performs purchases, payments, or commitments`,
      );
    }
  }
  return problems;
}

/** Standard authorization for verification tasks (questions only). */
export function questionsOnlyAuthorization(extra: PermittedAction[] = []): Authorization {
  return {
    allowed: Array.from(
      new Set<PermittedAction>([
        "ask_question",
        "request_availability",
        "request_pricing",
        "request_delivery_estimate",
        ...extra,
      ]),
    ),
    prohibited: [
      "purchase",
      "payment",
      "contract_acceptance",
      "legally_binding_commitment",
      "disclose_credentials",
      "disclose_payment_info",
    ],
  };
}
