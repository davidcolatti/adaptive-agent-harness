# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; frozen milestone
> records live in `docs/progress/milestones/`.

**Last updated:** 2026-09-20 (Milestone 2 complete)
**Current milestone:** M2 is complete. Next is **M4, Workflow IR + Local
Runtime** (the critical path), with **M3, Jev**, able to proceed beside it —
both are blocked only by M2, which is now done.
**Current task:** Not started. First create the status file for whichever
milestone starts (M4 recommended first, since it is the critical path and M3
can run beside it), from `docs/milestones/build-plan.md`, in the M2 status
file's shape.
**Last commit SHA:** `5eaba18` (M2-T10: local run inspector and the first
harness CLI command). This handoff's own docs commit follows it. Earlier M2
commits: `ab9a374`, `1b16a1a`, `219ccbd`, `62548d6`, `1f629bf`, `5721f7d`,
`02b1261`. Run `git log --oneline`.

## Completed milestones / tasks

- **Milestone 0, Repository Foundation: complete.** `docs/progress/milestones/m0.md`.
- **Milestone 1, Local Agent + Public Harness Boundary: complete.**
  `docs/progress/milestones/m1.md`.
- **Milestone 2, Job, Trace, Supabase, and Run Ledger: complete.** All eleven
  tasks done, all ten acceptance criteria verified with dated evidence.
  Snapshot: `docs/progress/milestones/m2.md`. Status file:
  `docs/milestones/m2-job-trace-supabase-and-run-ledger.md`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass (2026-09-20, after
  M2-T10). Tests: 876 passed, 43 skipped across 53 files (`unit` +
  `contract` projects); the skipped tests are the Supabase legs of the
  storage and inspector contract suites, which skip without
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set.
- **`pnpm example:run:mock`** has three verified behaviors depending on
  environment: persisted (local Supabase up, `.env.local` present — writes
  the job row, a `runs` ledger row, and six `trace_events` rows, plus the
  JSONL file, through a fan-out sink), JSONL-only (no Supabase env
  configured), and configured-but-unreachable (env set, Supabase stopped:
  exits 1 with a one-line message, no silent fallback). Every path writes a
  non-null `sha256:` behavior fingerprint on each trace event and the eight
  component digests in `run.started`. **`pnpm example:run`** is the same path
  against the real example agent and needs `AI_GATEWAY_API_KEY` or
  `VERCEL_OIDC_TOKEN`; it is unverified against a live model.
- **`pnpm harness run show <run-id>`** (`[--json] [--jsonl <path>]`) is the
  first harness CLI command: reads a run through the `Storage` port or a
  JSONL trace file, with no database, key or Docker required for the JSONL
  path. Displays job, route, timeline, tool/model/Jev calls, errors, result,
  cost and fingerprints from durable evidence alone — no application log is
  consulted. Verified against real Supabase and against a JSONL-only trace.
