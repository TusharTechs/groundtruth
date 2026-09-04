import type { JsonObject } from "@call-e/calle";
import { phoneResultSchema, type PhoneResult } from "@/lib/domain/types";

/**
 * CALL-E structured-result contract.
 *
 * Every GroundTruth call asks CALL-E for the same strict JSON shape (the
 * PhoneResult schema). Constraint evaluation reads these fields; "uncertain"
 * is a first-class answer so hedged responses survive end-to-end.
 */

export const PHONE_RESULT_JSON_SCHEMA: JsonObject = {
  type: "object",
  required: ["availability"],
  properties: {
    availability: { type: "string", enum: ["confirmed", "not_available", "uncertain"] },
    quantity: { type: "integer", minimum: 0 },
    compatibility: { type: "string", enum: ["confirmed", "not_compatible", "uncertain"] },
    price: { type: "number", minimum: 0 },
    currency: { type: "string", enum: ["INR", "USD", "EUR"] },
    pickup_available: { type: "boolean" },
    pickup_time: { type: "string" },
    hold_available: { type: "boolean" },
    hold_confirmed: { type: "boolean" },
    hold_until: { type: "string" },
    notes: { type: "string" },
  },
};

/** Strict validation of a CALL-E structured result. Unknown fields rejected. */
export function validatePhoneResult(value: unknown): PhoneResult | null {
  const parsed = phoneResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Null-fill missing optional fields so evaluation sees explicit gaps. */
export function normalizePhoneResult(value: unknown): PhoneResult | null {
  const parsed = phoneResultSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // CALL-E may omit optional fields; fill them before strict re-validation.
  const input = (typeof value === "object" && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const defaults: Record<string, unknown> = {
    currency: "INR",
    quantity: null,
    compatibility: null,
    price: null,
    pickup_available: null,
    pickup_time: null,
    hold_available: null,
    hold_confirmed: null,
    hold_until: null,
    notes: null,
  };
  const merged = { ...defaults, ...input };
  const retry = phoneResultSchema.safeParse(merged);
  return retry.success ? retry.data : null;
}
