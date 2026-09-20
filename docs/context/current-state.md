# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; frozen milestone
> records live in `docs/progress/milestones/`.

**Last updated:** 2026-09-20 (Milestones 3 and 5 started)
**Current milestone:** M4 is complete. **M3, Jev** and **M5, Workflow
Registry, Router, and Fallback** are both in progress, in parallel. M5 is the
critical path, whose build-plan "Blocked By" section names exactly one
dependency: M4, which is now done. M3 was blocked only by M2, also done. M5's
own `jev`-node registration boundary and Jev-dependent routing need M3 to
have landed by the time that part of M5 is reached, even though M5 does not
formally block on it.
**Current task:** Phase A, running in parallel: M3-T1, M3-T2, M3-T4, M3-T5,
M3-T6 (`m3-core`: the question contract in core, `packages/decision-jev` over
the AI SDK's `experimental_evaluate`, a fake engine in testing, and a
decision-port bridge in `packages/workflow`), and M5-T1, M5-T2 (`m5-registry`:
the registry model and compatibility selector in core, the `Storage` port
extension for workflow versions/promotions with a new migration, and the new
`packages/registry`). Later phases: `m5-router` (M5-T3 through M5-T7) and
`m3-persist` (M3-T3, M3-T7, M3-T8, M3-T9).
**Last commit SHA:** `c1572f1` (fix: inspector zero-Jev note only when no Jev call); before it `e461297` (M4-T10: hand-authored vendor-triage workflow,
fixture decision port, `--workflow` demo, and the M4 acceptance evidence).
This handoff's docs commit is `c109d0a`. Earlier M4: `0562ac8` (docs:
M4-T1..T9 in the handoff/AGENTS.md/milestone status), `0d12b43` (M4-T3
through M4-T9: validation, DSL, local runtime; ADRs 0039-0041), `4c03e2e`
(M4-T1/M4-T2: serializable workflow IR and node contracts). Earlier M2:
`8361a42`, `5eaba18`, `ab9a374`, `1b16a1a`, `219ccbd`, `62548d6`, `1f629bf`,
`5721f7d`, `02b1261`. Run `git log --oneline`.

## Completed milestones / tasks

- **Milestone 0, Repository Foundation: complete.** `docs/progress/milestones/m0.md`.
- **Milestone 1, Local Agent + Public Harness Boundary: complete.**
  `docs/progress/milestones/m1.md`.
- **Milestone 2, Job, Trace, Supabase, and Run Ledger: complete.** All eleven
  tasks done, all ten acceptance criteria verified with dated evidence.
  Snapshot: `docs/progress/milestones/m2.md`. Status file:
  `docs/milestones/m2-job-trace-supabase-and-run-ledger.md`.
