# Current state

> Concise, present-tense handoff. Rewritten (not appended) at the end of every
> session. History lives in `docs/progress/WORKLOG.md`; frozen milestone
> records live in `docs/progress/milestones/`.

**Last updated:** 2026-09-21 (Milestones 3, 4 and 5 complete)
**Current milestone:** M3, M4 and M5 are all complete. Next is **M6, Replay
and Evaluation** (the critical path), whose build-plan "Blocked By" section
names exactly one dependency: M5, which is now done.
**Current task:** Not started. First create the M6 status file from
`docs/milestones/build-plan.md`, in the M5 status file's shape
(`docs/milestones/m5-workflow-registry-router-and-fallback.md`).
**Last commit SHA:** `17c88cd` (Phase B: M5-T3 through M5-T7 — router, typed
fallback, full-agent escalation, circuit breaker; M3-T3/T7/T8/T9 — decision
persistence, `verify`, fixtures, calibration; ADR-0044, ADR-0045). This
handoff's own docs commit follows it. Earlier: `df0de79` (Phase A: M3-T1/T2/
T4/T5/T6, M5-T1/T2; ADR-0042, ADR-0043). Earlier M4: `c1572f1`, `bb90607`/
`c109d0a` (M4 close-out docs), `e461297` (M4-T10), `0562ac8`, `0d12b43`
(ADRs 0039-0041), `4c03e2e` (M4-T1/M4-T2). Earlier M2: `8361a42`, `5eaba18`,
`ab9a374`, `1b16a1a`, `219ccbd`, `62548d6`, `1f629bf`, `5721f7d`, `02b1261`.
Run `git log --oneline`.

## Completed milestones / tasks

- **Milestone 0, Repository Foundation: complete.** `docs/progress/milestones/m0.md`.
- **Milestone 1, Local Agent + Public Harness Boundary: complete.**
  `docs/progress/milestones/m1.md`.
- **Milestone 2, Job, Trace, Supabase, and Run Ledger: complete.** All eleven
  tasks done, all ten acceptance criteria verified with dated evidence.
  Snapshot: `docs/progress/milestones/m2.md`. Status file:
  `docs/milestones/m2-job-trace-supabase-and-run-ledger.md`.
- **Milestone 3, Jev as a First-Class Decision Primitive: complete.** All
  nine tasks done, all seven acceptance criteria verified with dated
  evidence. Snapshot: `docs/progress/milestones/m3.md`. Status file:
  `docs/milestones/m3-jev-as-a-first-class-decision-primitive.md`.
- **Milestone 4, Workflow IR, DSL, and Local Deterministic Runtime:
  complete.** All ten tasks done, all eight acceptance criteria verified
  with dated evidence. Snapshot: `docs/progress/milestones/m4.md`. Status
  file: `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md`.
- **Milestone 5, Workflow Registry, Router, and Fallback: complete.** All
  seven tasks done, all six acceptance criteria verified with dated
  evidence, including three real runs of the same command through
  `createRouter()` taking the workflow, the fallback, and the direct
  full-agent path. Snapshot: `docs/progress/milestones/m5.md`. Status file:
  `docs/milestones/m5-workflow-registry-router-and-fallback.md`.

## What works now

- `pnpm install --frozen-lockfile` and `pnpm check` pass (2026-09-21, on
  commit `17c88cd`, after Phase B). Tests: 1491 passed, 68 skipped across 82
  files with no Supabase env; 1570 passed, 3 skipped with `.env.local`
  exported (the three remaining skips are `@internal/decision-jev`'s and the
  example's `live:jev`-tagged integration tests, unrun for lack of a model
  credential on this host).
- **`pnpm example:run:mock -- --workflow`**, with an optional
  **`--vendor <name>`**, now runs through `createRouter()`
  (`@internal/registry`), which **is** an `AgentRuntime`: the same command,
  varying only its input, takes the compiled-workflow path, the
  escalate-and-fall-back-to-the-full-agent path, or (with
  **`--no-register-workflow`**) the direct full-agent path, all exiting 0.
  Every workflow run writes real `runs.workflow_version_id`,
  `runs.fallback_count` and `runs.jev_calls` (all three previously
  placeholders or wrong; `jev_calls` is counted at the engine call site, so
  a call that throws still counts). **`pnpm example:run`** is the same paths
  against the real example agent and needs `AI_GATEWAY_API_KEY` or
  `VERCEL_OIDC_TOKEN`; unverified against a live model.
