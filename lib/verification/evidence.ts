import { randomUUID } from "node:crypto";
import type { CallRecord, Claim, Evidence, TranscriptTurn } from "@/lib/domain/types";

/**
 * Evidence engine. Every verified claim carries at least one evidence record
 * pointing at the CALL-E call that produced it: the structured result, the
 * supplier's own words (transcript excerpt or CALL-E evidence strings), and
 * the call's completion confidence.
 */

const nowIso = () => new Date().toISOString();

/** Keyword anchors used to pull the supporting transcript turn per claim type. */
const TRANSCRIPT_ANCHORS: Record<string, RegExp[]> = {
  availability: [/stock/i, /available/i, /have (it|the|one|two|three|\d)/i, /units?/i],
  compatibility: [/compatib/i, /fits?/i, /works with/i, /model/i, /HVAC/i],
  price: [/price/i, /rupees/i, /₹|rs\.?/i, /\d{4,5}/],
  quantity: [/units?/i, /pieces?/i, /\b(one|two|three|four|five|\d+)\b/i],
  pickup: [/pick ?up/i, /collect/i, /today/i, /come (by|over|down)/i],
  hold: [/hold/i, /reserve/i, /keep it/i, /till|until/i],
};

export function findSupportingTurns(
  type: string,
  turns: TranscriptTurn[],
): TranscriptTurn[] {
  const anchors = TRANSCRIPT_ANCHORS[type] ?? [];
  const human = turns.filter((t) => t.speaker === "user");
  const matched = human.filter((t) => anchors.some((a) => a.test(t.text)));
  return matched.length > 0 ? matched.slice(-2) : human.slice(-1);
}

export interface BuiltEvidence {
  evidence: Evidence;
}

/**
 * Build evidence records for a claim from its call. Two sources:
 *  1. "structured_result" — the schema-validated CALL-E structured result.
 *  2. "calle_transcript"  — the supplier's own words backing the claim.
 * CALL-E top-level evidence strings (call.evidence) are also attached as
 * "calle_call" excerpts when present.
 */
export function buildEvidenceForClaim(claim: Claim, call: CallRecord): Evidence[] {
  const records: Evidence[] = [];
  const at = nowIso();
  const confidence = call.completionConfidence ?? 0.8;

  if (call.result) {
    records.push({
      id: randomUUID(),
      taskId: claim.taskId,
      claimId: claim.id,
      callId: call.id,
      candidateId: claim.candidateId,
      source: "structured_result",
      excerpt: `CALL-E structured result: ${JSON.stringify(call.result)}`,
      confidence,
      capturedAt: at,
    });
  }

  const turns = findSupportingTurns(claim.type, call.transcript);
  for (const turn of turns) {
    records.push({
      id: randomUUID(),
      taskId: claim.taskId,
      claimId: claim.id,
      callId: call.id,
      candidateId: claim.candidateId,
      source: "calle_transcript",
      excerpt: `Supplier said: "${turn.text}"`,
      confidence,
      capturedAt: at,
    });
  }

  if (call.evidence.length > 0 && records.length === 0) {
    for (const excerpt of call.evidence.slice(0, 2)) {
      records.push({
        id: randomUUID(),
        taskId: claim.taskId,
        claimId: claim.id,
        callId: call.id,
        candidateId: claim.candidateId,
        source: "calle_call",
        excerpt,
        confidence,
        capturedAt: at,
      });
    }
  }

  return records;
}

/** Does this claim have at least one concrete evidence record attached? */
export function claimHasEvidence(claim: Claim): boolean {
  return claim.evidenceIds.length > 0;
}