- **Milestone 4, Workflow IR, DSL, and Local Deterministic Runtime:
  complete.** All ten tasks done, all eight acceptance criteria verified
  with dated evidence, including three real runs of the hand-authored
  vendor-triage workflow through `createHarness()`. Snapshot:
  `docs/progress/milestones/m4.md`. Status file:
  `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass (2026-09-20, after
  M4-T10, commit `e461297`). Tests: 1197 passed, 43 skipped across 67 files
  (`unit` + `contract` projects); the skipped tests are the Supabase legs of
  the storage and inspector contract suites, which skip without
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set.
- **`pnpm example:run:mock`** has three verified behaviors depending on
  environment: persisted (local Supabase up, `.env.local` present — writes
  the job row, a `runs` ledger row, and the trace, through a fan-out sink),
  JSONL-only (no Supabase env configured), and configured-but-unreachable
  (env set, Supabase stopped: exits 1 with a one-line message, no silent
  fallback). Every path writes a non-null `sha256:` behavior fingerprint on
  each trace event and the component digests in `run.started`.
  **`--workflow`** (or `EXAMPLE_RUN_MODE=workflow`), with an optional
  **`--vendor <name>`** (or `EXAMPLE_RUN_VENDOR`), swaps the harness's
  `AgentRuntime` for the hand-authored vendor-triage `WorkflowRuntime`
  presented via `.asAgentRuntime()`; without `--vendor` it takes the default
  vendor's `clear` route, and needs no credential in mock mode.
  **`pnpm example:run`** is the same path (with or without `--workflow`)
  against the real example agent and needs `AI_GATEWAY_API_KEY` or
  `VERCEL_OIDC_TOKEN`; it is unverified against a live model.
- **`pnpm harness run show <run-id>`** (`[--json] [--jsonl <path>]`) reads a
  run through the `Storage` port or a JSONL trace file, with no database,
  key or Docker required for the JSONL path. Displays job, route, timeline,
  tool/model/Jev calls, errors, result, cost and fingerprints from durable
  evidence alone. Now also renders a workflow run's `node.*` spans (with
  `TraceEvent.node` filled), nested agent/model/tool/decision events under
  each node span, and a `branch` node's chosen label and target — verified
  against a real persisted workflow run and against its JSONL trace; the
  inspector's remaining gaps for a workflow run are listed under "What is
  partially working" and in `docs/runbooks/inspecting-a-run.md`.
- Nine workspace packages under `packages/`, plus two apps under `apps/`
  (twelve workspace projects in total, root included, matching what
  `pnpm install` reports):
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
    `createBehaviorFingerprint`, `BehaviorDescriptor`, `Storage`,
    `RunRecord`, `RunStart`, `RunFinish`, `RunFilter`, `RunPage`, `TracePage`,
    `parseRunRecord`, `CreateHarnessOptions.storage`/`.target`, and
    (M4-T1/M4-T2) `WorkflowDefinition`, `WORKFLOW_SCHEMA_VERSION`,
    `FallbackReason`/`FALLBACK_REASONS`/`FallbackContext`,
    `parseWorkflowDefinition`/`isWorkflowDefinition`, `canonicalWorkflowIr`,
    `workflowFingerprint`, `WorkflowNode` (eleven node types), `Binding`
    (five-case data-flow model), `NodeId`, `RetryPolicy`, `NodeProtection`.
  - `@internal/workflow` (M4, complete): `CompiledWorkflow`,
    `compileWorkflow`/`validateWorkflow` (M4-T4/M4-T9), the `workflow()`
    typed DSL builder (M4-T5), `createWorkflowRuntime()` with
    `.asAgentRuntime()` (M4-T6/M4-T7/M4-T8), and three ports —
    `WorkflowDecisionPort` (for `jev` nodes, answered by M3's
    `DecisionEngine` once it exists), `ArtifactStorePort` (for `artifact`
    nodes, M5 decides durable storage) and `ProtectedEffectStore` (M4-T7's
    non-idempotent-write protection) — each with an in-memory default. Still
    depends on `@internal/core` only; zero third-party dependencies. Not an
    adapter; carries core's bans in `tests/architecture/boundaries.ts`,
    including the ban on the npm package named `workflow` (Vercel's durable
    primitive, a different thing).
  - `@internal/trace`: `TraceSink`, `createBufferedTraceWriter`, JSONL sinks
    and `readJsonlTraceEvents`, `createRedactor`/`createRedactingTraceWriter`,
    `DEFAULT_REDACTION_POLICY`, `createStorageTraceSink`,
    `createFanOutTraceSink`. Depends on `@internal/core` and Node built-ins
    only.
  - `@internal/storage-supabase`: `createSupabaseStorage()` over a pinned
    `@supabase/supabase-js@2.116.0`; depends on `@internal/core` and
    `@internal/trace`; generated `database.types.ts` (never hand-edited).
  - `@internal/observability`: `inspectRun()`, `renderRunInspection()`,
    `createJsonlTraceSource()`, the `pnpm harness` CLI entry point
    (`src/bin/harness.ts`) on Node's built-in `util.parseArgs`. Depends on
    `@internal/core`, `@internal/trace` and (through the CLI module only,
    not the library surface) `@internal/storage-supabase`. M4-T10 fixed its
    decision-identity key lookup to try `questionId` first, since a `jev`
    node names a question (M4-T2).
  - `@internal/testing`: `createFakeClock`, `createFakeAgentRuntime`,
    `createRecordingTraceWriter`, `createInMemoryStorage`, and the shared
    storage contract test suite every `Storage` implementation runs.
  - `@internal/runtime-eve`: `EveAgentRuntime` (maps eve stream events onto
    the trace taxonomy), `eveVersion`, `LOAD_SKILL_TOOL_ID`; `./testing`
    subpath with `startEveDevServer`. `--workflow`'s `agent` node runs
    through this same adapter, unchanged.
  - `@internal/runtime-ai-sdk`: dependency boundary only. Not scheduled by
    M1/M2/M4; ADR-0003 keeps eve as the default adapter.
  - `@internal/config`.
  - `apps/example-agent` (`@internal/example-agent`): eve project, domain,
    capabilities, behavior descriptor (`src/behavior.ts`), `src/run.ts`
    (`--workflow`, `--vendor`), and (M4-T10) `src/workflow/` — the
    hand-authored vendor-triage workflow, the fixture `WorkflowDecisionPort`,
    and two new deterministic handlers (`finalize-clear-triage`,
    `decide-verified-triage`). `src/capabilities.ts` registers twelve
    capabilities in total: Milestone 1's original six plus M4-T10's six
    (four schemas, two handlers). `createVendorTriageDomain({ workflowIr })`
    takes the compiled workflow's canonical IR so a `--workflow` run's
    behavior fingerprint differs from a full-agent run's in exactly its
    `workflowIr` component. Eve config lives in one place,
    `agent/lib/agent-config.ts`. `start` loads `.env.local` via
    `--env-file-if-exists=../../.env.local`.
  - `apps/eve-fixture-agent` (`@internal/eve-fixture-agent`): `mockModel`
    fixture agent for tests and the mock demo.
- Local Supabase schema: five migrations under `supabase/migrations/`,
  thirteen tables, RLS enabled on all with no policies (harness connects as
  `service_role`, which bypasses RLS). `pnpm supabase:reset` applies all five
  from an empty database; `database.types.ts` regenerated and committed,
  byte-identical across regenerations. `workflow_versions` exists only in
  its M2-T5 minimal keyed shape and stays empty until M5's registry fills it.
- Local Supabase CLI: pinned exactly at `supabase@2.117.0` in root
  `devDependencies`, driven only through `pnpm supabase:start`/`stop`/`reset`/
  `types`, never a global install. Credential capture:
  `pnpm exec supabase status -o env ... > .env.local` (git-ignored; present
  on this development host). Supabase is currently **running** on this host,
  started for the M4-T10 demo.
- Architecture boundary test: adapter-only rule for `packages/*`; `apps/*`
  may depend on `eve`, `ai`, `@ai-sdk/*` (ADR-0025); `@supabase/*`,
  `@vercel/*`, `workflow` (the npm package) adapter-only for everyone.
  `@internal/trace`, `@internal/observability` and `@internal/workflow` are
  non-adapters with core's bans; `@internal/storage-supabase` is the one
  declared adapter allowed to depend on `@supabase/*`.
- Husky hooks (with a `~/.config/husky/init.sh` PATH fix so hooks see Node 24
  rather than the host's broken Node 23); CI workflow file, including a
  `supabase-types` job (starts Supabase, resets, regenerates, diffs the
  generated file). A GitHub remote (`origin/main`) exists; CI last observed
  green on the final M2 push (`fcc4176`). The M4 commits have not yet been
  pushed.

## What is partially working

- **Escalation is not yet its own outcome.** `WorkflowRuntime.asAgentRuntime()`
  maps an `escalated` workflow result to a `FailedAgentExecution` carrying a
  `WorkflowError` whose `details.fallback` holds the whole `FallbackContext`
  as JSON — a deliberate M4 stopgap (ADR-0040). Nothing is lost, but the run
  ledger and the exit code report it as a failure: `pnpm example:run:mock --
  --workflow --vendor "Aurelia Freight"` exits 1 by design, until M5's
  router gives `escalated` its own status and actually invokes the full
  agent with the fallback envelope.
- **`jev` nodes run through a `WorkflowDecisionPort`, not Jev.** The example
  domain's `src/workflow/fixture-decision-port.ts` is a documented,
  deterministic placeholder answering the workflow's two questions from
  frozen fixture evidence; it is not Jev and does not approximate it. It is
  deleted once M3 lands a real `DecisionEngine`-backed port; nothing in the
  workflow definition changes when that happens.
- **The inspector predates workflows in four ways**, all recorded in
  `docs/runbooks/inspecting-a-run.md`: the Route section always prints the
  M2 placeholder `route: full-agent`, even for a workflow run (it reads
  `runs.workflow_version_id`, still an M5 placeholder); `fallbacks:` reads
  `0` from the ledger even for a run that escalated (`runs.fallback_count`
  is also a placeholder); a node id is visible only via the payload's
  `nodeId`, not a dedicated column; and the "jev: 0 is a real measurement…
  until M3" note prints even on a run that made Jev calls.
- **`ArtifactStorePort` is in-memory only**, and an `artifact` node's output
  id is a plain string with no durable meaning yet; where an artifact is
  actually stored is M5's decision.
- **The local workflow runtime builds no durability**, deliberately (M4-T6):
  a node result lives in run state, the returned `WorkflowRunResult`, and
  the trace, and nowhere else.
- **Run output is not persisted.** The `runs` ledger records status, success,
  cost, latency, call counts and error, but a job's actual output value lives
  nowhere durable. M6 (replay) and M7 (evals) will need it; the `artifacts`
  table exists only in its minimal keyed shape.
- `quality_score`, `human_review`, `workflow_version_id` and `fallback_count`
  on `runs` are still placeholders. `jev_calls` is a real, non-placeholder
  count as of M4 (a workflow run's Jev calls are counted), even though the
  engine behind them is the fixture port, not Jev itself.
- `contracts.sop` remains a bare, unversioned identifier by deliberate
  decision (ADR-0034): the `sop` component fingerprint already captures
  content changes, so a hand-maintained version would be a second, driftable
  source of truth.
- `attempt` is a plain integer everywhere (`runs`, `TraceEvent`,
  `ExecutionContext`), not an entity: `runs` has `unique (job_id, attempt)`
  and there is no `attempts` table. `AttemptId` and the other entity-id brands
  beyond `JobId`/`RunId` have no field carrying them yet.
- Tool permission enforcement in `EveAgentRuntime` is detection-and-cancel on
  the event stream, not prevention (ADR-0028). Fine for the read-only fixture
  tool; the auth-plus-approval composition is a later upgrade.
- `EveAgentRuntime` still needs each domain's output schema at construction
  (`domains` option) because a `Job` carries only a string reference. The
  capability registry can resolve it once M5 wires that.

## What does not exist yet

- **The router.** `harness.run()` still drives exactly one `AgentRuntime`; a
  workflow is exercised in M4 only by explicitly presenting it as one via
  `asAgentRuntime()`. There is no code that decides, given a job, whether to
  run the workflow or the full agent — that is all of M5.
- **Workflow registry rows.** `workflow_versions` exists as a table but has
  no rows and no writer; nothing registers a compiled workflow's statuses
  (`draft`/`candidate`/`shadow`/`canary`/`active`/`retired`/`rejected`) yet.
- **A real Jev decision engine.** M3 owns the question contract, the
  `DecisionEngine` interface, confidence bands, and the `verify` primitive;
  none of it exists. Every `jev` node in M4 runs through a fixture.
- Replay, evals, learner, compiler, and the rest of the CLI beyond
  `pnpm harness run show`.

## Known failures

- None.

## Current blockers

- None for starting M3 or M5; M3 was blocked only by M2 (complete), and M5's
  build-plan "Blocked By" names only M4 (also complete).
- None from CI on pushed history: the last push (M2's `fcc4176`) was green on
  both jobs. The M4 commits (`4c03e2e`, `0d12b43`, `0562ac8`, `e461297`) have
  not been pushed, so CI has not yet observed them.
- `pnpm example:run` and `pnpm example:run -- --workflow` against a live
  Gateway model remain unverified without a credential.
- `.env.local` is present on this development host, so `pnpm example:run:mock`
  and `pnpm harness` need `pnpm supabase:start` first (Docker must be
  running) — already done and left running as of this handoff — or the
  example run exits 1 by design rather than silently falling back to
  JSONL-only.

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
  one owner per node (successor edges vs. containment), any cycle is
  invalid, schema compatibility is reference equality on `id@version`
  rather than structural comparison, and only `agent` and `call` nodes may
  carry tool grants; **ADR-0040** the local runtime interprets a
  `CompiledWorkflow` and nothing else, records node input/output into the
  run's existing trace (amending ADR-0031's identity-only payload rule for
  `node.*` events only), derives two idempotency keys (one the other's
  prefix) rather than the plan's one, and a node that exhausts its retries
  or hits another fallback condition escalates rather than fails, with
  `asAgentRuntime()` mapping that escalation to a `WorkflowError` as a
  stopgap until M5 gives `escalated` its own status; **ADR-0041** the typed
  DSL is a wiring front end that parses its own IR through
  `parseWorkflowDefinition()` and never resolves capabilities or validates
  the graph itself, offering grants only on `agent`/`call`, matching
  ADR-0039. Next free ADR number: **0042**.
- TypeScript 6.0.x until 7.1 (ADR-0019). Framework work follows
  `docs/development/source-of-truth-protocol.md`.

## Findings the next agent needs

Research: `docs/research/vercel/2026-09-19-m1-*.md` (three notes).
Architecture: `docs/architecture/runtime.md`,
`docs/architecture/workflow-runtime.md`. Contracts: `docs/contracts/`
(`identifiers.md`, `job.md`, `trace-event.md`, `harness.md`,
`behavior-fingerprint.md`, `redaction.md`, `storage.md` cover Milestone 2;
`workflow-ir.md`, `workflow-dsl.md` cover Milestone 4). Runbooks:
`docs/runbooks/supabase-local.md`, `docs/runbooks/inspecting-a-run.md`.

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
- **The workflow runtime is exposed to the harness through
  `WorkflowRuntime.asAgentRuntime()`**, not a new harness API: `createHarness()`
  runs one `AgentRuntime` either way, so trace, storage and
  `pnpm harness run show` all work unchanged whether the runtime underneath
  is `EveAgentRuntime` or a compiled workflow. M5's router replaces the
  escalated-to-failed mapping that stopgap carries; it does not replace this
  presentation mechanism.
- **The `research` agent node binds `{ kind: "input" }`, not its
  predecessor's output**, because it runs the registered
  `vendor-triage-agent@1.0.0` capability, whose manifest entry declares both
  its own `inputSchema`/`outputSchema`, and ADR-0039's schema-compatibility
  rule requires a node's declared schemas to equal what its resolved
  capability declares. Binding anything else would fail compilation, not
  just be a stylistic choice.
- **`--workflow` uses the same `EveAgentRuntime` the plain agent path uses**,
  unchanged since M1-T6: the workflow's one `agent` node is handed that
  adapter directly, so `--mock --workflow` needs no credential for the same
  reason `--mock` alone doesn't.
- **Supabase is currently running on this host**, started for the M4-T10
  demo and left running; `pnpm supabase:stop` if a clean slate is wanted
  before continuing.

## Uncommitted / generated artifacts

- None after this handoff's docs commit. Ignored build outputs: `dist/`,
  `.turbo/`, `.harness/` (local JSONL traces), `.env.local`, and eve's
  `.eve/`, `.output/` under both app roots.
  `packages/storage-supabase/src/database.types.ts` is generated but **is**
  committed (never hand-edited).

## Exact next task

Both status files now exist —
`docs/milestones/m3-jev-as-a-first-class-decision-primitive.md` and
`docs/milestones/m5-workflow-registry-router-and-fallback.md` — and Phase A is
in progress: M3-T1/T2/T4/T5/T6 and M5-T1/T2, in parallel, per "Current task"
above. M3-T3 is sequenced to start only after M5-T1/T2 land, since both touch
the `Storage` port and a migration. After Phase A, `m5-router` (M5-T3 through
M5-T7) and `m3-persist` (M3-T3, M3-T7, M3-T8, M3-T9) are next. Coordinate on
shared files (`AGENTS.md`, `docs/context/current-state.md`,
`docs/milestones/README.md`) the way M3 and M4 were meant to.

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm supabase:start && pnpm example:run:mock -- --workflow && pnpm harness run show <printed runId>
```

(Node 24.21.0 and pnpm 12.4.2 on PATH; see `docs/development/local-setup.md`.
Docker must be running for `pnpm supabase:start`; Supabase may already be up
on this host, see "Current blockers".) Then read, in order: `AGENTS.md`, this
file, `docs/README.md`, `docs/progress/milestones/m4.md`,
`docs/contracts/README.md`, and the Milestone 5 (then Milestone 3) sections of
`docs/milestones/build-plan.md`.

## Last successful verification

- `pnpm check`: PASS, 2026-09-20, on commit `e461297` after M4-T10 (1197
  passed, 43 skipped, 67 files). Prior: PASS after M4-T3..T9 (1146 passed,
  43 skipped, 62 files); PASS after M4-T1/M4-T2 (935 passed, 43 skipped, 54
  files); PASS after M2-T10 (876 passed, 43 skipped, 53 files).
- `pnpm example:run:mock -- --workflow` (no vendor, `clear` route): PASS,
  exit 0, run `01a0bfa7-4484-7000-9060-dcba9756a378`.
- `pnpm example:run:mock -- --workflow --vendor "Tessellate Analytics"`
  (`research` route): PASS, exit 0, run `01a0bfa7-71aa-7001-8d36-e62ee08c5bae`;
  re-verified independently by the orchestrator as run
  `01a0bfaf-ffd5-7001-b493-9662ef3e9035`, persisted to local Supabase, 20
  trace events, rendered correctly by `pnpm harness run show` (node spans,
  branch label/target, nested agent/model events, both Jev calls).
- `pnpm example:run:mock -- --workflow --vendor "Aurelia Freight"`
  (escalation): PASS as designed, exit 1, run
  `01a0bfa7-9ce9-7001-8075-74110e84dce6`.
- `pnpm example:run:mock` with no flags (full-agent path, unchanged): PASS,
  exit 0, run `01a0bfad-b44f-7001-afd1-cfa5aafa72ac`.
- `pnpm harness run show <run-id>` and `... --jsonl <path>`: PASS against
  Supabase and against JSONL-only traces, for both agent and workflow runs.
- `pnpm supabase:reset`: PASS, applied all five migrations from an empty
  database.
- `uuid` vs. textual UUIDv7 ordering: PASS, true against the pinned local
  Postgres 17.6.
- Row-level security: enabled on all 13 tables, verified.
- `pnpm example:run` and `pnpm example:run -- --workflow` (live model): not
  run, no credential.
- `eve info` (both app roots): unchanged from M1, `Compile ready`, 0 errors, 0
  warnings; not re-run for M4-T10 since nothing under `agent/` was touched.