- Ten workspace packages, plus two apps:
  - `@internal/core` (zero third-party deps; `node:crypto` only): JSON model,
    `deepFreeze`, ids (twelve branded types, generators, `parseEntityId`,
    `entityIdTimestampMs`/`entityIdTimestamp`), `ExecutionContext` (`trace` is
    a `TraceRecorder`), the closed trace taxonomy (`TraceEvent` v1,
    `createTraceRecorder`, `parseTraceEvent`), error taxonomy +
    `serializeError`, `Schema` + `validateWith`, `Job` +
    `parseJob`/`isJob`, `DomainDefinition` + `defineDomain` (optional
    `behavior` descriptor/loader), `AgentRuntime` + `AgentExecution`,
    `createHarness` + `HarnessRunResult` (carries `behaviorFingerprint`),
    capability registry + manifest, `canonicalJson` + `fingerprint`,
    `createBehaviorFingerprint`, `BehaviorDescriptor`, and `Storage`,
    `RunRecord`, `RunStart`, `RunFinish`, `RunFilter`, `RunPage`, `TracePage`,
    `parseRunRecord`, `CreateHarnessOptions.storage`/`.target`.
  - `@internal/trace`: `TraceSink`, `createBufferedTraceWriter`, JSONL sinks
    and `readJsonlTraceEvents`, `createRedactor`/`createRedactingTraceWriter`,
    `DEFAULT_REDACTION_POLICY`, `createStorageTraceSink`,
    `createFanOutTraceSink`. Depends on `@internal/core` and Node built-ins
    only.
  - `@internal/storage-supabase`: `createSupabaseStorage()` over a pinned
    `@supabase/supabase-js@2.116.0`; depends on `@internal/core` and
    `@internal/trace`; generated `database.types.ts` (never hand-edited).
  - `@internal/observability` (new, M2-T10): `inspectRun()`,
    `renderRunInspection()`, `createJsonlTraceSource()`, the `pnpm harness`
    CLI entry point (`src/bin/harness.ts`) on Node's built-in
    `util.parseArgs`. Depends on `@internal/core`, `@internal/trace` and
    (through the CLI module only, not the library surface)
    `@internal/storage-supabase`.
  - `@internal/testing`: `createFakeClock`, `createFakeAgentRuntime`,
    `createRecordingTraceWriter`, `createInMemoryStorage`, and the shared
    storage contract test suite every `Storage` implementation runs.
  - `@internal/runtime-eve`: `EveAgentRuntime` (maps eve stream events onto
    the trace taxonomy), `eveVersion`, `LOAD_SKILL_TOOL_ID`; `./testing`
    subpath with `startEveDevServer`.
  - `@internal/runtime-ai-sdk`: dependency boundary only. Not scheduled by
    M1/M2; ADR-0003 keeps eve as the default adapter.
  - `@internal/config`.
  - `apps/example-agent` (`@internal/example-agent`): eve project, domain,
    capabilities, behavior descriptor (`src/behavior.ts`), `src/run.ts`. Eve
    config lives in one place, `agent/lib/agent-config.ts`. `start` loads
    `.env.local` via `--env-file-if-exists=../../.env.local`.
  - `apps/eve-fixture-agent` (`@internal/eve-fixture-agent`): `mockModel`
    fixture agent for tests and the mock demo.
- Local Supabase schema: five migrations under `supabase/migrations/`,
  thirteen tables, RLS enabled on all with no policies (harness connects as
  `service_role`, which bypasses RLS). `pnpm supabase:reset` applies all five
  from an empty database; `database.types.ts` regenerated and committed,
  byte-identical across regenerations.
- Local Supabase CLI: pinned exactly at `supabase@2.117.0` in root
  `devDependencies`, driven only through `pnpm supabase:start`/`stop`/`reset`/
  `types`, never a global install. Credential capture:
  `pnpm exec supabase status -o env ... > .env.local` (git-ignored; present on
  this development host).
- Architecture boundary test: adapter-only rule for `packages/*`; `apps/*` may
  depend on `eve`, `ai`, `@ai-sdk/*` (ADR-0025); `@supabase/*`, `@vercel/*`,
  `workflow` adapter-only for everyone. `@internal/trace` and
  `@internal/observability` are non-adapters with core's bans;
  `@internal/storage-supabase` is the one declared adapter allowed to depend
  on `@supabase/*`.
