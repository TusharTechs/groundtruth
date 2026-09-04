# GroundTruth

**"When the internet isn't enough, ask the people who know."**

GroundTruth is an agentic verification engine: it lets AI call the real world
to verify facts, resolve uncertainty, and complete phone-dependent tasks —
returning evidence-backed structured results instead of guesses.

Built for the **CALL-E — Your Code Is Calling** hackathon. CALL-E is the
phone execution layer; GroundTruth is the constraint-solving verification
system around it. Submitted to
[CALLE-AI/awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents)
as a reusable Agent Skill under
[`skills/groundtruth-verification/`](skills/groundtruth-verification/).

---

## 1. What is GroundTruth?

AI can search websites and databases, but many operational facts exist only
with a human answering a phone:

- *Is this part actually in stock?* — the website says "call for availability".
- *Is the exact revision compatible?* — only the counter person knows the
  XZ-420B does not fit the HVAC-200.
- *Can the supplier hold it until 5 PM?* — needs a manager's OK, live.

GroundTruth turns such a request into **hard constraints**, calls candidates
through **CALL-E**, adapts its questions to what each supplier actually says,
and returns **claims with evidence** — each verified claim linked to the CALL-E
call, the supplier's own words, and a confidence score.

It is **not** an AI phone caller with a memory. It is a constraint-solving
verification system whose phone work is delegated to CALL-E.

## 2. Why this problem matters

A failed 40-minute drive to a supplier that "showed" stock on a stale listing
is a real cost: a technician idle, a repair postponed, a customer waiting.
Emergency procurement under time pressure runs on phone calls today, done by
the most expensive person available, one call at a time, with no record of
what was promised. GroundTruth compresses an afternoon of calling into one
orchestrated, auditable run — and refuses to fabricate success when the
answer is "no match under your constraints".

## 3. Why phone calls are necessary

Because the ground truth is not written down. Stock quantities change hourly,
compatibility knowledge lives in people's heads, and holds are personal
favors between businesses. No API, scraping run, or LLM trained on last
year's web can tell you whether *this* store has *this* part *right now* and
will keep it at the front desk until 5 PM. A phone call can.

## 4. Why CALL-E is essential

CALL-E is a genuine runtime dependency — the system places no call without
it:

- **Goal-driven conversation**: GroundTruth composes questions; CALL-E runs
  the live conversation, handles pickup/voicemail/hold/transfers/IVR, and
  adapts to what the human says.
- **Structured results**: GroundTruth passes a strict `resultSchema`; CALL-E
  returns schema-validated data plus transcript, summary, evidence strings,
  and `completionConfidence`.
- **Ops surface**: idempotency keys, per-call status, developer events, and
  terminal webhooks (`call.completed` / `call.failed` /
  `call.result_validation_failed`).

Integration uses the official TypeScript SDK `@call-e/calle@0.7.0`
(`CalleClient.calls.create/get`), the `POST /v1/calls` contract with
`Idempotency-Key`, and the documented terminal webhook payload. See
[docs/call-e-integration.md](docs/call-e-integration.md).

## 5. Architecture

```
USER GOAL -> CONSTRAINTS -> CANDIDATES -> PHONE CALLS -> CLAIMS
          -> EVIDENCE -> VERIFICATION -> DECISION
```

```
app/                    Next.js UI + route handlers (tasks, tick loop, webhook)
lib/agent/              planner (goal -> call plan), strategist (adaptive
                        follow-up/next/stop), resolver (orchestrator + tick)
lib/ai/                 goal analyzer: deterministic heuristic (default) or
                        optional OpenAI-compatible LLM (fail-closed)
lib/calle/              CALL-E adapter seam: real SDK adapter + deterministic
                        mock adapter (DEMO MODE), result schemas, client factory
lib/verification/       constraints (deterministic evaluation), claims
                        (lifecycle), evidence, confidence, decision
lib/safety/             authorization gates, side-effect phrase scanner,
                        PII redaction
lib/discovery/          CandidateProvider interface + demo/manual/web providers
lib/demo/               deterministic supplier personas + scenarios
lib/db/                 Drizzle PostgreSQL schema + in-memory store behind one
                        interface (DATABASE_URL switches backend)
skills/                 the reusable Agent Skill contribution
```

