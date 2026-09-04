import { describe, expect, it } from "vitest";
import {
  availableVariablesFor,
  checkGoalCompatibility,
  filterToDeclaredVariables,
  mapGoalResultToPhoneResult,
  type PublishedGoalSpec,
} from "@/lib/calle/goal-binding";
import type { ConstraintSpec, VerificationGoal } from "@/lib/domain/types";
import { questionsOnlyAuthorization } from "@/lib/safety/authorization";

/**
 * The Goal path's central promise: GroundTruth refuses to dial a human with
 * a published Goal that cannot answer the question being asked.
 */

function constraint(kind: string, label: string, params: Record<string, unknown> = {}): ConstraintSpec {
  return {
    id: `c_${kind}`,
    kind: kind as ConstraintSpec["kind"],
    label,
    hard: true,
    params,
    question: `question for ${kind}`,
    claimKey: kind,
  };
}

function goalSpec(resultFields: string[], inputFields: string[], required: string[] = []): PublishedGoalSpec {
  return {
    id: "goal_supplier_verification",
    title: "Supplier stock verification",
    description: "Verify stock, compatibility and price with a supplier.",
    publishedRunSpec: {
      id: "runspec_1",
      version: 3,
      inputSchema: {
        type: "object",
        required,
        properties: Object.fromEntries(inputFields.map((f) => [f, { type: "string" }])),
      },
      resultSchema: {
        type: "object",
        properties: Object.fromEntries(resultFields.map((f) => [f, { type: "string" }])),
      },
    },
  };
}

describe("checkGoalCompatibility", () => {
  it("binds every phone-derived constraint when the Goal declares a field for each", () => {
    const spec = goalSpec(
      ["availability", "compatibility", "price", "pickup_available", "hold_confirmed"],
      ["item", "target_equipment", "max_price", "hold_until"],
    );
    const constraints = [
      constraint("availability", "In stock now"),
      constraint("compatibility", "Compatible with HVAC-200"),
      constraint("price_max", "Price under INR 25,000", { max: 25000 }),
      constraint("pickup_today", "Available for pickup today"),
      constraint("hold_until", "Hold until 5 PM", { until: "5 PM" }),
    ];

    const result = checkGoalCompatibility(spec, constraints, { item: "XZ-420 compressor" });

    expect(result.compatible).toBe(true);
    expect(result.bindings).toHaveLength(5);
    expect(result.unanswerable).toEqual([]);
    expect(result.bindings.find((b) => b.kind === "price_max")?.resultField).toBe("price");
    expect(result.summary).toContain("v3");
  });

  it("refuses a Goal whose result schema cannot answer a hard constraint", () => {
    // A stock-check Goal asked to also confirm a hold: no hold field exists.
    const spec = goalSpec(["availability", "price"], ["item"]);
    const constraints = [
      constraint("availability", "In stock now"),
      constraint("price_max", "Price under INR 25,000", { max: 25000 }),
      constraint("hold_until", "Hold until 5 PM", { until: "5 PM" }),
    ];

    const result = checkGoalCompatibility(spec, constraints, { item: "XZ-420" });

    expect(result.compatible).toBe(false);
    expect(result.unanswerable.map((u) => u.label)).toEqual(["Hold until 5 PM"]);
    expect(result.summary).toContain("Hold until 5 PM");
  });

  it("never requires the Goal to answer a discovery-derived constraint", () => {
    const spec = goalSpec(["availability"], ["item"]);
    const result = checkGoalCompatibility(
      spec,
      [constraint("availability", "In stock now"), constraint("distance_max", "Within 25 km", { max: 25 })],
      { item: "XZ-420" },
    );

    expect(result.compatible).toBe(true);
    expect(result.bindings).toHaveLength(1);
  });

  it("refuses when a required Goal input variable cannot be supplied", () => {
    const spec = goalSpec(["availability"], ["item", "purchase_order_ref"], ["item", "purchase_order_ref"]);
    const result = checkGoalCompatibility(spec, [constraint("availability", "In stock now")], {
      item: "XZ-420",
    });

    expect(result.compatible).toBe(false);
    expect(result.missingVariables).toEqual(["purchase_order_ref"]);
  });

  it("accepts an alternative field name from the same family", () => {
    const spec = goalSpec(["in_stock", "quoted_price"], ["item"]);
    const result = checkGoalCompatibility(
      spec,
      [constraint("availability", "In stock now"), constraint("price_max", "Under budget", { max: 100 })],
      { item: "XZ-420" },
    );

    expect(result.compatible).toBe(true);
    expect(result.bindings.find((b) => b.kind === "availability")?.resultField).toBe("in_stock");
    expect(result.bindings.find((b) => b.kind === "price_max")?.resultField).toBe("quoted_price");
  });
});

