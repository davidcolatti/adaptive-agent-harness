# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; frozen milestone
> records live in `docs/progress/milestones/`.

**Last updated:** 2026-09-20 (Milestone 4 started)
**Current milestone:** M4, Workflow IR + Local Runtime, is in progress (the
critical path). M3, Jev, remains unblocked and can start beside it at any
point; both were blocked only by M2, which is complete.
**Current task:** M4-T1 through M4-T9 are `completed`. M4-T10 (the
hand-authored vendor workflow in `apps/example-agent`) and acceptance
verification are in progress; it is the last M4 task.
**Last commit SHA:** `0d12b43` (M4-T3, T4, T5, T6, T7, T8, T9: `compileWorkflow`/
`validateWorkflow`, the typed DSL, the local runtime; ADRs 0039-0041). Earlier:
`4c03e2e` (M4-T1/M4-T2: serializable workflow IR and node contracts),
`8361a42` (M2 close-out docs), M2-T10 code: `5eaba18` (M2-T10: local run
inspector and the first harness CLI command), `ab9a374`, `1b16a1a`, `219ccbd`,
`62548d6`, `1f629bf`, `5721f7d`, `02b1261`. Run `git log --oneline`.

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
  Phase 2). Tests: 1146 passed, 43 skipped across 62 files (`unit` +
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
- Eleven workspace packages, plus two apps:
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
    `parseRunRecord`, `CreateHarnessOptions.storage`/`.target`. New in
    M4-T1/M4-T2: `WorkflowDefinition`, `WORKFLOW_SCHEMA_VERSION`,
    `FallbackReason`/`FALLBACK_REASONS`/`FallbackContext`,
    `parseWorkflowDefinition`/`isWorkflowDefinition`, `canonicalWorkflowIr`,
    `workflowFingerprint`, `WorkflowNode` (eleven node types), `Binding`
    (five-case data-flow model), `NodeId`, `RetryPolicy`, `NodeProtection`.
  - `@internal/workflow` (M4-T1, filled out in Phase 2): `CompiledWorkflow`,
    `compileWorkflow`/`validateWorkflow` (M4-T4/M4-T9), the `workflow()` typed
    DSL builder (M4-T5), `createWorkflowRuntime()` with `.asAgentRuntime()`
    (M4-T6/M4-T7/M4-T8), and three ports — `WorkflowDecisionPort` (for M3's
    `jev` nodes), `ArtifactStorePort` (for M5's `artifact` nodes) and
    `ProtectedEffectStore` (M4-T7's non-idempotent-write protection) — each
    with an in-memory default implementation. Still depends on
    `@internal/core` only; zero third-party dependencies.
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

- The workflow validator, typed DSL and local runtime now exist
  (`@internal/workflow`, Phase 2), but no human-authored workflow runs inside
  an application yet — that is M4-T10, in progress. A `jev` node cannot
  execute until M3 lands a real `DecisionEngine` (the runtime uses a fake
  `WorkflowDecisionPort` today). The local runtime deliberately builds no
  durability, and there is no router (M5) to match a job to a workflow or to
  consume a `FallbackContext` yet.
- Jev, replay, evals, learner, compiler, and the rest of the CLI beyond
  `pnpm harness run show`.

## Known failures

- None.

## Current blockers

- None for starting M3 or M4; both are blocked only by M2, which is complete.
- None from CI: all M2 commits are pushed, and the run on `fcc4176`
  (2026-09-20, `35516370487`) passed both jobs, `check` and `supabase-types`,
  the latter on its first ever execution.
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
  `packages/observability`; **ADR-0038** the workflow IR is a core contract
  (`@internal/core` declares `WorkflowDefinition` and its strict
  `parseWorkflowDefinition()` boundary) while validation, the typed DSL and
  the local runtime live in `@internal/workflow`, with node input flowing
  through a closed five-case `Binding` model rather than an expression
  language; **ADR-0039** workflow validation is a graph model with exactly
  one owner per node (successor edges vs. containment), schema compatibility
  is reference equality on `id@version` rather than structural comparison,
  and only `agent` and `call` nodes may carry tool grants; **ADR-0040** the
  local runtime interprets a `CompiledWorkflow` and nothing else, records
  node input/output into the run's existing trace (amending ADR-0031's
  identity-only payload rule for `node.*` events only), derives two
  idempotency keys (one the other's prefix) rather than the plan's one, and a
  node that exhausts its retries or hits another fallback condition
  escalates rather than fails, with `asAgentRuntime()` mapping that
  escalation to a `WorkflowError` as a stopgap until M5 gives `escalated` its
  own status; **ADR-0041** the typed DSL is a wiring front end that parses
  its own IR through `parseWorkflowDefinition()` and never resolves
  capabilities or validates the graph itself, offering grants only on
  `agent`/`call`, matching ADR-0039. Next free ADR number: **0042**, unless
  the M4-T10 hand-authored-workflow task claims it.
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
- **`parseWorkflowDefinition()` is a shape boundary only**, the workflow
  sibling of `parseJob()`: it rejects unknown fields, checks per-node
  well-formedness and deep-freezes the result, but it deliberately does not
  check that `entry` or any `next`/`cases`/`default`/`body`/`steps` target
  exists, that every node is reachable, that a cycle is a declared bounded
  loop, or that any capability reference resolves. Those are graph questions
  `compileWorkflow()` (M4-T4/M4-T9, in `@internal/workflow`) owns; a bare
  `WorkflowDefinition` carries none of those guarantees, only a
  `CompiledWorkflow` does.
- **`packages/workflow` carries the ban on the npm package named `workflow`**
  (Vercel's durable-workflow primitive), the same as `@internal/core` and
  `@internal/trace`. `@internal/workflow` is not an adapter and its local
  runtime deliberately builds no durability; see ADR-0038 for why the two are
  kept from being confused.
- **A `branch` node is pass-through**: its output is the value it routed,
  unchanged, so a node after it binds the thing being decided about rather
  than a label. The chosen `label` and `target` go only into the node's
  `node.completed` trace payload (ADR-0040), because that is the only place a
  reader needs them.
- **Only `agent` and `call` nodes may carry tool grants** (ADR-0039, stricter
  than M4-T8's literal text): a `code` node runs a registered handler, `jev`
  asks a question, `artifact` writes, and control shapes route, so a grant on
  any of them would be permission nothing reads.
- **A `{ kind: "node" }` binding is checked by dominance, not reachability**:
  node `X` must run on every path from `entry` to the binding node `N`. A
  `map` body and a `loop` body may run zero times, so both flow into their
  body *and* straight to their own `next` — a node after a `map` is never
  told that a node inside its body ran, even though it is reachable from it.
- **Every workflow needs a reachable `escalate` node, and every `branch`
  needs a `default`** (ADR-0039: "missing escalation target" from M4-T4,
  plus north-star invariant 1, "a domain can always fall back to its full
  agent").
- **`node.*` trace payloads carry input and output by design, amending
  ADR-0031's identity-only rule for `node.*` events only** (ADR-0040): a
  `node.started` payload carries the node's evaluated input, a
  `node.completed` payload carries its validated output, and redaction still
  applies because it is a `TraceWriter` decorator placed above the buffer
  (ADR-0035) — a secret in a node's input or output is stripped before
  anything is written, exactly as for a job.

## Uncommitted / generated artifacts

- None after this handoff's docs commit. Ignored build outputs: `dist/`,
  `.turbo/`, `.harness/` (local JSONL traces), `.env.local`, and eve's
  `.eve/`, `.output/` under both app roots.
  `packages/storage-supabase/src/database.types.ts` is generated but **is**
  committed (never hand-edited).

## Exact next task

Phase 1 (M4-T1, M4-T2) and Phase 2 (M4-T3 through M4-T9: the validator, the
local runtime and the typed DSL) have both landed. The M4 status file
(`docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md`)
now marks Phase 3 `in progress`: M4-T10, the hand-authored vendor workflow in
`apps/example-agent`, plus the milestone's acceptance-criteria verification —
the last M4 task. **M3, Jev**, is blocked only by M2 and can start beside M4
at any point (its own status file would be
`docs/milestones/m3-jev-as-a-first-class-decision-primitive.md`); the two
teams should coordinate on shared files if run concurrently.

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

- `pnpm check`: PASS, 2026-09-20, after Phase 2 (M4-T3 through M4-T9; 1146
  passed, 43 skipped, 62 files). Prior: PASS after M4-T1/M4-T2 (935 passed,
  43 skipped, 54 files); PASS after M2-T10 (876 passed, 43 skipped, 53
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
