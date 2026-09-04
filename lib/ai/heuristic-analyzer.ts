import { randomUUID } from "node:crypto";
import type {
  ConstraintSpec,
  GoalAnalysis,
  VerificationGoal,
} from "@/lib/domain/types";
import { DEFAULT_AUTHORIZATION, type PermittedAction } from "@/lib/domain/types";
import type { GoalAnalyzer } from "@/lib/ai/provider";

/**
 * Deterministic heuristic goal analyzer. No LLM, no network: the same input
 * always produces the same structured goal, which is what makes the demo
 * scenario reproducible. Handles the flagship procurement pattern and its
 * common variations (service availability, order status, delivery checks).
 */

function constraint(
  partial: Omit<ConstraintSpec, "id"> & { id?: string },
): ConstraintSpec {
  return { id: partial.id ?? `c_${randomUUID().slice(0, 8)}`, ...partial };
}

export class HeuristicGoalAnalyzer implements GoalAnalyzer {
  async analyze(input: string): Promise<GoalAnalysis> {
    const text = input.trim();
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);

    const hard: ConstraintSpec[] = [];
    const soft: ConstraintSpec[] = [];
    const allowed = new Set<PermittedAction>(DEFAULT_AUTHORIZATION.allowed);

    // --- item ---------------------------------------------------------------
    // Matches model-code-first items like "XZ-420 compressor" or "XR-5000
    // valve assembly"; falls back to the first noun phrase after "find/get".
    let item = "the requested item";
    const itemMatch =
      text.match(/\b(?:genuine|original|OEM)\s+([A-Z][A-Z0-9]{1,7}[-\s]?\d{2,5}[A-Za-z]*\s+[a-z][\w-]*(?:\s+[a-z][\w-]*)?)/) ??
        text.match(/\b([A-Z][A-Z0-9]{1,7}[-\s]?\d{2,5}[A-Za-z]*\s+[a-z][\w-]*(?:\s+[a-z][\w-]*)?)/);
    if (itemMatch) {
      item = itemMatch[1].trim();
    } else {
      const findMatch = text.match(/\b(?:find|get|source|locate)\s+(?:a\s+|an\s+|the\s+)?([\w][\w\s-]{3,40})/i);
      if (findMatch) item = findMatch[1].trim();
    }

    // --- target equipment ---------------------------------------------------
    let targetEquipment: string | undefined;
    const equipMatch = text.match(/\bfor (?:an?|the) ([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,2})/);
    if (equipMatch) targetEquipment = equipMatch[1].trim();

    // --- distance -----------------------------------------------------------
    const distanceMatch = text.match(/within\s+(\d+(?:\.\d+)?)\s*km/i);
    const distanceKm = distanceMatch ? Number(distanceMatch[1]) : null;
    if (distanceKm !== null) {
      hard.push(
        constraint({
          kind: "distance_max",
          label: `Within ${distanceKm} km`,
          hard: true,
          params: { max: distanceKm },
          question: `Are you located within ${distanceKm} km of the city centre?`,
          claimKey: "distance",
        }),
      );
    }

    // --- price ---------------------------------------------------------------
    const priceMatch = text.match(/(?:under|below|less than|up to|max(?:imum)?(?: of)?|budget of)\s*[₹$€]?\s*([\d,]+)/i);
    let currency = "INR";
    if (priceMatch) {
      const symbol = text.match(/(?:under|below|less than|up to|max(?:imum)?(?: of)?|budget of)\s*([₹$€])/i)?.[1];
      if (symbol === "$") currency = "USD";
      if (symbol === "€") currency = "EUR";
      const max = Number(priceMatch[1].replace(/,/g, ""));
      hard.push(
        constraint({
          kind: "price_max",
          label: `Price under ${currency} ${max.toLocaleString("en-IN")}`,
          hard: true,
          params: { max, currency },
          question: `What is your best price for the ${item}, including taxes?`,
          claimKey: "price",
        }),
      );
    }

