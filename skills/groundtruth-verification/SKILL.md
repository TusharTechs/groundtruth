---
name: groundtruth-verification
description: Run evidence-backed real-world verification by phone. Turn a fuzzy operational goal ("find a compatible part available today, held until 5 PM, under budget") into hard constraints, verify them with CALL-E phone calls that adapt to what each supplier actually says, and return claims with call-linked evidence — never promoting "probably" to verified. Use when an agent must confirm a real-world fact that only a human answering a phone knows (stock, compatibility, price, availability, holds, delivery windows), when a purchase or payment must NOT be made, and when the answer needs auditable evidence rather than a guess.
license: MIT
---

# GroundTruth Verification

An evidence-backed real-world verification protocol for phone-work agents.
CALL-E is the phone execution layer; this skill is the orchestration,
verification, and safety discipline around it.

## When to use this skill

Use it when ALL of these hold:

1. **The fact lives with a human, not a database.** Stock counts, exact-part
   compatibility, "can you actually come tomorrow", "is the quoted lead time
   real". Web search cannot settle it; calling can.
2. **The goal has checkable requirements.** You can name what counts as done:
   "compatible AND in stock AND ≤ ₹25,000 AND held until 5 PM".
3. **No commitment is needed.** GroundTruth verification is question-only.
   It may request a temporary hold when explicitly authorized. It never
   purchases, pays, accepts quotes, or reveals credentials.
4. **The answer must be auditable.** Every verified claim links to the CALL-E
   call that produced it, the supplier's own words, and a confidence score.

Do NOT use it for: appointment booking (use a scheduling skill), lead
qualification, surveys, emergencies, medical/legal/financial advice, or any
task whose success requires a transaction on the call.

## How to formulate a verification goal

Write the goal as: objective + item + hard constraints + soft preferences +
authorization.

- **Hard constraints** are gates: a candidate either passes or is rejected.
  Each one must be verifiable by asking a question on a phone call, and each
  maps to one structured-result field. Kinds: `availability`, `compatibility`,
  `price_max`, `quantity_min`, `distance_max`, `pickup_today`, `hold_until`,
  `deadline`, `custom`.
- **Soft preferences** only rank passing candidates (closer is better, cheaper
  is better). They never reject anyone.
- **Authorization** is explicit and structural: allowed actions
  (`ask_question`, `request_availability`, `request_pricing`,
  `request_delivery_estimate`, `request_pickup_window`, and only if the user
  said so, `request_hold`) and the mandatory prohibition list (`purchase`,
  `payment`, `contract_acceptance`, `legally_binding_commitment`,
  `disclose_credentials`, `disclose_payment_info`).

Example goal (the flagship):

```
Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km.
Hard: compatible with HVAC-200; in stock; pickup today; price ≤ ₹25,000;
      supplier holds one unit until 5 PM; distance ≤ 25 km.
Soft: prefer lower price; prefer closer.
Authorization: questions + hold request allowed; purchases prohibited.
```

Read `references/verification-protocol.md` before your first run. It defines
the plan → call → adapt → extract → verify → decide loop step by step.

## Running a verification

### Option A — through the GroundTruth app (recommended)

```bash
# Start the app (demo mode, no credentials needed)
MOCK_CALL_E=true pnpm dev        # or pnpm build && pnpm start

# 1. Submit the goal
curl -s localhost:3000/api/tasks -H 'content-type: application/json' \
  -d '{"input":"Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km. It must be compatible, available today, under ₹25,000, and the supplier must hold it until 5 PM. You may request a hold, but do not purchase anything."}'
# -> { "task": { "id": "...", "goal": { ... hardConstraints, authorization ... } } }

# 2. Start the run, then poll the tick endpoint until task.status = completed
curl -s -X POST localhost:3000/api/tasks/$TASK_ID/start
curl -s -X POST localhost:3000/api/tasks/$TASK_ID/tick   # repeat
# -> { "task", "candidates", "calls", "claims", "evidence", "decision", "audit" }
```

