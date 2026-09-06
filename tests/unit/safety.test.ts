import { describe, expect, it } from "vitest";
import {
  assertActionAllowed,
  AuthorizationError,
  validateAuthorization,
  questionsOnlyAuthorization,
  actionForConstraintKind,
} from "@/lib/safety/authorization";
import { checkCallTaskSafety, assertCallTaskSafe } from "@/lib/safety/side-effects";
import { maskPhone, redactText, redactOperatorText, redactTranscript } from "@/lib/safety/pii";

describe("authorization", () => {
  const auth = questionsOnlyAuthorization(["request_hold"]);

  it("allows actions in the allowed set", () => {
    expect(() => assertActionAllowed(auth, "request_hold")).not.toThrow();
    expect(() => assertActionAllowed(auth, "request_pricing")).not.toThrow();
  });

  it("throws for actions not in the allowed set", () => {
    // request_hold removed
    const strict = questionsOnlyAuthorization();
    expect(() => assertActionAllowed(strict, "request_hold")).toThrow(AuthorizationError);
  });

  it("validateAuthorization rejects goals that forget prohibitions", () => {
    const broken = {
      allowed: ["ask_question" as const],
      prohibited: ["purchase" as const],
    };
    expect(validateAuthorization(broken).length).toBeGreaterThan(0);
    expect(validateAuthorization(questionsOnlyAuthorization())).toHaveLength(0);
  });

  it("maps constraint kinds to question-only actions", () => {
    expect(actionForConstraintKind("hold_until")).toBe("request_hold");
    expect(actionForConstraintKind("price_max")).toBe("request_pricing");
    expect(actionForConstraintKind("custom")).toBe("ask_question");
  });
});

describe("side-effect gate", () => {
  it("blocks purchase/payment phrases in call task text", () => {
    const check = checkCallTaskSafety("Call the supplier and purchase the compressor with a card.");
    expect(check.ok).toBe(false);
    expect(check.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("allows pure verification scripts", () => {
    const safe =
      "Call the supplier and ask whether the XZ-420 is in stock and its price. Do not purchase anything.";
    expect(checkCallTaskSafety(safe).ok).toBe(true);
    expect(() => assertCallTaskSafe(safe)).not.toThrow();
  });

  it("blocks credential disclosure phrases", () => {
    expect(checkCallTaskSafety("Please share the one-time code on the card.").ok).toBe(false);
  });
});

describe("demo candidate safety", () => {
  it("refuses to hand out demo personas in real mode", async () => {
    const { DemoCandidateProvider } = await import("@/lib/discovery/providers");
    const prev = { mock: process.env.MOCK_CALL_E, key: process.env.CALLE_API_KEY };
    process.env.MOCK_CALL_E = "false";
    process.env.CALLE_API_KEY = "iams_test_notreal";
    try {
      // Fictional but well-formed numbers: dialling them for real reaches a
      // stranger, so real runs must supply candidates explicitly.
      await expect(
        new DemoCandidateProvider().search({} as never, { scenarioId: "compressor" }),
      ).rejects.toThrow(/mock-mode only/i);
    } finally {
      process.env.MOCK_CALL_E = prev.mock;
      if (prev.key === undefined) delete process.env.CALLE_API_KEY;
      else process.env.CALLE_API_KEY = prev.key;
    }
  });

  it("still returns personas in mock mode", async () => {
    const { DemoCandidateProvider } = await import("@/lib/discovery/providers");
    process.env.MOCK_CALL_E = "true";
    delete process.env.CALLE_API_KEY;
    const found = await new DemoCandidateProvider().search({} as never, { scenarioId: "compressor" });
    expect(found.length).toBeGreaterThan(0);
  });
});

describe("PII redaction", () => {
  it("masks phone numbers for display", () => {
    const masked = maskPhone("+918047110001");
    expect(masked).toContain("••");
    expect(masked).not.toContain("8047110001");
  });

  it("redacts emails, cards, codes, and secrets from text", () => {
    const text = "Mail me at owner@metro.in, card 4111 1111 1111 1111, code 4821, key sk-abc123456";
    const red = redactText(text);
    expect(red).not.toContain("owner@metro.in");
    expect(red).not.toContain("4111");
    expect(red).not.toContain("4821");
    expect(red).not.toContain("sk-abc123456");
  });

  it("redacts real CALL-E API keys, not just the SDK's example prefix", () => {
    // Production keys use the iams_live_ prefix (docs.heycall-e.com);
    // the original pattern only matched the calle_* form from SDK examples,
    // so a real key would have passed straight through into stored text.
    for (const key of ["iams_live_9f2b7c1d4e8a6f3b", "iams_test_abc12345", "calle_live_xyz98765"]) {
      const red = redactText(`the key is ${key} do not log it`);
      expect(red).not.toContain(key);
      expect(red).toContain("[redacted:secret]");
    }
  });

  it("does not redact ordinary snake_case words as secrets", () => {
    expect(redactText("the hold_until field is set")).toContain("hold_until");
  });

  it("strips context-flagged digits too short to look like a card", () => {
    // "card ending 4242" is four digits: below the card-like threshold, but
    // sensitive because of the word next to it.
    const red = redactText("Pay with my card ending 4242 on pickup.");
    expect(red).not.toContain("4242");
    expect(red).toContain("[redacted:card]");
  });

  it("redactOperatorText removes credentials without eating prices or times", () => {
    const red = redactOperatorText(
      "Find an XZ-420 under 25000, hold until 1700, card ending 4242, mail me at buyer@acme.in",
    );
    // Removed.
    expect(red).not.toContain("4242");
    expect(red).not.toContain("buyer@acme.in");
    // Preserved: the operator's own numbers are the task.
    expect(red).toContain("25000");
    expect(red).toContain("1700");
    expect(red).toContain("XZ-420");
  });

  it("redacts only human (callee) turns in transcripts", () => {
    const turns = [
      { speaker: "bot", text: "Calling +918047110001 about stock." },
      { speaker: "user", text: "Sure, my email is x@y.com and the code is 9911." },
    ];
    const red = redactTranscript(turns);
    expect(red[0].text).toContain("+918047110001");
    expect(red[1].text).not.toContain("x@y.com");
    expect(red[1].text).not.toContain("9911");
  });
});
