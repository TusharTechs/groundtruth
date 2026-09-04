# Architecture

## The product abstraction

```
USER GOAL -> CONSTRAINTS -> CANDIDATES -> PHONE CALLS -> CLAIMS
          -> EVIDENCE -> VERIFICATION -> DECISION
```

The key differentiator: **claims and evidence are first-class objects**, not
prose summaries. Everything downstream of a phone call is typed, evaluated
deterministically, and auditable.

## Module map

| Module | Path | Responsibility |
| --- | --- | --- |
| Domain model | `lib/domain/types.ts` | Zod schemas for every object: task, goal, constraints, candidates, calls, claims, evidence, decisions, audit |
| Goal analyzer | `lib/ai/heuristic-analyzer.ts`, `lib/ai/llm-analyzer.ts` | NL goal → `VerificationGoal`. Heuristic is deterministic and default; the optional LLM analyzer is fail-closed to it |
| Planner | `lib/agent/planner.ts` | Goal → call plan: per-constraint questions + fallbacks, opening disclosure, stopping rules; composes and safety-checks call task text |
| Discovery | `lib/discovery/` | `CandidateProvider` interface; demo (deterministic), manual, and web (stub) providers; candidate ranking/capping |
| CALL-E executor | `lib/calle/adapter.ts`, `lib/calle/client.ts`, `lib/calle/mock-adapter.ts` | `CalleAdapter` seam. `RealCalleAdapter` = official `@call-e/calle` SDK; `MockCalleAdapter` = deterministic DEMO MODE simulator |
| Orchestrator | `lib/agent/resolver.ts` | The tick state machine: create/poll calls, adaptive strategy, claim extraction, evidence attachment, evaluation, decision, finalization |
| Strategist | `lib/agent/strategist.ts` | Pure functions deciding follow_up / next_candidate / stop from the current state |
| Verification | `lib/verification/` | Constraint evaluation (pure functions), claim lifecycle, evidence builder, confidence model, decision engine |
| Safety | `lib/safety/` | Authorization checks, side-effect phrase gate, PII redaction |
| Persistence | `lib/db/` | `GroundTruthStore` interface; `MemoryStore` (default) and `PostgresStore` (Drizzle); factory by `DATABASE_URL` |
| API | `app/api/` | Tasks CRUD + tick, start, webhook, candidates, demo meta, settings |
| UI | `app/page.tsx`, `app/verify/`, `app/tasks/[id]/`, `components/task-dashboard.tsx` | Landing, task builder + goal review, live dashboard with evidence UI |

## Request lifecycle (demo mode)

1. `POST /api/tasks` — the heuristic analyzer extracts the goal; the safety
   layer validates authorization; the planner builds the call plan; the demo
   provider discovers six ranked candidates. Everything persists.
2. `POST /api/tasks/:id/start` — status → `running`.
3. `POST /api/tasks/:id/tick` (dashboard poll, ~1.2 s) — one state-machine
   step:
   - in-flight call? → poll the adapter → update transcript/status → events;
   - terminal result? → extract claims + evidence → evaluate constraints →
     strategist decides (follow_up / next_candidate / stop);
   - nothing in flight and work remains → compose + create the next call
     through the adapter (after the side-effect gate);
   - stop → evaluate all candidates → build the decision → status
     `completed`.
4. `GET /api/tasks/:id` — full `TaskSnapshot` (task, candidates, calls,
   events, claims, evidence, evaluations, decision, audit) for the UI.

Real mode is identical except the adapter is `RealCalleAdapter` and terminal
results can also arrive via `POST /api/webhook/calle`, which routes through
the same `onCallTerminal` the poll path uses — two ingestion routes, one
state machine.

## The tick state machine

```
        ┌──────────── running ────────────┐
        │                                  │
  call in flight? ── yes ──> poll adapter │
        │                    │             │
        no             terminal? ── no ──┐ │
        │                    │          │ │
  candidates pending?   yes: extract   │ │
        │                + evaluate    │ │
        yes ──> create next call <─────┘ │
        │                + adapt         │
        no ──> finalize (decision) <─────┘
```

Per-process tick locks (`ticking` set) make concurrent dashboard polls
idempotent. The idempotency key (`taskId + candidateId + purpose + attempt`)
prevents double-dialing across retries.

## Data model (PostgreSQL)

Eleven tables — `users`, `verification_tasks`, `constraints`, `candidates`,
`calls`, `call_events`, `claims`, `evidence`, `decisions`, `actions`,
`audit_logs`, plus the `webhook_events` idempotency ledger. UUID PKs,
`createdAt`/`updatedAt` on mutable tables, indexes on task/status lookups,
and a unique index on `calls.calle_call_id` for webhook → call resolution.
Rich nested objects (goal, plan, results, transcripts) are typed jsonb;
queryable fields are normalized columns.

The in-memory store implements the same interface — local demos and the test
suite run with zero infrastructure, and `DATABASE_URL` switches backends
without code changes.

## Design decisions

- **Deterministic heuristic analyzer by default.** LLM extraction is
  non-deterministic and can fail; the demo must be identical on every run,
  and authorization must never depend on a model. The optional LLM analyzer
  re-validates its output with the same schema and safety rules and falls
  back on any problem.
- **One adapter seam.** Everything above `CalleAdapter` is identical for mock
  and real; mode is a factory decision, visible in the UI and logs.
- **Two ingestion routes, one terminal handler.** Poll and webhook both call
  `onCallTerminal`, so duplicate delivery (webhook + poll racing) is safe:
  the webhook checks terminal state before processing, and the event ledger
  deduplicates by event id.
- **Evaluations are derived, claims are stored.** Constraint evaluations are
  recomputed from stored results on every snapshot (cheap, pure), while
  claims/evidence are append-only records — no dual-write inconsistency.
- **No LLM in the verification loop.** Constraint evaluation is pure
  functions; CALL-E owns conversation understanding. This keeps verification
  deterministic, testable, and independent of any model provider.

## Deployment

- **Vercel**: Next.js app as-is; set the env vars from `.env.example`.
- **Database**: Neon or Supabase PostgreSQL via `DATABASE_URL`; apply the
  schema with `pnpm db:push` (Drizzle).
- **Webhook**: set `APP_ORIGIN` to the deployment URL; the registered webhook
  is `/api/webhook/calle?token=$WEBHOOK_TOKEN`.
- Note: the tick loop is driven by the open dashboard (or any poller). For
  unattended runs, add a scheduled job calling
  `POST /api/tasks/:id/tick` — no code change needed.
