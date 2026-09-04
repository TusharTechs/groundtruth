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
/**
 * Credential shapes. CALL-E production keys use the `iams_live_` prefix
 * (docs.heycall-e.com/authentication); `calle_*` is kept because the SDK's
 * own examples use it, and a bare `iams_`/`calle_` catch-all covers other
 * environment prefixes rather than leaking a key we failed to predict.
 */
const SECRET_LIKE =
  /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:iams|calle)_[A-Za-z0-9]+_[A-Za-z0-9_-]{4,})\b/g;
/**
 * Digits that are sensitive because of the word next to them ("card ending
 * 4242", "OTP 1234"). Too short to trip CARD_LIKE, too dangerous to keep.
 */
const CONTEXTUAL_SENSITIVE =
  /\b(card|cvv|cvc|otp|pin|passcode|account|aadhaar|aadhar|ssn|pan)\b([^.\n]{0,24}?)\b(\d{3,})\b/gi;

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
    .replace(CONTEXTUAL_SENSITIVE, (_m, word, gap) => `${word}${gap}[redacted:${String(word).toLowerCase()}]`)
    .replace(EMAIL, "[redacted:email]")
    .replace(E164, (m) => maskPhone(m))
    .replace(OTP_LIKE, "[redacted:code]");
}

/**
 * Redaction for text the OPERATOR wrote (the raw request and the derived
 * objective), applied after goal analysis and before persistence.
 *
 * Deliberately narrower than redactText: the operator's own words carry
 * prices, quantities and deadlines ("under 25000", "hold until 1700") that
 * the generic 4-8 digit OTP rule would destroy. Only credentials, card-like
 * runs, emails and context-flagged digits are removed.
 */
export function redactOperatorText(text: string): string {
  return text
    .replace(SECRET_LIKE, "[redacted:secret]")
    .replace(CARD_LIKE, "[redacted:card]")
    .replace(CONTEXTUAL_SENSITIVE, (_m, word, gap) => `${word}${gap}[redacted:${String(word).toLowerCase()}]`)
    .replace(EMAIL, "[redacted:email]");
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
