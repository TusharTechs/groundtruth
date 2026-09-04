/**
 * PII redaction. Applied BEFORE persistence and UI display.
 * - Phone numbers are masked (last 2-3 digits visible) in the UI.
 * - Full E.164 numbers never appear in evidence excerpts or transcripts
 *   that are rendered to the operator.
 * - Card-like digit sequences, OTP-like sequences, emails, and secrets are
 *   redacted from all stored text.
 */

const E164 = /(\+?\d[\d\s().-]{7,16}\d)/g;
const CARD_LIKE = /\b(?:\d[ -]?){13,19}\b/g;
const OTP_LIKE = /\b\d{4,8}\b(?=\s|$|[.,])/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const SECRET_LIKE = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|calle_(?:live|test)_\w+)\b/g;

/** Mask a phone number for display: +918047110001 -> +91 •••• ••01 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "••••";
  const cc = phone.trim().startsWith("+") ? `+${digits.slice(0, 2)}` : "";
  return `${cc} •••• ••${digits.slice(-2)}`;
}

/** Redact sensitive patterns from free text (evidence, notes, logs). */
export function redactText(text: string): string {
  return text
    .replace(SECRET_LIKE, "[redacted:secret]")
    .replace(CARD_LIKE, "[redacted:card]")
    .replace(EMAIL, "[redacted:email]")
    .replace(E164, (m) => maskPhone(m))
    .replace(OTP_LIKE, "[redacted:code]");
}

/**
 * Redact a full transcript before persistence. Bot turns written by
 * GroundTruth are safe; user (human callee) turns may contain anything.
 */
export function redactTranscript<T extends { speaker: string; text: string }>(
  turns: T[],
): T[] {
  return turns.map((t) =>
    t.speaker === "user" ? { ...t, text: redactText(t.text) } : t,
  );
}

export function piiRedactionEnabled(): boolean {
  return (process.env.REDACT_PII ?? "true").toLowerCase() !== "false";
}
