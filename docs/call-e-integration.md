# CALL-E Integration

How GroundTruth uses CALL-E, verified against the current official sources
during development (Phase 0):

- Integrations repo: <https://github.com/CALLE-AI/call-e-integrations>
- SDK: `@call-e/calle` on npm — pinned here at **0.7.0**
- Docs: <https://docs.heycall-e.com/>

No CALL-E method in this codebase is invented; everything below is from the
SDK's TypeScript definitions (`dist/calls.d.ts`, `dist/client.d.ts`,
`dist/webhooks.d.ts`, `dist/generated/schema.d.ts`) and the official README.

## SDK surface in use

```ts
import { CalleClient } from "@call-e/calle";

const client = new CalleClient({ apiKey, baseUrl });   // lib/calle/client.ts

// Create (lib/calle/adapter.ts — RealCalleAdapter.createCall)
const call = await client.calls.create(
  {
    task,                       // composed, safety-checked task text
    recipient: { phone, region, locale },
    resultSchema,               // strict PhoneResult JSON schema
    metadata,                   // { taskId, candidateId, purpose, attempt, ... }
    webhookUrl,                 // when WEBHOOK_TOKEN + APP_ORIGIN are set
  },
  { idempotencyKey },           // taskId+candidateId+purpose+attempt derived
);

// Poll (same file — RealCalleAdapter.getCallState)
const call = await client.calls.get(callId);
// call.status, call.taskCompleted, call.completionConfidence.score,
// call.structuredResult, call.evidence, call.summary,
// call.recipients[0].structuredResult, call.recipients[0].attempts[0].transcriptTurns
```

Notes that come straight from the SDK/API docs and shaped the design:

- `CallStatus` is `queued | in_progress | completed | failed | canceled`;
  `in_progress` includes post-call result finalization, so terminal states
  carry the structured result — the poll loop can be the only completion
  path when no webhook is configured.
- Recipient-level results: `recipients[0].structuredResult` is preferred over
  the task-level `structuredResult` (batch shape) — GroundTruth reads the
  recipient first and falls back.
- `completionConfidence: { score, label }` — the score feeds the claim
  confidence model (claims below 0.5 cannot verify).
- `evidence: string[]` — CALL-E's own evidence strings; GroundTruth attaches
  them when the transcript has no supporting turns.
- Transcripts: `recipients[i].attempts[j].transcriptTurns` with
  `{ offset_seconds, speaker: bot|user|unknown, text }`; `unknown` speakers
  are preserved, and human turns are PII-redacted before storage.

## REST contract equivalents

The SDK wraps these endpoints (see the integrations README):

| Method | Path | Used for |
| --- | --- | --- |
| `POST` | `/v1/calls` | Create one-recipient call tasks (with `Idempotency-Key`) |
| `GET` | `/v1/calls/{call_id}` | Poll status + terminal result |
| `GET` | `/v1/calls/{call_id}/events` | Available via `client.calls.listEvents` (not used yet; future UI enrichment) |
| `GET` | `/v1/goals/{goal_id}` | Published Goal + pinned RunSpec schemas |
| `POST` | `/v1/goals/{goal_id}/runs` | One Goal run per candidate (with `Idempotency-Key`) |
| `GET` | `/v1/goals/{goal_id}/runs/{goal_run_id}` | Poll a Goal run to terminal |
| `POST` | `/calle/webhook` | Terminal-result delivery to GroundTruth's receiver |

## Webhooks (app/api/webhook/calle)

- Event types handled: `call.completed`, `call.failed`,
  `call.result_validation_failed` (the documented terminal set).
- Payload: `{ id, type, created_at, data: <terminal CallTask snapshot> }` —
  the same stable shape as the GET response, so the webhook and the poll path
  share one processing function (`onCallTerminal`).
- Authentication: current deliveries are **unsigned** — the SDK's
  `CalleWebhooks.verify/unwrap` are explicitly deprecated for this reason —
  so GroundTruth authenticates with a shared token embedded in the registered
  webhook URL (`/api/webhook/calle?token=...`). Wrong/missing token → 401.
- Idempotency: the event `id` is inserted into a unique ledger
  (`webhook_events.event_id`) before processing; duplicates are acknowledged
  2xx but never processed twice. A terminal-state guard prevents double
  processing when the poll loop already recorded completion.
- Acknowledgement: `{ ok: true }` with 2xx (CALL-E treats any 2xx as
  delivered and ignores the body).

## Structured result schema

Every GroundTruth call passes a strict `resultSchema` (see
[`skills/groundtruth-verification/references/evidence-model.md`](../skills/groundtruth-verification/references/evidence-model.md))
with enums for judgments (`confirmed | not_available | uncertain`, ...),
numbers for prices/quantities, booleans for yes/no facts, and a `notes`
catch-all that never substitutes for a structured field. Results are
re-validated server-side (`normalizePhoneResult`) with null-filling so
evaluation sees explicit gaps.

