# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; frozen milestone
> records live in `docs/progress/milestones/`.

**Last updated:** 2026-09-19 (Milestone 2, M2-T1 through M2-T4 complete)
**Current milestone:** M2, Job, Trace, Supabase, and Run Ledger (in progress)
**Current task:** M2-T11 (local Supabase), M2-T8 (behavior fingerprint) and
M2-T9 (redaction) are `in_progress`, concurrently.
**Last commit SHA:** `5721f7d` (M2-T2, M2-T3, M2-T4: finalized `Job`, trace
event schema, run-scoped recorder, buffered trace writer). Earlier M2 commit:
`02b1261` (M2-T1). Run `git log --oneline`.

## Completed milestones / tasks

- **Milestone 0, Repository Foundation: complete.** `docs/progress/milestones/m0.md`.
- **Milestone 1, Local Agent + Public Harness Boundary: complete.** All nine
  tasks done. Snapshot: `docs/progress/milestones/m1.md`. Status and
  per-criterion evidence: `docs/milestones/m1-local-agent-and-public-harness-boundary.md`.
- **Milestone 2, M2-T1, Stable identifiers: complete.** RFC 9562 UUIDv7 with a
  monotonic counter, twelve branded entity id types. `docs/decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md`.
- **Milestone 2, M2-T2, Job contract: complete.** Deep immutability, the
  effective job is the job, creation time derived from the id, `parseJob()` as
  the strict read boundary. `docs/decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md`.
- **Milestone 2, M2-T3, Event trace schema: complete.** The closed
  `TraceEventType` taxonomy plus `run.aborted`, the fifteen-field `TraceEvent`,
  the eve-to-taxonomy mapping. `docs/decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md`.
- **Milestone 2, M2-T4, Trace writer interface: complete.** The verbatim
  `TraceWriter`, the new `@internal/trace` package (`TraceSink`, buffered
  writer, JSONL sinks). Same ADR as M2-T3, `0031`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass (2026-09-19, after
  M2-T4). Tests: 569 across 35 files (`unit` + `contract` projects).
- **`pnpm example:run:mock`** runs the vendor-triage domain end to end through
  `createHarness()` and `EveAgentRuntime` against a real `eve dev` server with a
  scripted model, credential-free, and exits 0 with a `completed` result. It now
  also writes an ordered JSONL trace to
  `apps/<target>/.harness/traces/<runId>.jsonl`. A verified run produced six
  events for the fixture domain, sequence contiguous from 0: `run.started`,
  `agent.started`, `model.started`, `model.completed`, `agent.completed`,
  `run.completed`. Ids are sortable (UUIDv7). **`pnpm example:run`** is the same
  path against the real example agent and needs `AI_GATEWAY_API_KEY` or
  `VERCEL_OIDC_TOKEN`; it is unverified against a live model.
- Eight workspace packages:
  - `@internal/core` (zero third-party deps; `node:crypto` only): JSON model
    (`isJsonValue`/`isJsonObject`/`isPlainObject`), `deepFreeze`, ids (twelve
    branded types, twelve generators, `parseEntityId`, `isEntityId`,
    `entityIdTimestampMs`/`entityIdTimestamp`, `ENTITY_ID_SCHEME`),
    `ExecutionContext` (`trace` is now a `TraceRecorder`), the trace taxonomy
    (`TRACE_EVENT_TYPES`, `isTraceEventType`, `TraceEvent` v1,
    `createTraceRecorder`, `TraceSpan`, `TraceWriter` verbatim), error taxonomy
    + `serializeError`, `Schema` (Standard Schema) + `validateWith`, `Job` +
    `parseJob`/`isJob`, `DomainDefinition` + `defineDomain`, `AgentRuntime` +
    `AgentExecution`, `createHarness` + `HarnessRunResult`, capability registry
    + manifest, `canonicalJson` + `fingerprint`.
  - `@internal/trace` (new, M2-T4): `TraceSink`, `createBufferedTraceWriter`,
    `createInMemoryTraceSink`, `createJsonlFileTraceSink`,
    `createJsonlDirectoryTraceSink`. Depends on `@internal/core` and Node
    built-ins only; listed in `BOUNDARY_RULES` with core's bans.
  - `@internal/testing`: `createFakeClock`, `createFakeAgentRuntime`,
    `createRecordingTraceWriter`. Depends on core.
  - `@internal/runtime-eve`: `EveAgentRuntime` (now maps eve stream events onto
    the trace taxonomy instead of emitting `eve.<type>`; own `state.sequence` is
    gone), `eveVersion`, `LOAD_SKILL_TOOL_ID`; `./testing` subpath with
    `startEveDevServer` and `readRecordedDevServerUrl`.
  - `@internal/runtime-ai-sdk`: dependency boundary only (one type re-export).
    The AI SDK runtime implementation is not scheduled by M1/M2; ADR-0003 keeps
    the AI SDK as the lowest contract and eve as the default adapter.
  - `@internal/config`.
  - `apps/example-agent` (`@internal/example-agent`): eve project
    (`defaultTools: false`, tools `lookup_vendor_evidence` + `load_skill`),
    domain (`src/domain/`), capabilities (`src/capabilities.ts`, handler,
    policy), `src/run.ts`.
  - `apps/eve-fixture-agent` (`@internal/eve-fixture-agent`): `mockModel`
    fixture agent with scripted responses for tests and the mock demo.
