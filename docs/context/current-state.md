# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; frozen milestone
> records live in `docs/progress/milestones/`.

**Last updated:** 2026-09-19 (Milestone 2, M2-T1 through M2-T9 and M2-T11
complete)
**Current milestone:** M2, Job, Trace, Supabase, and Run Ledger (in progress)
**Current task:** M2-T10, Local run inspector (in progress).
**Last commit SHA:** `1b16a1a` (M2-T5, M2-T6, M2-T7: Storage port, Supabase
schema and migrations, outcome ledger). Earlier M2 commits: `219ccbd` (docs),
`62548d6` (M2-T8, T9, T11), `1f629bf` (docs), `5721f7d` (M2-T2, T3, T4),
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
- **Milestone 2, M2-T5, M2-T6, M2-T7, Supabase schema, migrations, outcome
  ledger: complete.** `Storage` port in core, `@internal/storage-supabase`
  adapter, five migrations for thirteen tables, `runs` as the outcome ledger
  with no attempts table. `docs/decisions/0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md`.
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
  M2-T5/T6/T7). Tests: 801 passed, 40 skipped across 47 files (`unit` +
  `contract` projects); the skipped 40 are the Supabase leg of the storage
  contract suite, which skips without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  set.
- **`pnpm example:run:mock`** has three observed behaviors, depending on
  environment:
  - With local Supabase up and `.env.local` present: exits 0 and persists the
    job row, a `runs` ledger row (`status: completed`, `success: true`, target
    `@internal/eve-fixture-agent`, the behavior fingerprint), and six
    `trace_events` rows (sequence 0 through 5), in addition to the JSONL file,
    through a fan-out sink.
  - Without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`: stays JSONL-only, with
    a stderr notice that storage is not configured.
  - With the env variables set but Supabase stopped: exits 1 with a one-line
    "configured but unreachable" message and no silent fallback.
  Every path still writes a non-null `sha256:` behavior fingerprint on each
  trace event and the eight component digests in the `run.started` payload. A
  one-character edit to `agent/instructions.md` moves the composite and only
  the `instructions` component (verified by M2-T8). **`pnpm example:run`** is
  the same path against the real example agent and needs `AI_GATEWAY_API_KEY`
  or `VERCEL_OIDC_TOKEN`; it is unverified against a live model.
- Nine workspace packages:
  - `@internal/core` (zero third-party deps; `node:crypto` only): JSON model
    (`isJsonValue`/`isJsonObject`/`isPlainObject`), `deepFreeze`, ids (twelve
    branded types, twelve generators, `parseEntityId`, `isEntityId`,
    `entityIdTimestampMs`/`entityIdTimestamp`, `ENTITY_ID_SCHEME`),
    `ExecutionContext` (`trace` is a `TraceRecorder`), the trace taxonomy
    (`TRACE_EVENT_TYPES`, `isTraceEventType`, `TraceEvent` v1,
    `createTraceRecorder`, `TraceSpan`, `TraceWriter` verbatim), error taxonomy
    + `serializeError`, `Schema` (Standard Schema) + `validateWith`, `Job` +
    `parseJob`/`isJob`, `DomainDefinition` + `defineDomain` (optional
    `behavior` descriptor/loader), `AgentRuntime` + `AgentExecution`,
    `createHarness` + `HarnessRunResult` (carries `behaviorFingerprint`),
    capability registry + manifest, `canonicalJson` + `fingerprint`,
    `createBehaviorFingerprint`, `BehaviorDescriptor`,
    `resolveBehaviorFingerprint`, and (new, M2-T5/T6/T7) `Storage`,
    `RunRecord`, `RunStart`, `RunFinish`, `RunFilter`, `RunPage`, `TracePage`,
    `parseRunRecord`, `CreateHarnessOptions.storage` and `.target`.
  - `@internal/trace`: `TraceSink`, `createBufferedTraceWriter`,
    `createInMemoryTraceSink`, `createJsonlFileTraceSink`,
    `createJsonlDirectoryTraceSink`, `createRedactor`,
    `createRedactingTraceWriter`, `DEFAULT_REDACTION_POLICY`,
    `createRedactionPolicy`, `redactEvents` (11 secret-pattern rules, 18
    field-path rules, 8 header names), and (new) `createStorageTraceSink`,
    `createFanOutTraceSink`. Depends on `@internal/core` and Node built-ins
    only; listed in `BOUNDARY_RULES` with core's bans.
  - `@internal/storage-supabase`: `createSupabaseStorage()`, over a pinned
    `@supabase/supabase-js@2.116.0`; depends on `@internal/core` and
    `@internal/trace`; generated `database.types.ts` (never hand-edited).
  - `@internal/testing`: `createFakeClock`, `createFakeAgentRuntime`,
    `createRecordingTraceWriter`, and (new) `createInMemoryStorage` plus the
    shared storage contract test suite both `Storage` implementations run.
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
    behavior-affecting eve config lives in one place,
    `agent/lib/agent-config.ts`, shared by `agent/agent.ts` and the behavior
    loader. `start` loads `.env.local` via Node's
    `--env-file-if-exists=../../.env.local`.
  - `apps/eve-fixture-agent` (`@internal/eve-fixture-agent`): `mockModel`
    fixture agent with scripted responses for tests and the mock demo.
- The example run's writer chain is: `TraceRecorder` -> redacting writer ->
  buffered writer -> fan-out sink (JSONL directory sink + Supabase storage
  sink, when storage is configured).
- Schema: five migrations under `supabase/migrations/`
  (`domains_and_jobs`, `workflow_registry_tables`, `runs_outcome_ledger`,
  `trace_events_and_artifacts`, `later_milestone_tables`), thirteen tables,
  row-level security enabled on all of them with no policies (the harness
  connects as `service_role`, which bypasses RLS). `domains.organization_id`
  defaults to `local`. `trace_events.occurred_at` maps `TraceEvent.timestamp`;
  the event type is a `check` constraint, not an enum. `pnpm supabase:reset`
  applies all five from an empty database; `database.types.ts` is regenerated
  and committed.
- Local credential capture:
  `pnpm exec supabase status -o env --override-name api.url=SUPABASE_URL --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY ... > .env.local`
  (full command in `docs/runbooks/supabase-local.md`); `.env.local` is
  git-ignored and present on this development host.
- Architecture boundary test: adapter-only rule for `packages/*`; `apps/*` may
  depend on `eve`, `ai`, `@ai-sdk/*` (ADR-0025); `@supabase/*`, `@vercel/*`,
  `workflow` adapter-only for everyone. `@internal/trace` is a non-adapter with
  core's bans; `@internal/storage-supabase` was already a declared adapter and
  needed no boundary edit for M2-T5/T6/T7 or M2-T11.
- Husky hooks; CI workflow file. A GitHub remote exists and CI ran green once,
  on `0029f36` (first run, about 52 seconds). A `supabase-types` CI job exists
  (starts Supabase, resets, regenerates, diffs the generated file) but has
  never run.
- Local Supabase: CLI pinned exactly at `supabase@2.117.0` in root
  `devDependencies`, resolved only through `node_modules/.bin` via
  `pnpm supabase:start`/`stop`/`reset`/`types`, never a global install.
  `supabase/config.toml` is committed at the CLI's defaults (`project_id`
  `adaptive-agent-harness`; API `54321`, Postgres `54322`, Studio `54323`).

## What is partially working

- **Run output is not persisted.** The `runs` ledger records status, success,
  cost, latency, call counts and error, but the job's actual output value
  lives nowhere durable yet. M6 (replay) and M7 (evals) will need it; open
  item for the milestone that adds it.
- `quality_score`, `human_review`, `workflow_version_id`, `jev_calls` and
  `fallback_count` on `runs` are placeholders, filled by M3 through M6.
- **Closed:** which target ran is no longer ambiguous. `runs.target` (from
  `CreateHarnessOptions.target`) now records which application or agent
  executed, closing the caveat that a mock run's fingerprint describes
  `apps/example-agent`'s authored behavior even though the fixture agent ran
  the events (ADR-0034's open question, closed by ADR-0036).
- Redaction (M2-T9) is wired end to end, but adapter payloads remain
  identity-only (ADR-0031), so a healthy trace today contains nothing for it
  to redact; the mechanism itself is proven by a dedicated test that seeds
  fake secrets and asserts they never reach a stored event.
- `contracts.sop` remains a bare, unversioned identifier; ADR-0034 closed the
  question by declining to version it, since the `sop` component fingerprint
  already captures content changes.
- `TraceEvent.node` is typed and always `null` until M4 has workflow nodes.
- `attempt` on `Job`/`TraceEvent`/`ExecutionContext`/`runs` is a plain integer,
  not an entity: `runs` has `unique (job_id, attempt)` and no `attempts`
  table. `AttemptId` and the other entity-id brands beyond `JobId`/`RunId`
  have no field carrying them yet.
- Tool permission enforcement in `EveAgentRuntime` is detection-and-cancel on
  the event stream, not prevention (ADR-0028). Fine for the read-only fixture
  tool; the auth-plus-approval composition is the M2/M5 upgrade.
- `EveAgentRuntime` still needs each domain's output schema at construction
  (`domains` option) because a `Job` carries only a string reference. The
  capability registry can resolve it once M2/M5 wires that.

## What does not exist yet

- The local run inspector (in progress, M2-T10), Jev, workflow IR, replay,
  evals, learner, compiler, and the rest of the CLI.

## Known failures

- None.

## Current blockers

- None for M2-T10.
- Docker is running on the development host. Local Supabase is currently
  **stopped**. `.env.local` is present (git-ignored) on this host, so
  `pnpm example:run:mock` **requires** `pnpm supabase:start` first here, or it
  exits 1 by design (configured but unreachable) rather than silently falling
  back to JSONL-only.
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
  redaction is a `TraceWriter` decorator placed before buffering; **ADR-0036**
  `Storage` is a core port over a Supabase schema, with `runs` as the outcome
  ledger and no attempts table. ADR number 0037 is reserved for the in-flight
  M2-T10 inspector task. Next free ADR number after that: **0038**.
- TypeScript 6.0.x until 7.1 (ADR-0019). Framework work follows
  `docs/development/source-of-truth-protocol.md`.

## Findings the next agent needs

Research: `docs/research/vercel/2026-09-19-m1-*.md` (three notes). Architecture:
`docs/architecture/runtime.md`. Contracts: `docs/contracts/` (`identifiers.md`,
`job.md`, `trace-event.md`, `harness.md`, `behavior-fingerprint.md`,
`redaction.md`, `storage.md` cover M2-T1 through M2-T9 and M2-T11). Runbook:
`docs/runbooks/supabase-local.md`.

- **`Storage` ordering contract**: `saveJob` and `startRun` are called before
  the first trace event; `finishRun` is called only after the trace has been
  flushed. This is what makes a crash mid-run leave an inspectable `running`
  row rather than nothing, and what stops a `completed` row from existing
  beside a trace nobody can verify.
- `startRun` is a plain insert, so a second run of the same `(job_id, attempt)`
  fails loudly on the unique constraint, by design; it does not merge.
- Trace-event inserts are `ON CONFLICT DO NOTHING` on `(run_id, sequence)`,
  first-write-wins, so a buffered writer's retry of an already-written batch
  cannot duplicate a run's narrative.
- `listRuns`/`getTrace` page limits above 1000 (`MAX_PAGE_SIZE`, matching
  `config.toml`'s `max_rows`) are a `ValidationError`, not a silent
  truncation.
- The Supabase service-role client disables `autoRefreshToken`,
  `persistSession` and `detectSessionInUrl` (all `true` by the installed
  package's defaults) — they are browser behaviors a server-side, non-session
  key has no use for.
- The storage preflight is `listRuns({}, { limit: 1 })`, run before `eve dev`
  starts, which is what turns "configured but unreachable" into a clean exit
  before any work happens rather than a failure mid-run.
- **`jobs.job` stores the unredacted effective job, by design**: the job's
  `input` is the work itself, and a redacted job could not be replayed.
  `runs.error` and `runs.runtime_metadata`, by contrast, are redacted, because
  no writer chain reaches them and a serialized error's `details` is not a
  redaction boundary (ADR-0026).
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
- **`uuid` ordering was measured against the pinned local Postgres 17.6, not
  assumed**: `order by id` on a UUIDv7 column matches `order by id::text`, so
  keyset pagination on `id` is creation order. `supabase-schema.integration.test.ts`
  keeps checking it against real rows.
- A trace-writer flush failure propagates out of `harness.run()` as a
  `StorageError` rather than being swallowed; "storage failures cannot
  silently turn into successful runs" is enforced by this, not just intended.
  A configured-but-unreachable store makes `harness.run()` throw the same way.
- The JSONL directory sink (`@internal/trace`) names each run's file
  `<directory>/<runId>.jsonl`, because the run id is minted inside
  `harness.run()` and a caller cannot name the file before the run starts.
- `harness.run()` also throws (before `run.started`, with nothing spent) when
  a domain's behavior loader throws or the descriptor it produces is invalid,
  exactly like an input-validation failure. The composite fingerprint hashes a
  `scheme` number, so redefining what components exist is visible in every
  future composite rather than silent.
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
  `.harness/` (local JSONL traces), `.env.local`, and eve's `.eve/`,
  `.output/` under both app roots. `packages/storage-supabase/src/database.types.ts`
  is generated but **is** committed (never hand-edited).

## Exact next task

**M2-T10, local run inspector, is in flight**: `pnpm harness run show <run-id>`,
reading through `Storage` (`getRun`, `getJob`, `getTrace`) with a JSONL
fallback for a run recorded with no database. Display job, route, timeline,
tool/model/Jev calls, errors, result, cost and fingerprints. Once it lands,
sweep the M2 acceptance criteria (verify every bullet in the status file has
real evidence, not "not yet verified"), write
`docs/progress/milestones/m2.md` in the shape of `m1.md`, mark M2 complete in
`docs/milestones/README.md`, and point the handoff at M3/M4 per the dependency
graph (M3, Jev, can run beside M4, Workflow IR, once M2 is done).

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm example:run:mock
```

(Node 24.21.0 and pnpm 12.4.2 on PATH; see `docs/development/local-setup.md`.)
On a host with `.env.local` present, run `pnpm supabase:start` first (Docker
must be running), or the mock run exits 1 by design. Then read, in order:
`AGENTS.md`, this file, `docs/README.md`,
`docs/milestones/m2-job-trace-supabase-and-run-ledger.md`,
`docs/contracts/identifiers.md`, `docs/contracts/job.md`,
`docs/contracts/trace-event.md`, `docs/contracts/behavior-fingerprint.md`,
`docs/contracts/redaction.md`, `docs/contracts/storage.md`,
`docs/runbooks/supabase-local.md`, and `docs/architecture/runtime.md`.

## Last successful verification

- `pnpm check`: PASS, 2026-09-19, after M2-T5/T6/T7 (801 passed, 40 skipped,
  47 files).
- `pnpm example:run:mock`: PASS, 2026-09-19, both with storage (run row plus
  six trace rows queried back) and JSONL-only.
- `pnpm supabase:reset`: PASS, applied all five migrations from an empty
  database.
- `uuid` vs. textual UUIDv7 ordering query: PASS, returned true against the
  pinned local Postgres 17.6.
- Row-level security: enabled on all 13 tables, verified.
- `pnpm example:run` (live model): not run, no credential.
- `eve info` (both app roots): unchanged from M1, `Compile ready`, 0 errors, 0
  warnings.
