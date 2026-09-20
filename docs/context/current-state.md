# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; frozen milestone
> records live in `docs/progress/milestones/`.

**Last updated:** 2026-09-19 (Milestone 2, M2-T1 through M2-T4, M2-T8, M2-T9,
M2-T11 complete)
**Current milestone:** M2, Job, Trace, Supabase, and Run Ledger (in progress)
**Current task:** M2-T5, M2-T6 and M2-T7 (Supabase schema, migrations, outcome
ledger) are `in_progress` as one task.
**Last commit SHA:** `62548d6` (M2-T8, M2-T9, M2-T11: behavior fingerprint,
trace redaction, reproducible local Supabase). Earlier M2 commits: `1f629bf`
(docs), `5721f7d` (M2-T2, T3, T4), `02b1261` (M2-T1). Run `git log --oneline`.

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
- **Milestone 2, M2-T8, Behavior fingerprint: complete.** Component-wise
  fingerprint (instructions, SOP, skills, tools, model, schemas, workflow IR,
  policy; scheme 1), supplied by the domain via `DomainDefinition.behavior`,
  resolved once by `createHarness()` before `run.started`.
  `docs/decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md`.
- **Milestone 2, M2-T9, Secret and sensitive-data redaction: complete.** A
  `TraceWriter` decorator placed above the buffer, with field-path,
  secret-pattern, header and tool-sanitizer rules and `[REDACTED:<rule>]`
  tokens. `docs/decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md`.