- Architecture boundary test: adapter-only rule for `packages/*`; `apps/*` may
  depend on `eve`, `ai`, `@ai-sdk/*` (ADR-0025); `@supabase/*`, `@vercel/*`,
  `workflow` adapter-only for everyone. `@internal/trace` added as a
  non-adapter with core's bans. Pin tests per ADR-0024.
- Husky hooks; CI workflow file. A GitHub remote now exists and CI ran green
  once, on `0029f36` (first run, about 52 seconds).

## What is partially working

- `TraceEvent.behaviorFingerprint` is typed and wired but always `null` until
  M2-T8 lands a real fingerprint; a fabricated value would break every
  comparison built on it.
- `TraceEvent.payload` stays identity-only, as M1's adapter projection already
  was; nothing redacts it yet (M2-T9, in progress).
- `TraceEvent.node` is typed and always `null` until M4 has workflow nodes.
- `attempt` on `Job`/`TraceEvent`/`ExecutionContext` is a plain number.
  `AttemptId` and the other nine entity-id brands beyond `JobId`/`RunId` have
  no field carrying them yet; where each surfaces is M2-T5's (and, for
  `TraceEventId`'s parent linkage, already-landed M2-T3's) decision.
- Tool permission enforcement in `EveAgentRuntime` is detection-and-cancel on
  the event stream, not prevention (ADR-0028). Fine for the read-only fixture
  tool; the auth-plus-approval composition is the M2/M5 upgrade.
- `EveAgentRuntime` still needs each domain's output schema at construction
  (`domains` option) because a `Job` carries only a string reference. The
  capability registry can resolve it once M2/M5 wires that.

## What does not exist yet

- No persistence (`Storage`, Supabase), no migrations, no run ledger, no
  inspector, no real behavior fingerprint, no redaction, no Jev, no workflow
  IR, no replay, evals, learner, compiler, CLI.

## Known failures

- None.

## Current blockers

- None for M2-T8, M2-T9 or M2-T11 individually. M2-T5, M2-T6, M2-T7 and M2-T10
  need a local Supabase (M2-T11) before they can be verified end to end.
- Docker Desktop is running on the development host, verified with
  `hello-world`. The Supabase CLI exists on the host via Homebrew (2.105.0) but
  is not yet a project dev dependency; M2-T11 owns adding it as one.
- `pnpm example:run` against a live Gateway model remains unverified without a
  credential.

## Important active decisions

- ADR-0001..0017 plan; ADR-0018..0023 toolchain; **ADR-0024** framework pins;
  **ADR-0025** apps author eve agents; **ADR-0026** trace-safe errors;
  **ADR-0027** Standard Schema as schema contract; **ADR-0028** URL-only eve
  adapter observing the `eve/client` stream (amends ADR-0012); **ADR-0029**
  canonical JSON + `sha256:` fingerprints; **ADR-0030** sortable UUIDv7 entity
  identifiers; **ADR-0031** trace event taxonomy, recorder-owned sequencing,
  and the buffered writer; **ADR-0032** jobs are deeply immutable and the
  effective job is the job. ADR numbers 0033, 0034 and 0035 are reserved for
  the in-flight M2-T11, M2-T8 and M2-T9 tasks. Next free ADR number after
  those: **0036**.
- TypeScript 6.0.x until 7.1 (ADR-0019). Framework work follows
  `docs/development/source-of-truth-protocol.md`.

## Findings the next agent needs

Research: `docs/research/vercel/2026-09-19-m1-*.md` (three notes). Architecture:
`docs/architecture/runtime.md`. Contracts: `docs/contracts/` (`identifiers.md`,
`job.md`, `trace-event.md`, `harness.md` cover M2-T1 through M2-T4).

