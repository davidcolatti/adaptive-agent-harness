# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; frozen milestone
> records live in `docs/progress/milestones/`.

**Last updated:** 2026-09-19 (Milestone 1 complete)
**Current milestone:** M2, Job, Trace, Supabase, and Run Ledger (not started)
**Current task:** M2-T1, Stable identifiers (not started). First, create the M2
status file (see "Exact next task").
**Last commit SHA:** `3d3d941` (M1-T4, T6, T9 and the M1 snapshot). Earlier
M1 commits: `bdb4a23`, `4748a36`, `16e10e8`. Run `git log --oneline`.

## Completed milestones / tasks

- **Milestone 0, Repository Foundation: complete.** `docs/progress/milestones/m0.md`.
- **Milestone 1, Local Agent + Public Harness Boundary: complete.** All nine
  tasks done. Snapshot: `docs/progress/milestones/m1.md`. Status and
  per-criterion evidence: `docs/milestones/m1-local-agent-and-public-harness-boundary.md`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass (2026-09-19, after
  M1). Tests: 371 across 30 files (`unit` + `contract` projects). The contract
  project boots real `eve dev` servers for the fixture app (about 13.5 s).
- **`pnpm example:run:mock`** runs the vendor-triage domain end to end through
  `createHarness()` and `EveAgentRuntime` against a real `eve dev` server with a
  scripted model, credential-free, and exits 0 with a `completed` result.
  Verified three times consecutively. **`pnpm example:run`** is the same path
  against the real example agent and needs `AI_GATEWAY_API_KEY` or
  `VERCEL_OIDC_TOKEN`; it is unverified against a live model.
- Seven workspace packages:
  - `@internal/core` (zero third-party deps; `node:crypto` only): JSON model,
    `ExecutionContext`, `TraceWriter`/`TraceEvent` (M1 placeholder), error
    taxonomy + `serializeError`, `Schema` (Standard Schema) + `validateWith`,
    `Job`, `DomainDefinition` + `defineDomain`, `AgentRuntime` +
    `AgentExecution`, `createHarness` + `HarnessRunResult`, capability
    registry + manifest, `canonicalJson` + `fingerprint`.
  - `@internal/testing`: `createFakeClock`, `createFakeAgentRuntime`,
    `createRecordingTraceWriter`. Depends on core.
  - `@internal/runtime-eve`: `EveAgentRuntime`, `eveVersion`,
    `LOAD_SKILL_TOOL_ID`; `./testing` subpath with `startEveDevServer` and
    `readRecordedDevServerUrl`.
  - `@internal/runtime-ai-sdk`: dependency boundary only (one type re-export).
    The AI SDK runtime implementation is not scheduled by M1; ADR-0003 keeps the
    AI SDK as the lowest contract and eve as the default adapter.
  - `@internal/config`.
  - `apps/example-agent` (`@internal/example-agent`): eve project
    (`defaultTools: false`, tools `lookup_vendor_evidence` + `load_skill`),
    domain (`src/domain/`), capabilities (`src/capabilities.ts`, handler,
    policy), `src/run.ts`.
  - `apps/eve-fixture-agent` (`@internal/eve-fixture-agent`): `mockModel`
    fixture agent with scripted responses for tests and the mock demo.
- Architecture boundary test: adapter-only rule for `packages/*`; `apps/*` may
  depend on `eve`, `ai`, `@ai-sdk/*` (ADR-0025); `@supabase/*`, `@vercel/*`,
  `workflow` adapter-only for everyone. Pin tests per ADR-0024.
- Husky hooks, CI workflow file (never run: no remote).

## What is partially working

- Tool permission enforcement in `EveAgentRuntime` is detection-and-cancel on
  the event stream, not prevention (ADR-0028). Fine for the read-only fixture
  tool; the auth-plus-approval composition is the M2/M5 upgrade.
- `EveAgentRuntime` needs each domain's output schema at construction
  (`domains` option) because a `Job` carries only a string reference. The
  capability registry can resolve it once M2/M5 wires that.

## What does not exist yet

- No persistence (`Storage`, Supabase), no real `TraceEvent` schema or
  buffered writer, no ID scheme (ids are `crypto.randomUUID()`), no redaction,
  no run ledger, no inspector, no Jev, no workflow IR, no replay, evals,
  learner, compiler, CLI.

## Known failures