- Husky hooks (with a `~/.config/husky/init.sh` PATH fix so hooks see Node 24
  rather than the host's broken Node 23); CI workflow file, including a
  `supabase-types` job (starts Supabase, resets, regenerates, diffs the
  generated file). A GitHub remote (`origin/main`) exists and CI ran green
  once, on `0029f36`, before any M2 commit existed.

## What is partially working

- **Run output is not persisted.** The `runs` ledger records status, success,
  cost, latency, call counts and error, but a job's actual output value lives
  nowhere durable. M6 (replay) and M7 (evals) will need it; the `artifacts`
  table exists only in its minimal keyed shape, and M5 is what fills it.
- `quality_score`, `human_review`, `workflow_version_id`, `jev_calls` and
  `fallback_count` on `runs` are placeholders, filled by M3 through M6.
- **Closed:** which target ran is no longer ambiguous. `runs.target` (from
  `CreateHarnessOptions.target`) records which application or agent executed,
  closing ADR-0034's open question that a mock run's fingerprint describes
  `apps/example-agent`'s authored behavior even though the fixture agent ran
  the events.
- `contracts.sop` remains a bare, unversioned identifier by deliberate
  decision (ADR-0034): the `sop` component fingerprint already captures
  content changes, so a hand-maintained version would be a second, driftable
  source of truth.
- `TraceEvent.node` is typed and always `null` until M4 has workflow nodes.
- `attempt` is a plain integer everywhere (`runs`, `TraceEvent`,
  `ExecutionContext`), not an entity: `runs` has `unique (job_id, attempt)`
  and there is no `attempts` table. `AttemptId` and the other entity-id brands
  beyond `JobId`/`RunId` have no field carrying them yet.
- Tool permission enforcement in `EveAgentRuntime` is detection-and-cancel on
  the event stream, not prevention (ADR-0028). Fine for the read-only fixture
  tool; the auth-plus-approval composition is the M2/M5 upgrade.
- `EveAgentRuntime` still needs each domain's output schema at construction
  (`domains` option) because a `Job` carries only a string reference. The
  capability registry can resolve it once M5 wires that.

## What does not exist yet

- Jev, workflow IR, replay, evals, learner, compiler, and the rest of the CLI
  beyond `pnpm harness run show`.

## Known failures

- None.

## Current blockers

- None for starting M3 or M4; both are blocked only by M2, which is complete.
- **Eight M2 commits are unpushed** to `origin/main`, so CI — including the
  `supabase-types` job — has not run against any Milestone 2 change.
- `pnpm example:run` against a live Gateway model remains unverified without a
  credential.
- `.env.local` is present on this development host, so `pnpm example:run:mock`
  and `pnpm harness` need `pnpm supabase:start` first here (Docker must be
  running), or the example run exits 1 by design rather than silently falling
  back to JSONL-only.

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
  ledger and no attempts table; **ADR-0037** the run inspector is a library
  over the `Storage` port with a `parseArgs` CLI, living in
  `packages/observability`. Next free ADR number: **0038**.
- TypeScript 6.0.x until 7.1 (ADR-0019). Framework work follows
  `docs/development/source-of-truth-protocol.md`.

## Findings the next agent needs

Research: `docs/research/vercel/2026-09-19-m1-*.md` (three notes).
Architecture: `docs/architecture/runtime.md`. Contracts: `docs/contracts/`
(`identifiers.md`, `job.md`, `trace-event.md`, `harness.md`,
`behavior-fingerprint.md`, `redaction.md`, `storage.md` cover Milestone 2 in
full). Runbooks: `docs/runbooks/supabase-local.md`,
`docs/runbooks/inspecting-a-run.md`.

- **CLI mechanics**: `pnpm harness` forwards its positional arguments to the
  underlying command with no `--` separator needed (verified empirically);
  turbo's own build output is redirected to stderr so `--json` stays pipeable
  on stdout. `parseTraceEvent()` (`@internal/core`) is now the single read
  boundary for a stored, replayed or JSONL-sourced trace event, beside
  `parseJob()` and `parseRunRecord()`; the JSONL reader
  (`readJsonlTraceEvents`) lives in `@internal/trace`, beside the sinks that
  define the format, so it has exactly one owner.
- **`Storage` ordering contract**: `saveJob` and `startRun` are called before
  the first trace event; `finishRun` is called only after the trace has been
  flushed. This is what makes a crash mid-run leave an inspectable `running`
  row rather than nothing, and what stops a `completed` row from existing
  beside a trace nobody can verify.
- `startRun` is a plain insert, so a second run of the same `(job_id, attempt)`
  fails loudly on the unique constraint; trace-event inserts are `ON CONFLICT
  DO NOTHING` on `(run_id, sequence)`, first-write-wins.
- `listRuns`/`getTrace` page limits above 1000 (matching `config.toml`'s
  `max_rows`) are a `ValidationError`, not a silent truncation.
- **`jobs.job` stores the unredacted effective job, by design**: the job's
  `input` is the work itself, and a redacted job could not be replayed.
  `runs.error` and `runs.runtime_metadata` are redacted, because no writer
  chain reaches them and a serialized error's `details` is not a redaction
  boundary (ADR-0026).
- A run-scoped `createTraceRecorder()` in `@internal/core` is the single owner
  of `sequence`. A `*.started` event's own `id` is its span id (no separate
  span entity); every `run.*` event is a root with `parentId: null`.