## Where CALL-E is visible (for judges)

1. `lib/calle/adapter.ts` — the real adapter: `client.calls.create` and
   `client.calls.get`, idempotency keys, webhook URL registration.
2. `lib/calle/client.ts` — `CalleClient` construction, mode resolution,
   structured `[CALL-E]` logging (`CALL CREATED`, `CALL COMPLETED`,
   `RESULT RECEIVED`, `WEBHOOK RECEIVED`), secret redaction.
3. `app/api/webhook/calle/route.ts` — the terminal webhook receiver.
4. `lib/calle/schemas.ts` — the result-schema contract.
5. `lib/calle/goal-adapter.ts` — the published-Goal adapter:
   `client.goals.get`, `client.goals.run`, `client.goals.getRun`.
6. `lib/calle/goal-binding.ts` — the pre-flight compatibility check between a
   Goal's published `resultSchema` and the task's hard constraints.
7. The audit log records `CALLE_CALL_CREATED` / `CALLE_CALL_COMPLETED` /
   `CALLE_CALL_FAILED` / `GOAL_INCOMPATIBLE` per run, and every verified claim
   displays its CALL-E call ID in the evidence UI.

## Mode resolution

Three execution paths behind one `CalleAdapter` interface
(`lib/calle/adapter-index.ts`):

| Condition | Adapter | SDK surface |
| --- | --- | --- |
| `MOCK_CALL_E=true` (default) | `MockCalleAdapter` | none — deterministic, offline, labeled DEMO MODE |
| `CALLE_API_KEY` + `CALLE_GOAL_ID` | `GoalCalleAdapter` | `client.goals.get/run/getRun` |
| `CALLE_API_KEY` only | `RealCalleAdapter` | `client.calls.create/get` |

Real mode without a key fails loudly at the factory — it never silently falls
back to mock. Changing `CALLE_GOAL_ID` invalidates the cached Goal spec.

## Published Goals (second execution path)

`client.calls.create` composes a call task per candidate. `client.goals.run`
executes a **published, version-pinned Goal** that CALL-E already owns —
its own `inputSchema`, its own `resultSchema`, its own questions. GroundTruth
supplies only a phone number, run variables and an idempotency key.

Set `CALLE_GOAL_ID` (with `MOCK_CALL_E=false` and `CALLE_API_KEY`) and the
adapter factory returns `GoalCalleAdapter` instead of `RealCalleAdapter`. The
orchestrator is untouched — both implement the same `CalleAdapter` seam.

```ts
// lib/calle/goal-adapter.ts
const goal = await client.goals.get(goalId);          // publishedRunSpec pinned
const run  = await client.goals.run({                 // one run per candidate
  goalId, phone, variables, idempotencyKey,
});
const state = await client.goals.getRun(goalId, run.id);
```

### Why a verification agent cannot just run any Goal

A Goal can be perfectly healthy and still be **structurally incapable** of
answering a hard constraint, because its result schema declares no field for
it. Dialing anyway burns a real call to a real human and returns a constraint
that can only ever be UNKNOWN.

So `lib/calle/goal-binding.ts` type-checks the Goal against the constraint set
*before* the run is created:

| Check | Failure |
| --- | --- |
| Every phone-derived constraint binds to a declared result field | `unanswerable` |
| Every required input variable can be supplied | `missingVariables` |

An incompatible pairing raises `GoalIncompatibleError`, the task is failed with
a `GOAL_INCOMPATIBLE` audit entry, and **no call is placed**. This is the
project's core rule — never claim a verification the evidence cannot support —
moved one step earlier, to before the call exists.

Field binding is family-based, so a Goal may name things its own way:

```
availability   <- availability | in_stock | stock_status
compatibility  <- compatibility | compatible | fits
price_max      <- price | quoted_price | total_price
quantity_min   <- quantity | units_available | stock_count
pickup_today   <- pickup_available | pickup_today | can_pickup
hold_until     <- hold_confirmed | hold_available | will_hold
deadline       <- pickup_time | ready_time | lead_time
distance_max   <- (never required: settled from candidate data)
```

### Honest limitation of the Goal path

A Goal run exposes **no transcript turns** — only the validated flat result,
`callId`, and a typed `error`. Claims produced this way therefore carry
structured-result evidence and the correlated call id, but no verbatim quote.
`mapGoalRun` says so in the evidence string rather than implying a quote
exists. The ad-hoc call path remains the one that produces supplier quotes.

### Typed run errors

`GoalRunError.code` is a closed enum, so failure handling branches on data
instead of prose: `no_answer`, `call_failed`, `declined`, `timed_out`,
`canceled` are call-level (the candidate is unreachable); `result_invalid`,
`result_unavailable`, `result_failed` mean the call happened but produced no
usable result.

A `completed` run can briefly carry neither `result` nor `error` while CALL-E
parses. `mapGoalRun` treats that as still in progress rather than as an empty
success.