The final `decision` object contains `status` (`success` | `partial` |
`no_match`), the winning candidate, per-candidate reasons, and confidence.
Every verified claim carries `evidenceIds` pointing into the `evidence` array
(call ID, transcript excerpt, completion confidence).

### Option B — direct CALL-E calls following the protocol

If you cannot run the app, follow `references/verification-protocol.md`
against the official `@call-e/calle` SDK directly:

- Compose one call task per candidate with the opening disclosure, the
  per-constraint questions (plus fallback questions for hedged answers), and
  the safety footer. Run the text through the prohibited-phrase check BEFORE
  creating the call.
- Always pass a `resultSchema` (see `references/evidence-model.md`) and an
  idempotency key per logical call.
- Treat `uncertain` as an answer. Re-ask once with the fallback question; if
  the supplier still cannot confirm, the constraint stays UNKNOWN — that is a
  result, not a failure of the process.

## Non-negotiable rules

1. **UNKNOWN never becomes VERIFIED.** "Probably", "I think", "we usually
   have it" are `uncertain`, and an uncertain answer is an unresolved
   constraint. One polite follow-up ("could you check for me?") is allowed;
   after that, move on.
2. **No evidence, no verified claim.** A claim is verified only when the
   structured result AND the supplier's words support it. Store both.
3. **Purchase language never enters a call task.** The side-effect scanner
   blocks purchase/payment/commitment/credential phrases at the orchestration
   layer. The structural prohibition ("we will not purchase") is fine;
   affirmative side-effect language is not.
4. **Stop when done.** Stop early when one candidate satisfies every hard
   constraint (with a follow-up for a pending hold). Stop when no candidate
   remains. Report failure honestly with per-candidate reasons — the failure
   report IS a result.
5. **Mask phone numbers and redact PII** in anything shown or stored beyond
   the working state. Never log API keys, codes, or card-like digit strings.

Read `references/safety.md` before composing your first call task. It is
short, and violating it is the difference between a verification agent and a
prank caller with a budget.

## Verification states

| State        | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `unknown`    | Not asked yet, or the answer was hedged/refused                |
| `pending`    | On a call now, or awaiting a scheduled follow-up               |
| `verified`   | Concrete answer + attached evidence + sufficient confidence    |
| `contradicted` | A later call contradicted an earlier verified claim (recorded, never deleted) |
| `failed`     | Explicitly negative (out of stock, not compatible, cannot hold) |
| `expired`    | Was verified, but past its validity horizon (stock and holds go stale) |

## Stopping rules

Stop when ANY of: a candidate fully verified (preferred), all candidates
exhausted, the call budget (`maxCalls`, default 8; `maxCallsPerCandidate`,
default 2) is spent, or the only remaining unknowns are provably
unresolvable by phone. Continue when: a hard constraint is still unknown AND
a follow-up or another candidate could resolve it. Prefer candidates by
distance to the geography constraint, then by expected match.

## Failure handling

- **No answer / voicemail / hangup**: mark the candidate `unreachable`, move
  to the next candidate. Do not redial the same number in the same run.
- **API failure or timeout**: retry the CALL-E create with the SAME
  idempotency key (never double-dial); after repeated failures, mark the
  candidate unknown and continue.
- **Duplicate webhook deliveries**: deduplicate by webhook event id.
- **Ambiguous final state** (a hold was requested but not confirmed): report
  the candidate as partial with the specific unresolved constraint. Offer the
  operator the honest options: relax a constraint, expand the search, or stop.

## Further reading

- `references/verification-protocol.md` — the full plan → call → adapt →
  extract → verify → decide loop with pseudo-code.
- `references/evidence-model.md` — claims, evidence, confidence, schemas.
- `references/safety.md` — authorization boundaries and prohibited actions.
- `scripts/build-call-task.mjs` — compose a protocol-compliant CALL-E call
  task + result schema from a goal JSON (no dependencies).