describe("filterToDeclaredVariables", () => {
  it("drops variables the Goal does not declare", () => {
    const spec = goalSpec(["availability"], ["item", "max_price"]);
    const filtered = filterToDeclaredVariables(spec, {
      item: "XZ-420",
      max_price: 25000,
      supplier_name: "Metro Components",
    });
    expect(filtered).toEqual({ item: "XZ-420", max_price: 25000 });
  });
});

describe("availableVariablesFor", () => {
  it("derives scalars from the goal's own constraint parameters", () => {
    const goal: VerificationGoal = {
      objective: "Find a compressor",
      item: "XZ-420 compressor",
      targetEquipment: "ACME HVAC-200",
      hardConstraints: [
        constraint("price_max", "Price under INR 25,000", { max: 25000, currency: "INR" }),
        constraint("hold_until", "Hold until 5 PM", { until: "5 PM" }),
      ],
      softPreferences: [],
      authorization: questionsOnlyAuthorization(["request_hold"]),
      successCriteria: "A supplier confirms stock, compatibility, price and hold.",
    };

    const vars = availableVariablesFor(goal, { name: "Metro Components", distanceKm: 18.4 });

    expect(vars).toMatchObject({
      item: "XZ-420 compressor",
      target_equipment: "ACME HVAC-200",
      supplier_name: "Metro Components",
      max_price: 25000,
      currency: "INR",
      hold_until: "5 PM",
      distance_km: 18.4,
    });
  });
});

describe("mapGoalResultToPhoneResult", () => {
  const bindings = [
    { constraintId: "c1", kind: "availability", resultField: "availability" },
    { constraintId: "c2", kind: "compatibility", resultField: "compatibility" },
    { constraintId: "c3", kind: "price_max", resultField: "price" },
    { constraintId: "c4", kind: "hold_until", resultField: "hold_confirmed" },
  ];

  it("maps a confident Goal result onto PhoneResult fields", () => {
    const mapped = mapGoalResultToPhoneResult(
      { availability: "confirmed", compatibility: "yes", price: 22800, hold_confirmed: true, currency: "INR" },
      bindings,
    );
    expect(mapped).toMatchObject({
      availability: "confirmed",
      compatibility: "confirmed",
      price: 22800,
      hold_confirmed: true,
      currency: "INR",
    });
  });

  it("keeps a hedge as uncertain rather than promoting it", () => {
    const mapped = mapGoalResultToPhoneResult(
      { availability: "probably", compatibility: "not_sure" },
      bindings,
    );
    expect(mapped.availability).toBe("uncertain");
    expect(mapped.compatibility).toBe("uncertain");
  });

  it("maps an explicit negative to the failing enum member", () => {
    const mapped = mapGoalResultToPhoneResult(
      { availability: "out_of_stock", compatibility: "incompatible" },
      bindings,
    );
    expect(mapped.availability).toBe("not_available");
    expect(mapped.compatibility).toBe("not_compatible");
  });

  it("leaves unreported fields absent so evaluation sees a gap", () => {
    const mapped = mapGoalResultToPhoneResult({ availability: "confirmed" }, bindings);
    expect(mapped).not.toHaveProperty("price");
    expect(mapped).not.toHaveProperty("hold_confirmed");
  });
});
