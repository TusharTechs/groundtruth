import { describe, expect, it } from "vitest";
import {
  assertActionAllowed,
  AuthorizationError,
  validateAuthorization,
  questionsOnlyAuthorization,
  actionForConstraintKind,
} from "@/lib/safety/authorization";
import { checkCallTaskSafety, assertCallTaskSafe } from "@/lib/safety/side-effects";
import { maskPhone, redactText, redactTranscript } from "@/lib/safety/pii";

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