- **`pnpm harness run show <run-id>`** reads a run through the `Storage`
  port or a JSONL trace file. Displays job, route, timeline, tool/model/Jev
  calls, errors, result, cost and fingerprints. Renders workflow `node.*`
  spans, nested agent/model/tool/decision events, a `branch`'s label/target,
  and now a real `jev_calls` count matching the trace's `decision.*` events.
  The Route line prints a real `workflow_version_id` (no inspector change
  needed — M5-T3 wrote it as a ledger column), though not yet a
  human-readable workflow key; see "What is partially working".
- **`pnpm --filter @internal/example-agent run calibrate`**: runs sixteen
  labeled cases through the vendor triage decision layer and prints a
  report (accuracy, uncertain-band rate, false-auto rate, fallback rate,
  confusion matrix where applicable).
- Eleven workspace packages under `packages/`, plus two apps under `apps/`
  (fourteen workspace projects in total, root included, matching what
  `pnpm install` reports):
  - `@internal/core` (zero third-party deps; `node:crypto` only): the M1/M2
    surface (JSON model, `deepFreeze`, ids, `ExecutionContext`, the closed
    trace taxonomy, error taxonomy, `Schema`, `Job`, `DomainDefinition`,
    `AgentRuntime`, `createHarness`, capability registry, `canonicalJson`/
    `fingerprint`, `BehaviorDescriptor`, `Storage`); M4's `workflow-ir.ts`/
    `workflow-nodes.ts` (`WorkflowDefinition`, `WorkflowNode`, `Binding`,
    `FallbackContext`, `parseWorkflowDefinition`); and, new since M4,
    `decision.ts` (the question contract, `DecisionEngine`, `DecisionResult`,
    `deriveConfidence`, `bandFor`, `Policy`, `definePolicy`,
    `policyFingerprint`), `decision-record.ts` (`DecisionRecord`,
    `parseDecisionRecord`, `replayDecisions`), `verify.ts`
    (`compileVerification`, `readVerification`), and `workflow-registry.ts`
    (`WORKFLOW_STATUSES`, `canTransition`, `WorkflowCompatibility`,
    `describeWorkflowCompatibility`, `selectCompatibleWorkflow`). `Storage`
    now has sixteen methods total: the original eight, six workflow-registry
    methods (`saveWorkflow`, `saveWorkflowVersion`, `getWorkflowVersion`,
    `listWorkflowVersions`, `setWorkflowVersionStatus`,
    `listWorkflowPromotions`), and two decision methods (`saveDecision`,
    `listDecisions`).
  - `@internal/workflow`: `CompiledWorkflow`, `compileWorkflow`/
    `validateWorkflow`, the `workflow()` typed DSL, `createWorkflowRuntime()`
    with `.asAgentRuntime()`, `createDecisionPort()` (a real bridge from a
    `DecisionEngine` to `WorkflowDecisionPort`, with persistence via
    `Storage.saveDecision()`), and three ports (`WorkflowDecisionPort`,
    `ArtifactStorePort`, `ProtectedEffectStore`) each with an in-memory
    default. `FallbackContext.completedNodes[]` now carries `output` inline
    (not just `outputRef`), capped at 64 KiB total. Zero third-party
    dependencies; not an adapter.
  - `@internal/decision-jev`: `createJevDecisionEngine()`, a `DecisionEngine`
    over the AI SDK's `experimental_evaluate` against `typesafe-ai/jev`
    (`JEV_GATEWAY_MODEL_ID`) via AI Gateway — the only place
    `experimental_evaluate` is imported. Emits no trace events of its own.
    A declared adapter; its live integration test is tagged `live:jev`.
  - `@internal/registry`: `createWorkflowRegistry()` (`register`/`promote`/
    `retire`/`findActive`/`resolve`, over the `Storage` port),
    `createRouter()` (an `AgentRuntime` plus `route(job)`: resolves per run,
    compiles per version with caching, runs the matched workflow, and on
    escalation invokes the full agent with the fallback envelope and a
    recalculated budget), and `createCircuitBreaker()` (`evaluate(versionId)`
    over the last N finished runs; `trip()` retires a version through the
    registry). Depends on `@internal/core` for the pure model and the
    `Storage` port for persistence; not an adapter itself.
  - `@internal/trace`, `@internal/storage-supabase`, `@internal/observability`,
    `@internal/testing` (now also `createFakeDecisionEngine()`),
    `@internal/runtime-eve` (now also sends a `harness.fallback` key in
    `clientContext` when an escalation hands a job to the full agent),
    `@internal/runtime-ai-sdk`, `@internal/config`: unchanged in surface
    since M4 except as noted.
  - `apps/example-agent`: eve project, domain, capabilities, behavior
    descriptor, `src/run.ts` (`--workflow`, `--vendor`,
    `--no-register-workflow`), `src/workflow/` (the hand-authored
    vendor-triage workflow, now branching on a policy's `route` rather than
    a raw category), and `src/decisions/` (the three registered questions as
    one bundle, `vendor-triage.classify@1.0.0`; a versioned policy; a
    credential-selected engine; the calibration fixture).
    `src/capabilities.ts` registers twelve capabilities (Milestone 1's six
    plus M4-T10's six); `createVendorTriageDomain({ workflowIr })` makes a
    `--workflow` run's behavior fingerprint differ from a full-agent run's
    in exactly its `workflowIr` component.
  - `apps/eve-fixture-agent`: `mockModel` fixture agent for tests and demos.
- Local Supabase schema: seven migrations under `supabase/migrations/`
  (M5-T1's `20260920202604_workflow_registry_columns.sql` and M3-T3's
  `20260920205520_decisions_columns.sql` fill the last two M2-T5
  placeholders), thirteen tables, RLS enabled on all with no policies.
  `pnpm supabase:reset` applies all seven from an empty database;
  `database.types.ts` regenerated and committed. `workflow_versions` now has
  real rows: the example's `--workflow` path registers and idempotently
  promotes the compiled workflow on its IR fingerprint every run.
- Local Supabase CLI: pinned exactly at `supabase@2.117.0`, driven only
  through `pnpm supabase:*`. Supabase is currently **running** on this host.
- Architecture boundary test: adapter-only rule for `packages/*`; `apps/*`
  may depend on `eve`, `ai`, `@ai-sdk/*` (ADR-0025); `@supabase/*`,
  `@vercel/*`, `workflow` (the npm package) adapter-only for everyone.
  `@internal/trace`, `@internal/observability`, `@internal/workflow` and
  `@internal/registry` are non-adapters with core's bans;
  `@internal/storage-supabase` and `@internal/decision-jev` are the two
  declared adapters allowed to depend on `@supabase/*`/`ai`'s evaluation
  surface respectively.
- Husky hooks, CI workflow file (including `supabase-types`). A GitHub
  remote (`origin/main`) exists; CI last observed green on the final M2 push
  (`fcc4176`). No M3/M4/M5 commit has been pushed yet.

## What is partially working

- **Live Jev is unverified.** No `AI_GATEWAY_API_KEY`/`VERCEL_OIDC_TOKEN` on
  this host. Every decision test in the repository runs against
  `createFakeDecisionEngine()` or the AI SDK's own mock model double; the
  fixture engine is the default in the example, selected automatically when
  no credential exists.
- **`verify` is a core primitive, not wired into a workflow.** `verify.ts`'s
  acceptance criterion is satisfied standalone; feeding a field's repair
  instructions back into the same logical agent task needs a node type that
  re-enters a node with a repaired input, which the IR does not express
  today. Left for M6.
- **`pnpm harness workflow list` does not exist.** `Storage.listWorkflowVersions()`
  is there and tested, but the CLI needs a new parsed command, filter flags
  and a renderer, which the task made conditional on being a small addition
  and it was not.
- **A workflow version's status change and its promotion-ledger row are two
  PostgREST statements, not one transaction** (ADR-0043): the status update
  and the `workflow_promotions` insert cannot be wrapped together, so the
  residual failure mode is a status change whose ledger row never gets
  written.
- **`shadow` and `canary` are legal `WorkflowStatus` values that never route
  traffic.** `selectCompatibleWorkflow()` refuses every non-`active` version
  with `not-active`; only `active` serves a job. A shadow/canary rollout
  policy does not exist.
- **The inspector's Route line prints a real `workflow_version_id`, but not
  a human-readable workflow key** (a name or slug), and the `pnpm harness run
  show` output still requires a second lookup to know which workflow that
  version belongs to. `docs/runbooks/inspecting-a-run.md` records the gap.
- **`ArtifactStorePort` is in-memory only**, and an `artifact` node's output
  id is a plain string with no durable meaning yet; where an artifact is
  actually stored remains undecided.
- **The local workflow runtime builds no durability**, deliberately (M4-T6):
  a node result lives in run state, the returned `WorkflowRunResult`, and
  the trace, and nowhere else.
- **Run output is not persisted.** The `runs` ledger records status,
  success, cost, latency, call counts and error, but a job's actual output
  value lives nowhere durable. The `artifacts` table exists only in its
  minimal keyed shape.
- `quality_score` and `human_review` on `runs` remain placeholders, filled
  by M6/M7. `workflow_version_id`, `fallback_count` and `jev_calls` are now
  all real, wired columns (closed this milestone).
- `contracts.sop` remains a bare, unversioned identifier by deliberate
  decision (ADR-0034).
- `attempt` is a plain integer everywhere, not an entity; `AttemptId` has no
  field carrying it yet.
- Tool permission enforcement in `EveAgentRuntime` is detection-and-cancel
  on the event stream, not prevention (ADR-0028).
- `EveAgentRuntime` still needs each domain's output schema at construction
  because a `Job` carries only a string reference.

## What does not exist yet

- Replay (`packages/replay`), evals (`packages/evals`), the learner, the
  compiler, codegen, and any promotion policy beyond the registry's manual
  `promote`/`retire`/`trip`. All of Milestone 6 onward.
- The rest of the CLI beyond `pnpm harness run show` (notably
  `pnpm harness workflow list`, see "What is partially working").

## Known failures

- None.

## Current blockers

- None for starting M6; its build-plan "Blocked By" names only M5, which is
  complete.
- None from CI on pushed history: the last push (M2's `fcc4176`) was green
  on both jobs. No M3/M4/M5 commit has been pushed, so CI has not yet
  observed any of them.
- `pnpm example:run` and its `--workflow` variants against a live Gateway
  model remain unverified without a credential.
- `.env.local` is present on this development host, so `pnpm example:run:mock`
  and `pnpm harness` need `pnpm supabase:start` first — already done and
  left running as of this handoff — or the example run exits 1 by design
  rather than silently falling back to JSONL-only.

## Important active decisions

- ADR-0001..0017 plan; ADR-0018..0023 toolchain; **ADR-0024** framework
  pins; **ADR-0025** apps author eve agents; **ADR-0026** trace-safe errors;
  **ADR-0027** Standard Schema as schema contract; **ADR-0028** URL-only eve
  adapter observing the `eve/client` stream (amends ADR-0012); **ADR-0029**
  canonical JSON + `sha256:` fingerprints; **ADR-0030** sortable UUIDv7
  entity identifiers; **ADR-0031** trace event taxonomy, recorder-owned
  sequencing, and the buffered writer; **ADR-0032** jobs are deeply
  immutable and the effective job is the job; **ADR-0033** the Supabase CLI
  is a pinned dev dependency and `db reset` is the reproducibility gate;
  **ADR-0034** the behavior fingerprint is component-wise and
  domain-supplied; **ADR-0035** redaction is a `TraceWriter` decorator
  placed before buffering; **ADR-0036** `Storage` is a core port over a
  Supabase schema, with `runs` as the outcome ledger and no attempts table;
  **ADR-0037** the run inspector is a library over the `Storage` port with a
  `parseArgs` CLI; **ADR-0038** the workflow IR is a core contract while
  validation, the typed DSL and the local runtime live in
  `@internal/workflow`, with node input flowing through a closed five-case
  `Binding` model; **ADR-0039** workflow validation is a graph model with
  exactly one owner per node, any cycle is invalid, schema compatibility is
  reference equality on `id@version`, and only `agent`/`call` nodes may
  carry tool grants; **ADR-0040** the local runtime interprets a
  `CompiledWorkflow` and nothing else, records node input/output into the
  run's trace (amending ADR-0031 for `node.*` events only), derives two
  idempotency keys, and a node that exhausts its retries escalates rather
  than fails; **ADR-0041** the typed DSL is a wiring front end that parses
  its own IR and never resolves capabilities or validates the graph itself;
  **ADR-0042** the decision contract (`Question`, `DecisionEngine`,
  `DecisionResult`, `Policy`) is a dependency-free core contract, and the AI
  SDK's experimental evaluation API is isolated entirely inside
  `@internal/decision-jev`; **ADR-0043** the workflow registry is a pure
  status model in core (seven statuses, a transition table,
  `selectCompatibleWorkflow()` with nine ordered rejection reasons) with the
  one impure step, the `Storage` lookup, kept in `@internal/registry`, and
  compatibility checked by exact reference equality, never by name;
  **ADR-0044** the router is an `AgentRuntime` and a fallback envelope
  travels through `ExecutionContext.fallback` and eve's documented
  turn-scoped `clientContext`, with the plan's eight `FallbackReason`s
  replacing M4's six; **ADR-0045** decision evidence is one `DecisionRecord`
  with the raw result and the policy outcome as separate fields of the same
  row, and `replayDecisions()` takes no engine parameter. Next free ADR
  number: **0046**.
- TypeScript 6.0.x until 7.1 (ADR-0019). Framework work follows
  `docs/development/source-of-truth-protocol.md`.

## Findings the next agent needs

Research: `docs/research/vercel/2026-09-19-m1-*.md` (three notes),
`docs/research/vercel/2026-09-20-m3-ai-sdk-evaluate.md`,
`docs/research/vercel/2026-09-20-m5-eve-client-context-for-fallback.md`.
Architecture: `docs/architecture/runtime.md`,
`docs/architecture/workflow-runtime.md`. Contracts: `docs/contracts/`
(`identifiers.md`, `job.md`, `trace-event.md`, `harness.md`,
`behavior-fingerprint.md`, `redaction.md`, `storage.md` cover Milestone 2;
`workflow-ir.md`, `workflow-dsl.md` cover Milestone 4;
`decision-engine.md`, `workflow-registry.md` cover Milestones 3/5).
Runbooks: `docs/runbooks/supabase-local.md`, `docs/runbooks/inspecting-a-run.md`.

- **CLI mechanics**: `pnpm harness` forwards its positional arguments to the
  underlying command with no `--` separator needed; turbo's own build
  output is redirected to stderr so `--json` stays pipeable on stdout.
  `parseTraceEvent()` (`@internal/core`) is the single read boundary for a
  stored, replayed or JSONL-sourced trace event, beside `parseJob()` and
  `parseRunRecord()`.
- **`Storage` ordering contract**: `saveJob` and `startRun` run before the
  first trace event; `finishRun` runs only after the trace has flushed.
- `startRun` is a plain insert, so a second run of the same
  `(job_id, attempt)` fails loudly on the unique constraint; trace-event
  inserts are `ON CONFLICT DO NOTHING` on `(run_id, sequence)`.
- **`jobs.job` stores the unredacted effective job, by design**;
  `runs.error` and `runs.runtime_metadata` are redacted.
- A run-scoped `createTraceRecorder()` is the single owner of `sequence`. A
  `*.started` event's own `id` is its span id; every `run.*` event is a
  root with `parentId: null`.
- `EveAgentRuntime` maps eve stream events onto the closed taxonomy instead
  of emitting `eve.<type>`. Full mapping table in ADR-0031.
- `parseJob()` rejects unknown fields at the top level, in `contracts`, in
  `budget` and in a `ToolGrant`.
- **`uuid` ordering was measured against the pinned local Postgres 17.6**:
  `order by id` on a UUIDv7 column matches `order by id::text`.
- A trace-writer flush failure, or an unreachable/failing `Storage` call,
  propagates out of `harness.run()` as a `StorageError`.
- Redaction's token format is `[REDACTED:<rule-name>]`.
- `supabase gen types` in the pinned 2.117.0 has no output-file flag, so
  `pnpm supabase:types` uses shell redirection.
- eve facts carried over from M1: no in-process run API (HTTP via
  `eve/client`); `--port` skips reconnection to a recorded dev server;
  `NODE_ENV=test` makes eve mock every authored model; `MessageResult.status`
  is not a discriminator, branch on turn events; `eve dev` runs as
  `node .../eve.js dev ...`, so `pgrep -f "eve dev"` never matches.
- `apps/*` is the only place eve may be imported outside `packages/runtime-eve`.
- **`parseWorkflowDefinition()` is a shape boundary only**; graph questions
  (reachability, cycles, capability resolution) belong to `compileWorkflow()`.
  A bare `WorkflowDefinition` carries none of those guarantees, only a
  `CompiledWorkflow` does.
- **`packages/workflow` carries the ban on the npm package named
  `workflow`** (Vercel's durable primitive, a different thing).
- **A `branch` node is pass-through**: its output is the value it routed,
  unchanged; the chosen `label`/`target` go only into `node.completed`'s
  trace payload.
- **Only `agent` and `call` nodes may carry tool grants** (ADR-0039).
- **A `{ kind: "node" }` binding is checked by dominance, not
  reachability**: a `map`/`loop` body may run zero times, so both flow into
  their body *and* straight to their own `next`.
- **Every workflow needs a reachable `escalate` node, and every `branch`
  needs a `default`** (ADR-0039, north-star invariant 1).
- **`node.*` trace payloads carry input and output by design** (ADR-0040,
  amending ADR-0031 for `node.*` only); redaction still applies.
- **The workflow runtime is exposed to the harness through
  `WorkflowRuntime.asAgentRuntime()`**, and the router wraps a workflow the
  same way: `createHarness()` runs one `AgentRuntime` in every case, so
  trace, storage and `pnpm harness run show` work unchanged regardless of
  what is underneath.
- **The `research` agent node binds `{ kind: "input" }`, not its
  predecessor's output**, because the registered agent capability declares
  both its own schemas and ADR-0039 requires a node's declared schemas to
  equal what its resolved capability declares.
- **`--workflow` uses the same `EveAgentRuntime` the plain agent path
  uses**, so `--mock --workflow` needs no credential.
- **Supabase is currently running on this host**, left running since the
  M4-T10 demo; `pnpm supabase:stop` for a clean slate.
- **The AI SDK evaluation API exposes no portable confidence and no cost.**
  `deriveConfidence()` is a harness-owned derivation, per kind: for
  `boolean`, the probability mass on the side answered; for `choice`, the
  chosen option's own probability; for `score`, the mass within half a
  rubric level of the answer. `DecisionUsage.costUsd` is always `null`.
- **The decision engine emits no trace events of its own.** The workflow
  runtime's `jev` node execution already opens the `decision.started` span
  and closes it; a `DecisionEngine` implementation and `createDecisionPort()`
  are contractually forbidden from emitting a second pair.
- **Banding fails closed, and the two failure cases look the same from the
  band alone.** `bandFor()`/`bandForConfidence()` return `human-review` both
  when confidence is `null` (or not a valid probability) **and** when a
  question has no configured bands at all, so "uncalibrated" and
  "calibrated but uncertain" arrive at the same band. A policy that needs to
  tell them apart, to raise `low_confidence` specifically, has to inspect
  `question.bands` itself rather than read the band.
- **The registry's tie-break, when more than one `active` version matches a
  job, is the newest version id** (a sortable UUIDv7, so also newest by
  creation time).
- **`FallbackContext.completedNodes[].output` carries every listed node's
  validated output inline, not only a reference**, capped at
  `FALLBACK_ENVELOPE_MAX_BYTES` (64 KiB total); `trusted` governs how a
  value may be used, not whether it is shown, so an untrusted `agent` node's
  output is present specifically so the full agent can reuse the expensive
  work. Over budget, the largest outputs drop to `null` first; `outputRef`
  and `trusted` survive every drop, and the envelope's `detail` names what
  was dropped.
- **`FallbackReason` is now the build plan's eight**
  (`low_confidence | unsupported_case | missing_evidence | budget |
  tool_failure | schema_mismatch | policy | workflow_error`), and
  `low_confidence`/`missing_evidence` are deliberately **unreachable from
  the interpreter** — they are policy outcomes M3's layer raises on a
  judgment whose confidence falls below its band, not runtime failures.
- **`runs.jev_calls` is now a real measurement**, incremented immediately
  before `decisionEngine.decide()` so a call that throws still counts. The
  column's own SQL comment still calls it a placeholder because migrations
  are append-only and are never hand-edited after the fact;
  `docs/contracts/storage.md` is the corrected authority.
- **The router re-resolves the active version on every run, with no routing
  cache**, which is what makes retiring an active workflow take effect
  immediately: there is nothing to invalidate.

## Uncommitted / generated artifacts

- None after this handoff's docs commit. Ignored build outputs: `dist/`,
  `.turbo/`, `.harness/` (local JSONL traces), `.env.local`, and eve's
  `.eve/`, `.output/` under both app roots.
  `packages/storage-supabase/src/database.types.ts` is generated but **is**
  committed (never hand-edited).

## Exact next task

Milestones 3, 4 and 5 are all complete and closed out. The next task is
creating the status file for **M6, Replay and Evaluation**
(`docs/milestones/m6-replay-and-evaluation.md`), from
`docs/milestones/build-plan.md`, in the M5 status file's shape. M6's own
"Blocked By" names only M5. Its "Parallel Work" note says the replay
runner, evaluators, and report generator can proceed in parallel.

## Exact first command for the next agent

```bash
pnpm install --frozen-lockfile && pnpm check && pnpm supabase:start && pnpm example:run:mock -- --workflow --vendor "Aurelia Freight" && pnpm harness run show <runId>
```

(Node 24.21.0 and pnpm 12.4.2 on PATH; see `docs/development/local-setup.md`.
Docker must be running for `pnpm supabase:start`; Supabase may already be up
on this host, see "Current blockers".) Then read, in order: `AGENTS.md`, this
file, `docs/README.md`, `docs/progress/milestones/m5.md`,
`docs/contracts/README.md`, and the Milestone 6 section of
`docs/milestones/build-plan.md`.

## Last successful verification

- `pnpm check`: PASS, 2026-09-21, on commit `17c88cd` after Phase B (1491
  passed, 68 skipped, 82 files with no Supabase env; 1570 passed, 3 skipped
  with `.env.local` exported). Prior: PASS after Phase A, `df0de79` (1370
  passed, 57 skipped, 74 files); PASS after M4-T10, `e461297` (1197 passed,
  43 skipped, 67 files); PASS after M2-T10 (876 passed, 43 skipped, 53
  files).
- `pnpm --filter @internal/example-agent run calibrate`: PASS, exit 0,
  sixteen cases, 100.0% accuracy, 12.5% uncertain-band rate, 0.0%
  false-auto rate, 12.5% fallback rate.
- `pnpm example:run:mock -- --workflow` (no vendor, `clear` route): PASS,
  exit 0, run `01a0c0ac-0454-7001-a5f7-00f6684b00b4`, through the router.
- `pnpm example:run:mock -- --workflow --vendor "Aurelia Freight"`
  (escalation, then the full agent): PASS, exit 0, run
  `01a0c0bd-7513-7000-9d5b-658849af969b`. `fallback_count: 1`, timeline
  `node.completed`(escalate) → `fallback.started` → `agent.started` →
  `model.started` → `model.completed` → `agent.completed` →
  `fallback.completed` → `run.completed`. Under M4 this exact command
  exited 1; it now exits 0.
- `pnpm example:run:mock -- --workflow --no-register-workflow`: PASS, exit
  0, run `01a0c0ac-e6c3-7001-99eb-82bd70a9964b`, `route: full-agent`,
  `workflow_version_id: null`.
- `runs.jev_calls` verified real: run `01a0c0c2-28ee-7000-b77d-a9870d373c74`
  (research route, two `jev` nodes) has `jev_calls = 2`; run
  `01a0c0c2-df82-7000-811b-d1d8eb9f3318` (escalating) has `jev_calls = 1`.
- `pnpm vitest run --project contract packages/runtime-eve`: PASS, 8
  passed, against a real `eve dev` server, including the fallback
  `clientContext` assertion.
- `pnpm --filter @internal/example-agent exec eve info`: PASS, 0 errors, 0
  warnings.
- `pnpm supabase:reset`: PASS, applied all seven migrations from an empty
  database. `pnpm supabase:types` run twice, byte-identical.
- Row-level security: enabled on all 13 tables, verified.
- `pnpm example:run` and its `--workflow` variants (live model): not run,
  no credential.
- Live Jev (`live:jev`-tagged tests): not run, no credential.