- None. One intermittent `eve dev` startup failure seen once in about sixteen
  runs before the lifecycle fix; not reproduced after it (M1-T6 WORKLOG
  addendum 18:55).

## Current blockers

- None for M2-T1..T4. M2-T5 onward need a local Supabase; see M2-T11.
- No GitHub remote: CI unobserved; `pnpm example:run` unverifiable without a
  Gateway credential.

## Important active decisions

- ADR-0001..0017 plan; ADR-0018..0023 toolchain; **ADR-0024** framework pins;
  **ADR-0025** apps author eve agents; **ADR-0026** trace-safe errors;
  **ADR-0027** Standard Schema as schema contract; **ADR-0028** URL-only eve
  adapter observing the `eve/client` stream (amends ADR-0012); **ADR-0029**
  canonical JSON + `sha256:` fingerprints. Next free ADR number: **0030**.
- TypeScript 6.0.x until 7.1 (ADR-0019). Framework work follows
  `docs/development/source-of-truth-protocol.md`.

## Findings the next agent needs

Research: `docs/research/vercel/2026-09-19-m1-*.md` (three notes).
Architecture: `docs/architecture/runtime.md`. Contracts: `docs/contracts/`.

- Harness `run.*` events and adapter `eve.*` events each number `sequence`
  from 0 within a run. M2-T4's writer must own sequencing (or M2-T3 must define
  a per-source key).
- `TraceEvent` payloads from the adapter are identity-only projections (no
  message content, tool I/O, or results). M2-T3 defines the real schema; M2-T9
  owns redaction; `details` on errors is not a redaction boundary.
- Job/run ids are `crypto.randomUUID()`; nothing parses them. M2-T1 picks the
  sortable scheme and must touch `defineDomain` (job id) and `createHarness`
  (run id) only.
- `Job.contracts` strings (`vendor-triage.input@1.0.0` etc.) resolve through
  `parseCapabilityRefString` + the registry; `contracts.sop` (`procurement-sop`)
  has no registered capability yet. M2-T8's behavior fingerprint should hash
  instructions/SOP/skills content; the agent capability's value is a descriptor
  pointing at those files.
- eve facts: no in-process run API (HTTP via `eve/client`); `--port` skips
  reconnection to a recorded dev server; `NODE_ENV=test` makes eve mock every
  authored model (the helper strips it); `outputSchema` type is
  `StandardJSONSchemaV1 | JsonObject`; `MessageResult.status` is not a
  discriminator, branch on turn events; `mockModel` needs
  `modelContextWindowTokens`; `eve dev` runs as `node .../eve.js dev ...`, so `pgrep -f "eve dev"` never
  matches; use `pgrep -f "eve.js dev"` or check listening ports.
- `apps/*` is the only place eve may be imported outside `packages/runtime-eve`.

## Uncommitted / generated artifacts

- None after the handoff commit. Ignored build outputs: `dist/`, `.turbo/`,
  and eve's `.eve/`, `.output/` under both app roots.

## Exact next task

**Start Milestone 2.** First create
`docs/milestones/m2-job-trace-supabase-and-run-ledger.md` from the build plan's
Milestone 2 section (line ~1464 of `docs/milestones/build-plan.md`), in the
same shape as the M1 status file, and add it to `docs/milestones/README.md`.
Then **M2-T1, Stable identifiers**: choose UUIDv7 or another sortable scheme
(AD-016 says record it; Node 24 `crypto` support must be checked against the
installed Node docs), define the entity ID types the plan lists, and replace
the two `crypto.randomUUID()` call sites. M2-T2 (finalize `Job`), M2-T3 (trace
schema) and M2-T4 (buffered writer, `packages/trace`) follow and can run in
parallel once M2-T1 lands; M2-T5+ need local Supabase (M2-T11 first).

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm example:run:mock
```

(Node 24.21.0 and pnpm 12.4.2 on PATH; see `docs/development/local-setup.md`.)
Then read, in order: `AGENTS.md`, this file, `docs/README.md`,
`docs/progress/milestones/m1.md`, `docs/contracts/README.md`,
`docs/architecture/runtime.md`, and the Milestone 2 section of the build plan.

## Last successful verification

- `pnpm check`: PASS, 2026-09-19, after M1 (371/371 tests, 30 files).
- `pnpm example:run:mock`: PASS x3 consecutive, 2026-09-19.
- `pnpm example:run` (live model): not run, no credential.
- `eve info` (both app roots): `Compile ready`, 0 errors, 0 warnings.
