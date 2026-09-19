---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0002, 0005, 0014]
supersedes: null
superseded_by: null
---

# ADR-0004: Local-first development; no hosted infrastructure until later milestones

## Context

AD-004 states initial milestones "run completely from the developer laptop" and must not
require Vercel deployment, production queues, hosted Workflow execution, hosted Sandbox
execution, or automated GitHub PR creation. Supabase "runs locally through the Supabase CLI/
Docker initially. No hosted infrastructure is required." The Recommended Build Order (§15)
places hosted Vercel Workflow and Sandbox adapters at steps 18-19, after seventeen local steps,
and Milestone 11's goal explicitly says to add hosted primitives "only after the local
architecture works." North-Star Invariant #15 states: "Local development remains a first-class
path."

## Decision

Milestones M0 through M10 MUST be fully runnable, testable, and demonstrable on a developer
laptop with no dependency on hosted Vercel infrastructure, a hosted database, production queues,
or automated GitHub write access. Local Supabase, run via the Supabase CLI and Docker
(`pnpm supabase:start`, `pnpm supabase:stop`, `pnpm supabase:reset`, `pnpm supabase:types` per
M2-T11), is the only persistence dependency during this period. Hosted Vercel Workflow execution
and hosted Vercel Sandbox execution MUST NOT be required until Milestone 11 introduces the
corresponding adapters, and even then the local interpreter/process-execution paths MUST remain
available for development and tests (M11 acceptance criteria: "Local tests do not require Vercel
infrastructure"). Automated GitHub PR creation MUST NOT be built into harness core at any point
in this plan; see ADR-0006 and build plan §11.

## Consequences

### Positive

- Low-friction onboarding: a fresh clone, `pnpm install`, and `pnpm check` succeed without cloud
  credentials (Milestone 0 acceptance criteria).
- The learning/replay/compiler loop (Milestones 6-9) can be developed and tested entirely against
  local fixtures and a local database, satisfying North-Star Invariant #15.

### Negative

- The local deterministic workflow runtime built in Milestone 4 is a genuine second
  implementation of workflow execution semantics that must later be reconciled with the hosted
  Vercel Workflow adapter in Milestone 11 (parity is an explicit M11 acceptance criterion).
- Some production concerns (queueing, hosted durability, hosted sandboxing) are deliberately
  deferred and will need dedicated verification work once Milestone 11 begins.

### Neutral

- Constrains Milestone 2 (local Supabase run ledger via CLI/Docker), Milestone 4 (local
  deterministic runtime as the pre-hosted execution primitive), Milestone 9 (local simulation of
  shadow/canary stages "over fixture batches rather than production traffic"), and Milestone 11
  (first milestone allowed to introduce hosted infrastructure).
- Directly grounds `packages/storage-supabase` and the `supabase/` directory's local-only scope
  through M10.

## Alternatives considered

- **Build against hosted Supabase/Workflow/Sandbox from the start**: rejected; the Recommended
  Build Order (§15) sequences hosted primitives to steps 18-19, after the local system is
  proven, and AD-004 explicitly forbids requiring hosted infrastructure in early milestones.

## References

- `docs/milestones/build-plan.md` §1 AD-004, §15 Recommended Build Order, §17 Invariant #15,
  Milestone 2 (M2-T11), Milestone 4, Milestone 11
- Related ADRs: 0002, 0005, 0014
- Related code paths: `packages/storage-supabase`, `supabase/`