- A run-scoped `createTraceRecorder()` in `@internal/core` is now the single
  owner of `sequence`; `ExecutionContext.trace` is a `TraceRecorder`, not a raw
  `TraceWriter`. A `*.started` event's own `id` is its span id (no separate
  span entity); every `run.*` event is a root with `parentId: null`.
- `EveAgentRuntime` maps eve stream events onto the closed taxonomy
  (`turn.*` -> `agent.*`, `step.*` -> `model.*`,
  `actions.requested`/`action.result` -> `tool.*`, eve's human-input events ->
  `approval.*`) instead of emitting `eve.<type>`. Several eve events are
  deliberately dropped as not trace events: message/reasoning deltas, session
  lifecycle, compaction, `authorization.*`, `approval.candidate`/`settled`
  (the natural producers of `approval.*` once M5 wires approvals), and
  `subagent.*` (a nested agent run should become a child run with its own
  `runId`, not a taxonomy member). Full mapping table in ADR-0031.
- `parseJob()` (`@internal/core`) is the strict read boundary for a stored or
  replayed job: it rejects unknown fields at the top level, in `contracts`, in
  `budget` and in a `ToolGrant`, and does not validate `input` against a
  domain's schema (it has no domain to ask). `contracts.sop` is currently a
  bare, unversioned identifier; whether it needs a version is an open question
  M2-T8's behavior fingerprint may force.
- A `uuid` column's ordering must be checked against the ids' textual order
  before M2-T5 relies on `ORDER BY id` matching creation order; UUIDv7's
  sortability is a property of the string bytes, not guaranteed by every
  Postgres `uuid` comparison path.
- A trace-writer flush failure propagates out of `harness.run()` as a
  `StorageError` rather than being swallowed; "storage failures cannot
  silently turn into successful runs" is enforced by this, not just intended.
- The JSONL directory sink (`@internal/trace`) names each run's file
  `<directory>/<runId>.jsonl`, because the run id is minted inside
  `harness.run()` and a caller cannot name the file before the run starts.
- eve facts carried over from M1: no in-process run API (HTTP via
  `eve/client`); `--port` skips reconnection to a recorded dev server;
  `NODE_ENV=test` makes eve mock every authored model (the helper strips it);
  `outputSchema` type is `StandardJSONSchemaV1 | JsonObject`;
  `MessageResult.status` is not a discriminator, branch on turn events;
  `mockModel` needs `modelContextWindowTokens`; `eve dev` runs as
  `node .../eve.js dev ...`, so `pgrep -f "eve dev"` never matches; use
  `pgrep -f "eve.js dev"` or check listening ports.
- `apps/*` is the only place eve may be imported outside `packages/runtime-eve`.

## Uncommitted / generated artifacts

- None after the handoff commit. Ignored build outputs: `dist/`, `.turbo/`,
  `.harness/` (local JSONL traces), and eve's `.eve/`, `.output/` under both app
  roots.

## Exact next task

Finish the three tasks in flight: **M2-T11** (reproducible local Supabase:
install the Supabase CLI as a project dev dependency, script
`pnpm supabase:start`/`stop`/`reset`/`types`), **M2-T8** (behavior fingerprint,
extending `capabilityFingerprint()` to cover instructions/SOP/skills/tool
definitions/model configuration/schemas/workflow IR/policy thresholds), and
**M2-T9** (secret and sensitive-data redaction: field-path redaction,
secret-pattern redaction, headers redaction, tool-specific sanitizer hooks,
tested with seeded fake secrets), which can proceed in parallel. Then
**M2-T5** and **M2-T6** (Supabase schema + migrations, both need M2-T11), then
**M2-T7** (outcome ledger), then **M2-T10** (local run inspector).

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm example:run:mock
```

(Node 24.21.0 and pnpm 12.4.2 on PATH; see `docs/development/local-setup.md`.)
Then read, in order: `AGENTS.md`, this file, `docs/README.md`,
`docs/milestones/m2-job-trace-supabase-and-run-ledger.md`,
`docs/contracts/identifiers.md`, `docs/contracts/job.md`,
`docs/contracts/trace-event.md`, and `docs/architecture/runtime.md`.

## Last successful verification

- `pnpm check`: PASS, 2026-09-19, after M2-T4 (569/569 tests, 35 files).
- `pnpm example:run:mock`: PASS, 2026-09-19, with a `completed` result and an
  ordered six-event JSONL trace.
- `pnpm example:run` (live model): not run, no credential.
- `eve info` (both app roots): unchanged from M1, `Compile ready`, 0 errors, 0
  warnings.