Full details: [docs/architecture.md](docs/architecture.md).

## 6. Features

- **Goal understanding** with a visible understanding step: goal, hard
  requirements (with the exact phone question each maps to), preferences, and
  authorized vs. prohibited actions.
- **Multi-call orchestration** with candidate prioritization (distance,
  provider order), per-candidate call budgets, and early stopping.
- **Adaptive questioning** — a second call is generated because the first
  answer left a constraint UNKNOWN ("hold possible but needs manager
  approval" → automatic follow-up → hold confirmed until 5 PM).
- **Claims + evidence as first-class objects** — `unknown`, `verified`,
  `contradicted`, `failed`, `expired` lifecycle; evidence = structured result
  + transcript excerpt + call ID + confidence. Hedges never verify.
- **Deterministic constraint evaluation** — price ≤ ceiling, distance ≤
  radius, compatibility confirmed, hold confirmed. No LLM in the loop.
- **Honest failure** — `NO FULLY VERIFIED MATCH` with per-candidate reasons.
- **Safety by construction** — orchestration-layer authorization, negation-
  aware side-effect phrase gate, PII redaction, masked numbers, audit log.
- **DEMO MODE** — a deterministic mock CALL-E with scripted supplier personas
  (success and failure narratives), clearly labeled, never pretending to be
  real.

## 7. Quick start

```bash
pnpm install
cp .env.example .env.local       # defaults are fine for demo mode
pnpm dev                         # http://localhost:3000
```

Open the app, click **Verify Reality**, pick a demo scenario, analyze, start.
The dashboard streams the calls, the claims light up as evidence lands, and
the decision banner appears with the verified winner — or the honest failure.

## 8. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MOCK_CALL_E` | no (default `true`) | `true` = deterministic mock CALL-E, UI labeled DEMO MODE |
| `CALLE_API_KEY` | only for real mode | CALL-E API key (server-only; never exposed to the client) |
| `CALLE_BASE_URL` | no | Defaults to `https://api.heycall-e.com` |
| `DATABASE_URL` | no | PostgreSQL (Neon/Supabase/local). Absent ⇒ in-memory store |
| `WEBHOOK_TOKEN` | real mode | Shared token in the registered webhook URL |
| `APP_ORIGIN` | real mode | Public origin used to build the webhook URL |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | no | Optional goal analyzer upgrade; fails closed to the heuristic |
| `REDACT_PII` | no (default `true`) | PII redaction before persistence/display |

## 9. Mock mode

`MOCK_CALL_E=true` (the default) swaps the CALL-E adapter for a deterministic
simulator: six fictional suppliers with scripted conversations covering the
whole outcome space (sold out, incompatible revision, over budget, "I think
we have it", no answer, and the winner with an adaptive hold follow-up).
Every poll advances the call one stage, so the dashboard streams realistically
and the narrative is identical on every run. Mock mode is always labeled
**DEMO MODE** in the UI and logs; it never contacts CALL-E and never pretends
to be real. Two scenarios ship: the flagship success path and the honest
failure path.

## 10. Real CALL-E mode

Set `MOCK_CALL_E=false` and `CALLE_API_KEY=...` (plus `WEBHOOK_TOKEN` and
`APP_ORIGIN` for webhook-driven completion). Each verification call is then a
real CALL-E call created through `CalleClient.calls.create` with an
idempotency key, the strict result schema, and the composed, safety-checked
task text. Terminal results arrive via the webhook (or the poll loop), and
structured logging marks every CALL-E interaction:
`[CALL-E] CALL CREATED ...`, `[CALL-E] CALL COMPLETED ...`,
`[CALL-E] RESULT RECEIVED ...`. Judges can see exactly where CALL-E is used:
`lib/calle/adapter.ts` (SDK calls), `app/api/webhook/calle/route.ts`
(webhook), and the audit log entries `CALLE_CALL_*`.

## 11. Safety model

Question-only verification enforced structurally: authorization validated at
goal creation, per-action checks at plan time, a negation-aware
prohibited-phrase gate on the exact text handed to CALL-E, PII redaction
before storage/display, masked phone numbers, an action ledger for created
and blocked actions, and an audit log of every significant step. GroundTruth
never purchases, pays, accepts offers, or handles credentials.
[docs/threat-model.md](docs/threat-model.md) covers the assumptions and
residual risks.

## 12. Evidence model

A claim is verified only when the deterministic evaluation passes, the CALL-E
completion confidence is sufficient, and evidence is attached: the validated
structured result plus the supplier's own words from the transcript. Verified
claims are immutable; contradictions are recorded, never erased. Confidence
is CALL-E's completion confidence propagated through the weakest verified
constraint of the winner. See
[skills/groundtruth-verification/references/evidence-model.md](skills/groundtruth-verification/references/evidence-model.md).

## 13. Demo instructions

The deterministic 3-minute demo (works offline, DEMO MODE):

1. **Landing** (`/`) — the one-line pitch and the core loop.
2. **Verify Reality** (`/verify`) — flagship request pre-filled; Analyze shows
   *UNDERSTANDING YOUR REQUEST*: goal, hard requirements with their phone
   questions, preferences, and authorized vs. prohibited actions.
3. **Start verification** → live dashboard: calls stream in (dialing →
   transcript → structured result), claims verify one by one, the strategist
   fires the adaptive hold follow-up at Metro Components, and early stopping
   leaves two suppliers uncontacted once every hard requirement is verified.
4. **Click a claim chip** — the evidence modal: verified claim, source,
   CALL-E call ID, confidence, the supplier's quoted words.
5. **Decision banner** — REALITY VERIFIED: XZ-420, Metro Components, ₹22,800,
   hold until 5 PM, high confidence, "Why this result?".
6. **Failure path** — re-run with the *honest failure* scenario: six calls,
   every candidate fails a hard requirement, `NO FULLY VERIFIED MATCH` with
   the full breakdown. No fake success.

Real CALL-E demo: set the env vars in §10, run the same flow with a real
supplier list, and watch `[CALL-E]` logs plus the webhook receiver.

## 14. Contribution instructions

The reusable Agent Skill lives in
[`skills/groundtruth-verification/`](skills/groundtruth-verification/)
(`SKILL.md` + `references/` + `scripts/`), packaged for
[awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents)
contribution: fictional phone numbers only, dry-run/mock by default, side
effects and cancellation documented, no secrets. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the validation workflow.

## Development

```bash
pnpm lint          # eslint (0 errors)
pnpm typecheck     # tsc --noEmit
pnpm test          # 51 unit + integration tests (vitest)
pnpm build         # production build
pnpm test:e2e      # 2 Playwright e2e flows against the production build
pnpm db:push       # apply the Drizzle schema when DATABASE_URL is set
```

## Known limitations

- In-memory store (no `DATABASE_URL`) resets on restart and is single-process.
- The tick loop assumes one server process; horizontal scaling needs the
  Postgres store plus a job runner for `tick`.
- `WebCandidateProvider` is an architecture stub — discovery is demo/manual
  by design so the demo never depends on unpredictable search results.
- The webhook token is a shared secret in the URL; current CALL-E deliveries
  are unsigned (the SDK deprecates its signature helpers), so this is the
  strongest available transport auth today.
- Mock mode scripts conversations; real-mode conversation quality is CALL-E's
  to deliver.

## License

MIT — see [LICENSE](LICENSE).