- `EveAgentRuntime` maps eve stream events onto the closed taxonomy instead of
  emitting `eve.<type>`. Full mapping table in ADR-0031.
- `parseJob()` rejects unknown fields at the top level, in `contracts`, in
  `budget` and in a `ToolGrant`, and does not validate `input` against a
  domain's schema (it has no domain to ask).
- **`uuid` ordering was measured against the pinned local Postgres 17.6, not
  assumed**: `order by id` on a UUIDv7 column matches `order by id::text`, so
  keyset pagination on `id` is creation order.
- A trace-writer flush failure, or an unreachable/failing `Storage` call,
  propagates out of `harness.run()` as a `StorageError` rather than being
  swallowed or returned as a result.
- `harness.run()` also throws (before `run.started`, with nothing spent) when
  a domain's behavior loader throws or the descriptor it produces is invalid.
- Redaction's token format is `[REDACTED:<rule-name>]`; a rule matching a
  whole object nests the token under a `redacted` key. Inside a `headers`
  object, the header rule wins over a generic field-path rule.
- `supabase gen types` in the pinned 2.117.0 has no output-file flag, so
  `pnpm supabase:types` uses shell redirection; a failed generation truncates
  the committed `database.types.ts` — always reset before regenerating.
- eve facts carried over from M1: no in-process run API (HTTP via
  `eve/client`); `--port` skips reconnection to a recorded dev server;
  `NODE_ENV=test` makes eve mock every authored model (the helper strips it);
  `MessageResult.status` is not a discriminator, branch on turn events;
  `eve dev` runs as `node .../eve.js dev ...`, so `pgrep -f "eve dev"` never
  matches; use `pgrep -f "eve.js dev"` or check listening ports.
- `apps/*` is the only place eve may be imported outside `packages/runtime-eve`.

## Uncommitted / generated artifacts

- None after this handoff's docs commit. Ignored build outputs: `dist/`,
  `.turbo/`, `.harness/` (local JSONL traces), `.env.local`, and eve's
  `.eve/`, `.output/` under both app roots.
  `packages/storage-supabase/src/database.types.ts` is generated but **is**
  committed (never hand-edited).

## Exact next task

**Start M4 first** (the critical path: M0 -> M1 -> M2 -> M4 -> M5 -> ...),
creating `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md`
from the build plan, in the M2 status file's shape. **M3, Jev**, is blocked
only by M2 and can start beside M4 at any point (its own status file would be
`docs/milestones/m3-jev-as-a-first-class-decision-primitive.md`); the two
teams should coordinate on shared files if run concurrently. M4's own
"Parallel Work" note says runtime, validator, DSL and fixture workflow can
split after the IR is defined.

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm supabase:start && pnpm example:run:mock && pnpm harness run show <printed runId>
```

(Node 24.21.0 and pnpm 12.4.2 on PATH; see `docs/development/local-setup.md`.
Docker must be running for `pnpm supabase:start`.) Then read, in order:
`AGENTS.md`, this file, `docs/README.md`, `docs/progress/milestones/m2.md`,
`docs/contracts/README.md`, and the Milestone 4 (then Milestone 3) sections of
`docs/milestones/build-plan.md`.

## Last successful verification

- `pnpm check`: PASS, 2026-09-20, after M2-T10 (876 passed, 43 skipped, 53
  files).
- `pnpm example:run:mock`: PASS in all three storage modes (persisted,
  JSONL-only, configured-but-unreachable).
- `pnpm harness run show <run-id>`: PASS against Supabase and against a
  JSONL-only trace, 2026-09-20 (orchestrator-verified).
- `pnpm supabase:reset`: PASS, applied all five migrations from an empty
  database.
- `uuid` vs. textual UUIDv7 ordering: PASS, true against the pinned local
  Postgres 17.6.
- Row-level security: enabled on all 13 tables, verified.
- `pnpm example:run` (live model): not run, no credential.
- `eve info` (both app roots): unchanged from M1, `Compile ready`, 0 errors, 0
  warnings.
