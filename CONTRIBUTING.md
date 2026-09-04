# Contributing to GroundTruth

Thanks for helping improve an evidence-backed verification system. The rules
here exist to keep the two things that make this project trustworthy:
deterministic behavior and honest results.

## Setup

```bash
pnpm install
cp .env.example .env.local   # demo defaults work out of the box
pnpm dev
```

## Before every pull request

```bash
pnpm lint          # 0 errors
pnpm typecheck
pnpm test          # unit + integration
pnpm build
pnpm test:e2e      # builds and runs the Playwright flows
```

All five must pass. Tests are not optional: the claim lifecycle, the side-
effect gate, and the honest-failure behavior are enforced by tests on purpose.

## Ground rules

1. **UNKNOWN never becomes VERIFIED.** If a change could promote a hedged or
   unevidenced answer to verified, it is a bug — add a test that proves it
   cannot happen.
2. **No purchase path.** GroundTruth is question-only. Any feature that buys,
   pays, commits, or handles credentials is out of scope for this repo.
3. **No secrets.** `.env.local` stays uncommitted; API keys and tokens never
   appear in logs (they are redacted in structured logging) or fixtures.
4. **Fictional data in the demo.** Supplier names, numbers, and transcripts
   in `lib/demo/scenarios.ts` are invented; keep it that way.
5. **Mock mode stays labeled.** The mock adapter must remain visibly DEMO
   MODE everywhere and must never be presented as real CALL-E output.
6. **Conventional commits** (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`,
   `chore:`) on the `feat/groundtruth-verification` branch or later feature
   branches.

## Project layout quick reference

See [docs/architecture.md](docs/architecture.md) for the module map and the
tick state machine, and [docs/call-e-integration.md](docs/call-e-integration.md)
before touching anything under `lib/calle/`.

## Agent Skill changes

The contribution package lives in `skills/groundtruth-verification/`. Changes
there must follow the target repository's conventions
([CALLE-AI/awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents)):
skill folder template (`SKILL.md` + `references/` + `scripts/`), fictional
phone numbers, explicit side effects and cancellation behavior, dry-run by
default, no secrets, and repository-facing content in English.