    // --- availability + today -------------------------------------------------
    const wantsAvailability = /available|in stock|have|stock/i.test(text);
    const wantsToday = /today|same[- ]day|before \d|by \d{1,2}\s?[AP]M|this evening/i.test(text);
    if (wantsAvailability) {
      hard.push(
        constraint({
          kind: "availability",
          label: `In stock now (${item})`,
          hard: true,
          params: {},
          question: `Do you currently have a genuine ${item} in stock?`,
          claimKey: "availability",
        }),
      );
    }
    if (wantsToday) {
      hard.push(
        constraint({
          kind: "pickup_today",
          label: "Available for pickup today",
          hard: true,
          params: {},
          question: "Could I pick it up today if it suits?",
          claimKey: "pickup_available",
        }),
      );
      allowed.add("request_pickup_window");
    }

    // --- compatibility ---------------------------------------------------------
    if (/compatib/i.test(text) && targetEquipment) {
      hard.push(
        constraint({
          kind: "compatibility",
          label: `Compatible with ${targetEquipment}`,
          hard: true,
          params: { equipment: targetEquipment },
          question: `Can you confirm the ${item} is compatible with the ${targetEquipment}? Please check the model compatibility if you are unsure.`,
          claimKey: "compatibility",
        }),
      );
    }

    // --- quantity -----------------------------------------------------------------
    const qtyMatch = text.match(/\b(?:at least|minimum of|min\s)?(\d+)\s*(?:units?|pieces?|pcs)\b/i);
    if (qtyMatch) {
      const min = Number(qtyMatch[1]);
      hard.push(
        constraint({
          kind: "quantity_min",
          label: `At least ${min} unit${min > 1 ? "s" : ""}`,
          hard: true,
          params: { min },
          question: `How many ${item} units do you have in stock right now?`,
          claimKey: "quantity",
        }),
      );
    }

    // --- hold ------------------------------------------------------------------
    const holdMatch = text.match(/hold[^.]*?(?:until|till)\s+(\d{1,2}(?::\d{2})?\s*[APap][Mm]\b)/i);
    const holdAllowedByUser = /(?:you may|allowed to|can|please)\s+(?:request\s+)?(?:a\s+)?hold|request a hold|hold it/i.test(text);
    if (holdMatch) {
      const until = holdMatch[1].replace(/\s+/g, " ").toUpperCase().replace(" ", "");
      if (holdAllowedByUser) {
        allowed.add("request_hold");
      }
      hard.push(
        constraint({
          kind: "hold_until",
          label: `Hold until ${until}`,
          hard: true,
          params: { until },
          question: `Could you hold one ${item} until ${until} for pickup? To be clear, we will not purchase during this call — I am only asking you to reserve it.`,
          claimKey: "hold_confirmed",
        }),
      );
    }

    // --- purchase prohibition is ALWAYS on -----------------------------------
    const authorization = {
      allowed: [...allowed],
      prohibited: DEFAULT_AUTHORIZATION.prohibited,
      note: /do not purchase|no purchas|don'?t buy/i.test(text)
        ? "User explicitly prohibited purchases."
        : undefined,
    };

    // --- deadline / geography ---------------------------------------------------
    const deadline = holdMatch?.[1] ?? (text.match(/before (\d{1,2}(?::\d{2})?\s*[APap][Mm]\b)/i)?.[1] ?? undefined);
    const geography = distanceKm !== null ? `within ${distanceKm} km` : undefined;

    const objective = sentences[0] ?? `Verify: ${item}`;

    // Soft preferences: closer is better, cheaper is better (rank-only).
    if (distanceKm !== null) {
      soft.push(
        constraint({
          kind: "distance_max",
          label: "Prefer closer supplier",
          hard: false,
          params: { max: distanceKm },
          question: "",
          claimKey: "distance",
        }),
      );
    }
    if (priceMatch) {
      soft.push(
        constraint({
          kind: "price_max",
          label: "Prefer lower price",
          hard: false,
          params: { max: Number(priceMatch[1].replace(/,/g, "")) },
          question: "",
          claimKey: "price",
        }),
      );
    }

    const goal: VerificationGoal = {
      objective,
      item,
      targetEquipment,
      hardConstraints: hard,
      softPreferences: soft,
      deadline: deadline?.replace(/\s+/g, "").toUpperCase(),
      geography,
      authorization,
      successCriteria: `Every hard requirement verified with an evidence-backed phone claim${holdMatch ? ", including the requested hold (no purchase)" : ""}.`,
    };

    return { goal, analyzer: "heuristic" };
  }
}
