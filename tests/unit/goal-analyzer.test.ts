import { describe, expect, it } from "vitest";
import { HeuristicGoalAnalyzer } from "@/lib/ai/heuristic-analyzer";
import { validateAuthorization } from "@/lib/safety/authorization";
import { FLAGSHIP_REQUEST } from "@/lib/demo/scenarios";

describe("HeuristicGoalAnalyzer (deterministic)", () => {
  const analyzer = new HeuristicGoalAnalyzer();

  it("extracts the flagship goal: item, equipment, distance, price, hold", async () => {
    const { goal, analyzer: kind } = await analyzer.analyze(FLAGSHIP_REQUEST);
    expect(kind).toBe("heuristic");
    expect(goal.item).toMatch(/XZ-420/i);
    expect(goal.item).toMatch(/compressor/i);
    expect(goal.targetEquipment).toMatch(/HVAC-200/);
    const kinds = goal.hardConstraints.map((c) => c.kind).sort();
    expect(kinds).toContain("distance_max");
    expect(kinds).toContain("price_max");
    expect(kinds).toContain("availability");
    expect(kinds).toContain("compatibility");
    expect(kinds).toContain("hold_until");
    const distance = goal.hardConstraints.find((c) => c.kind === "distance_max")!;
    expect(distance.params.max).toBe(25);
    const price = goal.hardConstraints.find((c) => c.kind === "price_max")!;
    expect(price.params.max).toBe(25000);
  });

  it("authorizes hold only when the user allows it, always prohibits purchase", async () => {
    const { goal } = await analyzer.analyze(FLAGSHIP_REQUEST);
    expect(goal.authorization.allowed).toContain("request_hold");
    expect(validateAuthorization(goal.authorization)).toHaveLength(0);
    expect(goal.authorization.prohibited).toContain("purchase");
  });

  it("same input always produces the same constraint set (determinism)", async () => {
    const a = await analyzer.analyze(FLAGSHIP_REQUEST);
    const b = await analyzer.analyze(FLAGSHIP_REQUEST);
    const stripIds = (g: Awaited<ReturnType<typeof analyzer.analyze>>["goal"]) =>
      JSON.stringify({
        ...g,
        hardConstraints: g.hardConstraints.map((c) => ({ ...c, id: "" })),
        softPreferences: g.softPreferences.map((c) => ({ ...c, id: "" })),
      });
    expect(stripIds(a.goal)).toBe(stripIds(b.goal));
  });

  it("does not leave a dangling preposition on the item name", async () => {
    // Regression: the item is spoken aloud ("do you have a {item} in
    // stock?"), and the capture greedily took the following preposition —
    // "XZ-420 compressor for" reached both the UI and the phone script.
    const { goal } = await analyzer.analyze(FLAGSHIP_REQUEST);
    expect(goal.item).toBe("XZ-420 compressor");
    expect(goal.item).not.toMatch(/\s(for|with|in|at|to|from|of|and|the)$/i);
    for (const constraint of goal.hardConstraints) {
      expect(constraint.question).not.toMatch(/compressor for\b(?!\s+pickup)/i);
    }
  });

  it("trims trailing prepositions across phrasings", async () => {
    const cases = [
      "Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km.",
      "Find a genuine XR-5000 valve with an ACME unit nearby.",
      "Source a AB-120 pump in Bengaluru today.",
    ];
    for (const input of cases) {
      const { goal } = await analyzer.analyze(input);
      expect(goal.item).not.toMatch(/\s(for|with|in|at|to|from|of|and|the)$/i);
    }
  });

  it("never allows purchase even when the request mentions buying", async () => {
    const { goal } = await analyzer.analyze(
      "Find an XZ-420 compressor today and buy it if the price is under ₹25000.",
    );
    expect(goal.authorization.prohibited).toContain("purchase");
    expect(goal.authorization.allowed).not.toContain("purchase");
  });
});