- **Milestone 2, M2-T11, Reproducible local Supabase environment: complete.**
  Supabase CLI pinned as a root dev dependency, driven only through
  `pnpm supabase:*`; `supabase db reset` is the reproducibility gate.
  `docs/decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass (2026-09-19, after
  M2-T8/T9/T11). Tests: 691 across 40 files (`unit` + `contract` projects).
- **`pnpm example:run:mock`** runs the vendor-triage domain end to end through
  `createHarness()` and `EveAgentRuntime` against a real `eve dev` server with a
  scripted model, credential-free, and exits 0 with a `completed` result. Its
  JSONL trace now carries a non-null `sha256:` behavior fingerprint on every
  event, and the eight component digests are in the `run.started` payload. A
  one-character edit to `agent/instructions.md` moves the composite fingerprint
  and only the `instructions` component (verified by M2-T8). **`pnpm example:run`**
  is the same path against the real example agent and needs
  `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`; it is unverified against a live
  model.
- Nine workspace packages:
  - `@internal/core` (zero third-party deps; `node:crypto` only): JSON model
    (`isJsonValue`/`isJsonObject`/`isPlainObject`), `deepFreeze`, ids (twelve
    branded types, twelve generators, `parseEntityId`, `isEntityId`,
    `entityIdTimestampMs`/`entityIdTimestamp`, `ENTITY_ID_SCHEME`),
    `ExecutionContext` (`trace` is a `TraceRecorder`), the trace taxonomy
    (`TRACE_EVENT_TYPES`, `isTraceEventType`, `TraceEvent` v1,
    `createTraceRecorder`, `TraceSpan`, `TraceWriter` verbatim), error taxonomy
    + `serializeError`, `Schema` (Standard Schema) + `validateWith`, `Job` +
    `parseJob`/`isJob`, `DomainDefinition` + `defineDomain` (now with an
    optional `behavior` descriptor/loader), `AgentRuntime` + `AgentExecution`,
    `createHarness` + `HarnessRunResult` (now carries `behaviorFingerprint`),
    capability registry + manifest, `canonicalJson` + `fingerprint`,
    `createBehaviorFingerprint`, `BehaviorDescriptor`,
    `resolveBehaviorFingerprint`.
  - `@internal/trace`: `TraceSink`, `createBufferedTraceWriter`,
    `createInMemoryTraceSink`, `createJsonlFileTraceSink`,
    `createJsonlDirectoryTraceSink`, plus (new, M2-T9) `createRedactor`,
    `createRedactingTraceWriter`, `DEFAULT_REDACTION_POLICY`,
    `createRedactionPolicy`, `redactEvents` (11 secret-pattern rules, 18
    field-path rules, 8 header names). Depends on `@internal/core` and Node
    built-ins only; listed in `BOUNDARY_RULES` with core's bans.
  - `@internal/storage-supabase` (new, M2-T11): types only so far — the
    generated `database.types.ts`. No adapter code and no `@supabase/*`
    dependency yet; both are M2-T5.
  - `@internal/testing`: `createFakeClock`, `createFakeAgentRuntime`,
    `createRecordingTraceWriter`. Depends on core.
  - `@internal/runtime-eve`: `EveAgentRuntime` (maps eve stream events onto the
    trace taxonomy instead of emitting `eve.<type>`; own `state.sequence` is
    gone), `eveVersion`, `LOAD_SKILL_TOOL_ID`; `./testing` subpath with
    `startEveDevServer` and `readRecordedDevServerUrl`.
  - `@internal/runtime-ai-sdk`: dependency boundary only (one type re-export).
    The AI SDK runtime implementation is not scheduled by M1/M2; ADR-0003 keeps
    the AI SDK as the lowest contract and eve as the default adapter.
  - `@internal/config`.
  - `apps/example-agent` (`@internal/example-agent`): eve project
    (`defaultTools: false`, tools `lookup_vendor_evidence` + `load_skill`),
    domain (`src/domain/`), capabilities (`src/capabilities.ts`, handler,
    policy), behavior descriptor (`src/behavior.ts`), `src/run.ts`. The
    behavior-affecting eve config now lives in one place,
    `agent/lib/agent-config.ts`, shared by `agent/agent.ts` and the behavior
    loader.
  - `apps/eve-fixture-agent` (`@internal/eve-fixture-agent`): `mockModel`
    fixture agent with scripted responses for tests and the mock demo.
- The example run's writer chain is now: `TraceRecorder` -> redacting writer ->
  buffered writer -> JSONL directory sink.
- Architecture boundary test: adapter-only rule for `packages/*`; `apps/*` may
  depend on `eve`, `ai`, `@ai-sdk/*` (ADR-0025); `@supabase/*`, `@vercel/*`,
  `workflow` adapter-only for everyone. `@internal/trace` is a non-adapter with
  core's bans; `@internal/storage-supabase` was already a declared adapter and
  needed no boundary edit for M2-T11.
- Husky hooks; CI workflow file. A GitHub remote exists and CI ran green once,
  on `0029f36` (first run, about 52 seconds). A `supabase-types` CI job now
  exists (starts Supabase, resets, regenerates, diffs the generated file) but
  has never run.
- Local Supabase: CLI pinned exactly at `supabase@2.117.0` in root
  `devDependencies`, resolved only through `node_modules/.bin` via
  `pnpm supabase:start`/`stop`/`reset`/`types`, never a global install.
  `supabase/config.toml` is committed at the CLI's defaults (`project_id`
  `adaptive-agent-harness`; API `54321`, Postgres `54322`, Studio `54323`).
  Reproducibility was verified locally: two consecutive `supabase db reset`
  runs plus `supabase gen types` produced byte-identical generated types.

## What is partially working

- Redaction (M2-T9) is wired end to end, but adapter payloads remain
  identity-only (ADR-0031), so a healthy trace today contains nothing for it to
  redact; the mechanism itself is proven by a dedicated test that seeds fake
  secrets and asserts they never reach a stored event.
- The `pnpm example:run:mock` fingerprint describes `apps/example-agent`'s
  authored behavior even when the fixture agent (`apps/eve-fixture-agent`) is
  what actually ran, because both targets share one `vendorTriage` domain and
  therefore one behavior descriptor (ADR-0034, "open questions"). Recording
  which target ran, alongside the fingerprint, is left to M2-T5's run ledger.
- `contracts.sop` remains a bare, unversioned identifier; ADR-0034 closed the
  question by declining to version it, since the `sop` component fingerprint
  already captures content changes.
- `TraceEvent.node` is typed and always `null` until M4 has workflow nodes.
- `attempt` on `Job`/`TraceEvent`/`ExecutionContext` is a plain number.
  `AttemptId` and the other entity-id brands beyond `JobId`/`RunId` have no
  field carrying them yet; where each surfaces is M2-T5's decision.
- Tool permission enforcement in `EveAgentRuntime` is detection-and-cancel on
  the event stream, not prevention (ADR-0028). Fine for the read-only fixture
  tool; the auth-plus-approval composition is the M2/M5 upgrade.
- `EveAgentRuntime` still needs each domain's output schema at construction
  (`domains` option) because a `Job` carries only a string reference. The
  capability registry can resolve it once M2/M5 wires that.

## What does not exist yet

- The Supabase `Storage` port and its adapter implementation, migrations
  (`supabase/migrations/` currently holds only a README), the run ledger, the
  local run inspector, Jev, workflow IR, replay, evals, learner, compiler, CLI.

## Known failures

- None.

## Current blockers

- None for M2-T5/T6/T7. Local Supabase was left **stopped** after M2-T11;
  start it with `pnpm supabase:start` before beginning storage work.
- Docker is running on the development host, verified with `hello-world`.
- `pnpm example:run` against a live Gateway model remains unverified without a
  credential.
- The `supabase-types` CI job is unverified until the next push triggers it.

## Important active decisions

- ADR-0001..0017 plan; ADR-0018..0023 toolchain; **ADR-0024** framework pins;
  **ADR-0025** apps author eve agents; **ADR-0026** trace-safe errors;
  **ADR-0027** Standard Schema as schema contract; **ADR-0028** URL-only eve
  adapter observing the `eve/client` stream (amends ADR-0012); **ADR-0029**
  canonical JSON + `sha256:` fingerprints; **ADR-0030** sortable UUIDv7 entity
  identifiers; **ADR-0031** trace event taxonomy, recorder-owned sequencing,
  and the buffered writer; **ADR-0032** jobs are deeply immutable and the
  effective job is the job; **ADR-0033** the Supabase CLI is a pinned dev
  dependency and `db reset` is the reproducibility gate; **ADR-0034** the
  behavior fingerprint is component-wise and domain-supplied; **ADR-0035**
  redaction is a `TraceWriter` decorator placed before buffering. ADR number
  0036 is reserved for the in-flight M2-T5/T6/T7 storage task. Next free ADR
  number after that: **0037**.
- TypeScript 6.0.x until 7.1 (ADR-0019). Framework work follows
  `docs/development/source-of-truth-protocol.md`.

## Findings the next agent needs

Research: `docs/research/vercel/2026-09-19-m1-*.md` (three notes). Architecture:
`docs/architecture/runtime.md`. Contracts: `docs/contracts/` (`identifiers.md`,
`job.md`, `trace-event.md`, `harness.md`, `behavior-fingerprint.md`,
`redaction.md` cover M2-T1 through M2-T4, M2-T8 and M2-T9). Runbook:
`docs/runbooks/supabase-local.md`.

- A run-scoped `createTraceRecorder()` in `@internal/core` is the single owner
  of `sequence`; `ExecutionContext.trace` is a `TraceRecorder`, not a raw
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
  domain's schema (it has no domain to ask).
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
- `harness.run()` now also throws (before `run.started`, with nothing spent)
  when a domain's behavior loader throws or the descriptor it produces is
  invalid, exactly like an input-validation failure. The composite fingerprint
  hashes a `scheme` number, so redefining what components exist is visible in
  every future composite rather than silent.
- Redaction's token format is `[REDACTED:<rule-name>]`; a rule matching a whole
  object (rather than a string leaf) nests the token under a `redacted` key,
  since the token cannot replace an object with a string in place. Inside a
  `headers` object, the header rule wins over a generic field-path rule.
- `supabase gen types` in the pinned 2.117.0 has no output-file flag, so
  `pnpm supabase:types` uses shell redirection (`>`); a failed generation
  truncates the committed `database.types.ts`, so always reset before
  regenerating and check `git diff` on that path. The CLI also prints a
  harmless `Skipping migration README.md...` line on every start and reset.
- eve's `agent/lib/` is documented as import-only shared authored code, not
  copied into the sandbox (`docs/reference/agent-files.md`); M2-T8 used it to
  give `agent/agent.ts` and the behavior loader one shared source of model
  configuration.
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
  roots. `packages/storage-supabase/src/database.types.ts` is generated but
  **is** committed (never hand-edited).

## Exact next task

**M2-T5, M2-T6 and M2-T7 are in flight**, as one task: the `Storage` port in
`@internal/core`, the `@internal/storage-supabase` adapter over a pinned
`@supabase/supabase-js`, the thirteen tables as committed SQL migrations under
`supabase/migrations/`, regenerated `database.types.ts`, and the run ledger
(one query-friendly row per run). Contract and integration tests need local
Supabase running. Then **M2-T10** (local run inspector,
`pnpm harness run show <run-id>`), then the M2 acceptance-criteria sweep and
milestone snapshot.

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm example:run:mock
```

(Node 24.21.0 and pnpm 12.4.2 on PATH; see `docs/development/local-setup.md`.)
Before storage work, also run `pnpm supabase:start` (Docker must be running).
Then read, in order: `AGENTS.md`, this file, `docs/README.md`,
`docs/milestones/m2-job-trace-supabase-and-run-ledger.md`,
`docs/contracts/identifiers.md`, `docs/contracts/job.md`,
`docs/contracts/trace-event.md`, `docs/contracts/behavior-fingerprint.md`,
`docs/contracts/redaction.md`, `docs/runbooks/supabase-local.md`, and
`docs/architecture/runtime.md`.

## Last successful verification

- `pnpm check`: PASS, 2026-09-19, after M2-T8/T9/T11 (691/691 tests, 40 files).
- `pnpm example:run:mock`: PASS, 2026-09-19, with a `completed` result and a
  fingerprinted, ordered six-event JSONL trace.
- `pnpm supabase:reset` and `pnpm supabase:types`: PASS, 2026-09-19, with
  byte-identical regeneration across two consecutive resets (M2-T11).
- `pnpm example:run` (live model): not run, no credential.
- `eve info` (both app roots): unchanged from M1, `Compile ready`, 0 errors, 0
  warnings.
