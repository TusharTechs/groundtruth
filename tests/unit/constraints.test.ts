import { describe, expect, it } from "vitest";
import { evaluateConstraint, parseClock, evaluateAll } from "@/lib/verification/constraints";
import type { ConstraintSpec, PhoneResult } from "@/lib/domain/types";
import { emptyPhoneResult } from "../helpers";

function spec(kind: ConstraintSpec["kind"], params: Record<string, unknown> = {}): ConstraintSpec {
  return {
    id: "c1",
    kind,
    label: kind,
    hard: true,
    params,
    question: "q",
    claimKey: "availability",
  };
}

const base: PhoneResult = {
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

describe("parseClock", () => {
  it("parses 12h and 24h times", () => {
    expect(parseClock("5 PM")).toBe(17 * 60);
    expect(parseClock("4:30 PM")).toBe(16 * 60 + 30);
    expect(parseClock("17:00")).toBe(17 * 60);
    expect(parseClock("12 AM")).toBe(0);
    expect(parseClock("nonsense")).toBeNull();
    expect(parseClock(null)).toBeNull();
  });
});

describe("evaluateConstraint", () => {
  it("availability: confirmed passes, not_available fails, uncertain/missing stays unknown", () => {
    expect(evaluateConstraint(spec("availability"), { ...base, availability: "confirmed" }).status).toBe("pass");
    expect(evaluateConstraint(spec("availability"), { ...base, availability: "not_available" }).status).toBe("fail");
    expect(evaluateConstraint(spec("availability"), { ...base, availability: "uncertain" }).status).toBe("unknown");
    expect(evaluateConstraint(spec("availability"), null).status).toBe("unknown");
  });

  it("compatibility: only explicit confirmed passes", () => {
    expect(evaluateConstraint(spec("compatibility"), { ...base, compatibility: "confirmed" }).status).toBe("pass");
    expect(evaluateConstraint(spec("compatibility"), { ...base, compatibility: "not_compatible" }).status).toBe("fail");
    expect(evaluateConstraint(spec("compatibility"), { ...base, compatibility: "uncertain" }).status).toBe("unknown");
  });

  it("price_max: comparison is deterministic; missing price is unknown", () => {
    expect(evaluateConstraint(spec("price_max", { max: 25000 }), { ...base, price: 22800 }).status).toBe("pass");
    expect(evaluateConstraint(spec("price_max", { max: 25000 }), { ...base, price: 27500 }).status).toBe("fail");
    expect(evaluateConstraint(spec("price_max", { max: 25000 }), base).status).toBe("unknown");
  });

  it("quantity_min", () => {
    expect(evaluateConstraint(spec("quantity_min", { min: 1 }), { ...base, quantity: 2 }).status).toBe("pass");
    expect(evaluateConstraint(spec("quantity_min", { min: 2 }), { ...base, quantity: 1 }).status).toBe("fail");
  });

  it("distance_max uses candidate data, not the call", () => {
    expect(
      evaluateConstraint(spec("distance_max", { max: 25 }), base, { distanceKm: 18.4 }).status,
    ).toBe("pass");
    expect(
      evaluateConstraint(spec("distance_max", { max: 25 }), base, { distanceKm: 30 }).status,
    ).toBe("fail");
    expect(evaluateConstraint(spec("distance_max", { max: 25 }), base, { distanceKm: null }).status).toBe("unknown");
  });

  it("hold_until: confirmed passes; possible-but-unconfirmed is unknown; impossible fails", () => {
    expect(
      evaluateConstraint(spec("hold_until"), { ...base, hold_confirmed: true, hold_until: "5 PM" }).status,
    ).toBe("pass");
    expect(
      evaluateConstraint(spec("hold_until"), { ...base, hold_available: true, hold_confirmed: false }).status,
    ).toBe("unknown");
    expect(evaluateConstraint(spec("hold_until"), { ...base, hold_available: false }).status).toBe("fail");
  });

  it("deadline compares offered time to the configured deadline", () => {
    expect(
      evaluateConstraint(spec("deadline", { until: "5 PM" }), { ...base, pickup_time: "4:30 PM" }).status,
    ).toBe("pass");
    expect(
      evaluateConstraint(spec("deadline", { until: "5 PM" }), { ...base, pickup_time: "6:00 PM" }).status,
    ).toBe("fail");
  });

  it("never converts a missing field into a pass", () => {
    const result = evaluateAll([spec("availability"), spec("price_max", { max: 100 })], emptyPhoneResult());
    expect(result.every((r) => r.status === "unknown")).toBe(true);
  });
});
