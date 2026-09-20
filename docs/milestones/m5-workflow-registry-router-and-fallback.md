# Milestone 5, Workflow Registry, Router, and Fallback

**Status:** every task is completed (M5-T1 through M5-T7); all six acceptance criteria verified.
Snapshot: `../progress/milestones/m5.md`.

**Goal (from the build plan):** choose between a proven compiled workflow and the full agent.

**Blocked by:** M4 (complete).

**Parallel work:** registry storage and router can proceed in parallel.

**Deliverable:** the core compile-then-run execution loop, still without automatic learning.

## Before starting

These prerequisites come from the current state of the code and from the build plan's own notes
about this milestone. Read them before opening any M5 task.

- `workflow_definitions`, `workflow_versions` and `workflow_promotions` already exist, in M2-T5's
  minimal keyed placeholder shape (`supabase/migrations/20260920030256_workflow_registry_tables.sql`:
  identity, the foreign keys that relate them, a timestamp, one `payload jsonb`). `runs.workflow_version_id`
  and `runs.fallback_count` (`supabase/migrations/20260920030258_runs_outcome_ledger.sql`) are also
  placeholders on the outcome ledger. M5-T1 is what gives the registry tables real columns, in a
  **new** migration rather than editing the M2 one (migrations are append-only, never hand-edited
  after the fact), and regenerates `packages/storage-supabase/src/database.types.ts` afterward
  (AGENTS.md rule 12: the generated file is never hand-edited directly). Local Supabase is running
  on this development host as of the M4 close-out, so `pnpm supabase:start` may not be needed again
  before `pnpm supabase:reset`/`pnpm supabase:types`.
- `FallbackContext` and `FALLBACK_REASONS` already exist in `packages/core/src/workflow-ir.ts`, with
  **six** M4 reasons: `escalate-node`, `node-failed`, `budget-exceeded`, `validation-failed`,
  `decision-failed`, `timeout`. The build plan's M5-T4 lists **eight** typed reasons instead:
  `low_confidence`, `unsupported_case`, `missing_evidence`, `budget`, `tool_failure`,
  `schema_mismatch`, `policy`, `workflow_error`. The two lists do not name-match one-for-one (M4's
  are about *why the workflow stopped*; the plan's M5-T4 list reads more like *why the workflow
  wasn't trusted*), so M5-T4 has to reconcile them deliberately rather than silently pick one — this
  is an architecture-changing decision under AGENTS.md rule 11 and needs an ADR, not a WORKLOG note.
- `WorkflowRuntime.asAgentRuntime()` (`packages/workflow/src/runtime/workflow-runtime.ts`) already
  maps a workflow's `escalated` result to a `FailedAgentExecution` carrying a `WorkflowError` whose
  `details.fallback` is the `FallbackContext` as JSON (ADR-0040). That mapping is explicitly a
  stopgap and is exactly what M5 replaces — ADR-0040 says so directly: "M5's router replaces its
  escalated-to-failed mapping." `fallback.started`/`fallback.completed` trace event types already
  exist in the closed taxonomy (`packages/core/src/trace.ts`) and are already emitted by the
  runtime on escalation.
- `EveAgentRuntime` (`packages/runtime-eve/src/eve-agent-runtime.ts`) already sends each turn with a
  documented `clientContext` (the private `jobClientContext(job)` helper, line ~1058), built from the
  eve-authored `SendTurnOptions.clientContext` shape. That is the candidate documented runtime
  boundary M5-T6 needs ("the full-agent adapter receives the fallback envelope through its
  documented runtime boundary") for handing a `FallbackContext` to a full-agent run. Per AD-011/
  AD-012, eve's own shipped docs (`node_modules/eve/docs/`) are the source of truth for what
  `clientContext` is allowed to carry and how the agent sees it, not this file's description of it.
- `createHarness()` still drives exactly one `AgentRuntime`; there is no router today. The build
  plan's dependency diagram puts `registry` beneath `workflow`, and `packages/registry` is listed as
  planned (M5) in `docs/architecture/system-map.md`. One way to satisfy "same harness call can
  execute either workflow or full agent" without changing `createHarness()`'s own contract is an
  `AgentRuntime` composition that internally picks a workflow's `asAgentRuntime()` or the full agent
  — that is a design option for the router task, not a decision made yet.
- Compatibility is checked by reference equality on schema refs and exact capability versions
  (AD-015; the precedent is M4's validator, ADR-0039's "schema compatibility is reference equality
  on `id@version`"), never by name alone. M5-T2's compatibility selector should follow the same
  rule rather than inventing a second comparison scheme.
- Pre-assigned ADR numbers for this milestone: **0043** (the registry model, compatibility selector
  and the `Storage`/schema extension, M5-T1/M5-T2) and **0044** (the router, the fallback contract
  and reconciliation, full-agent escalation, the fallback handoff, and the circuit breaker,
  M5-T3 through M5-T7). `pnpm check:handoff` fails on a WORKLOG entry referencing an ADR that does
  not yet have a file under `docs/decisions/`, so each task writes its own ADR before its WORKLOG
  entry is marked `completed`.

## Tasks

### M5-T1, Registry model

**Status:** completed (2026-09-20).

Workflow statuses:

```text
draft
candidate
shadow
canary
active
retired
rejected
```

**Result.** `packages/core/src/workflow-registry.ts` declares `WORKFLOW_STATUSES` (the seven
above, in the build plan's order), `WORKFLOW_STATUS_TRANSITIONS` as an explicit table and
`canTransition(from, to)` over it: `draft -> candidate|rejected`,
`candidate -> shadow|canary|active|rejected`, `shadow -> canary|active|retired|rejected`,
`canary -> active|retired|rejected`, `active -> retired`, with `retired` and `rejected` terminal,
no edge back into `draft` and no self-transition. AD-005 is structural rather than remembered:
every method that moves a status takes an `actor`, and nothing in the harness promotes itself.
`WorkflowRecord`, `WorkflowVersionRecord` and `WorkflowPromotionRecord` come with strict parse
boundaries in the `parseRunRecord()` style; `parseWorkflowVersionRecord()` **recomputes** the
fingerprint from the stored IR and rejects a row whose digest and definition disagree, which is
why the record carries no `canonicalJson` field, and `parseWorkflowPromotionRecord()` re-checks
the transition table. The `Storage` port gained six methods (`saveWorkflow`,
`saveWorkflowVersion`, `getWorkflowVersion`, `listWorkflowVersions`, `setWorkflowVersionStatus`,
`listWorkflowPromotions`), implemented by both `createSupabaseStorage()` and
`createInMemoryStorage()` and covered by the shared contract suite, whose Supabase leg was run
for real. `setWorkflowVersionStatus` is a compare-and-set on the current status and appends one
promotion row per change, so history is a ledger. One **new** migration,
`supabase/migrations/20260920202604_workflow_registry_columns.sql`, gives the three M2 placeholder
tables their real columns and drops their unused `payload jsonb`; `pnpm supabase:reset` applies
every migration from empty and `pnpm supabase:types` regenerates `database.types.ts` identically
on a second run. `packages/registry` (`@internal/registry`) holds the service:
`createWorkflowRegistry({ storage, clock })` with `register()` (always a `draft`), `promote()`,
`retire()`, `findActive()` and `resolve()`. Recorded in
[ADR-0043](../decisions/0043-the-workflow-registry-is-a-status-model-in-core-with-an-exact-match-selector.md),
documented in [`../contracts/workflow-registry.md`](../contracts/workflow-registry.md).

### M5-T2, Compatibility selector

**Status:** completed (2026-09-20).

A workflow declares:

- domain
- job type
- supported input schema
- required capabilities
- SOP compatibility
- minimum harness version

Never route only by string name.

**Result.** `WorkflowCompatibility` is those six plus the output schema, and it is **derived**
from the compiled IR by `describeWorkflowCompatibility(compiled, { sop, … })`, so a version
cannot declare compatibility its IR does not have; the SOP identifier is the one field the IR
cannot supply and is passed at registration, with an optional `sopFingerprint` beside it because
M2 settled that a SOP reference is bare and its content is captured by the behavior fingerprint's
`sop` component. `collectRequiredCapabilities(definition)` walks both workflow schemas, every
node's two schemas, a `code`/`reduce` handler, a `call` tool, an `agent` agent and a
`branch`/`loop` policy, sorted and deduplicated, and deliberately excludes a `jev` node's
question — a question is not a capability kind, which is the same exclusion M4-T9 makes.
`selectCompatibleWorkflow(job, candidates, env)` is pure and applies nine exact checks in a fixed
order, reporting the first failure as one of nine closed reasons: `not-active`,
`domain-mismatch`, `job-type-mismatch`, `input-schema-mismatch`, `output-schema-mismatch`,
`missing-capability`, `sop-mismatch`, `sop-fingerprint-mismatch`, `harness-too-old`. Schemas
compare as `id@version` reference strings (ADR-0039), capabilities resolve at exactly the pinned
version (AD-015), and **the workflow's `id` is never consulted**. When more than one active
version matches, the newest `WorkflowVersionId` wins, and the tie-break is stated rather than
left to row order because determinism is an acceptance criterion. `minHarnessVersion` is the one
place versions are ordered rather than compared, by `compareExactVersions()`. Every rejection
reason and the tie-break are unit-tested with no database
([ADR-0043](../decisions/0043-the-workflow-registry-is-a-status-model-in-core-with-an-exact-match-selector.md)).

### M5-T3, Router

**Status:** completed (2026-09-20).

Initial routing is deterministic.

```text
compatible active workflow?
  yes -> workflow
  no  -> full agent
```

Do not use an LLM to decide whether a known workflow exists.

**Result.** `createRouter()` in `packages/registry/src/router.ts` returns something that **is** an
`AgentRuntime` and additionally exposes `route(job)`, so `createHarness({ agentRuntime: router })`
needs no new option and `createHarness()`'s own contract did not change — that is how "the same
harness call can execute either workflow or full agent" is satisfied without core learning about
workflow versions, which it could not do anyway since `registry` sits beneath `core` in the
dependency diagram. `run()` calls `registry.resolve(job, { manifest, harnessVersion,
sopFingerprint? })`; a `match` compiles the stored IR (cached by version id) and runs it through
`workflowRuntime.run()`, a `none` goes straight to the registered full agent. The router takes the
domain's **`CapabilityRegistry`**, not a manifest, because it is the only thing that needs both
halves: the selector compares pins against `capabilities.toManifest()` and `compileWorkflow()`
resolves them to real values, so a router given only a manifest could choose a workflow it cannot
run. **Compilation is cached; routing is not** — the active version is re-resolved on every run,
which is what makes a retirement take effect with nothing to invalidate. There is no model
anywhere in the decision. `RouteDecision` reports the chosen version, every candidate rejection,
and a `refusal` when a matched version was refused by an optional circuit breaker or failed to
compile. Every execution carries `route`, `workflowVersionId`, `workflowId`, `workflowVersion` and
`rejections` in `AgentExecution.metadata`, plus `workflowVersionId` and `fallbackCount` as fields
of their own — **not** metadata, because they are ledger columns and two runtimes must not be free
to spell them differently. `createHarness()` copies those into `RunFinish`, both `Storage`
implementations write them, and the inspector's `route:` line therefore prints a version id with
no inspector change. Recorded in
[ADR-0044](../decisions/0044-the-router-is-an-agentruntime-and-a-fallback-travels-in-the-execution-context.md),
documented in [`../contracts/workflow-registry.md`](../contracts/workflow-registry.md).

### M5-T4, Fallback contract

**Status:** completed (2026-09-20).

Every compiled execution can return:

```text
success
fallback(reason)
failure
```

Fallback reasons are typed:

```text
low_confidence
unsupported_case
missing_evidence
budget
tool_failure
schema_mismatch
policy
workflow_error
```

**Result.** `FallbackReason` in `packages/core/src/workflow-ir.ts` is now exactly these eight, in
this order, and M4's six are gone rather than kept beside them: two closed vocabularies for one
stored field is the text-matching problem a closed union exists to prevent. The reconciliation the
"Before starting" section called for is an explicit mapping in
`escalationReasonFor(cause, nodeType)`: an `escalate` node is `unsupported_case`, a budget or a
node timeout is `budget`, a `ValidationError` at a node or at the workflow's own contract is
`schema_mismatch`, a `PermissionDeniedError` is `policy`, an exhausted `call` node is
`tool_failure`, and anything else that exhausted its retries — including a `jev` node whose engine
produced no usable answer — is `workflow_error`. **`low_confidence` and `missing_evidence` are
deliberately unreachable from the interpreter**: they are policy outcomes, and a decision that
could not be obtained at all is not a low-confidence one, because no judgment was made. M3's policy
layer is what raises them. The IR is unchanged: an `escalate` node's authored free text becomes the
envelope's new `detail` field, which nothing compares, beside a new `nodeId` that is `null` when
the workflow itself stopped. `WorkflowRunResult`'s four cases carry the plan's three outcomes —
`completed` is `success`, `escalated` is `fallback(reason)`, `failed` is `failure`, and `aborted`
belongs to none of them — and the correspondence is stated in
[`../contracts/workflow-ir.md`](../contracts/workflow-ir.md). ADR-0040 carries a dated amendment
note rather than a rewrite.

### M5-T5, Full-agent escalation

**Status:** completed (2026-09-20).

Fallback should preserve:

- original job
- workflow evidence
- completed safe node results
- fallback reason

The full agent should not blindly repeat completed research if trustworthy evidence already
exists.

**Result.** When `workflowRuntime.run()` returns `escalated`, the **router** — not
`asAgentRuntime()` — invokes the registered full agent with the original immutable `Job` and a
context carrying the envelope. `asAgentRuntime()` keeps its escalated-to-failed mapping for
standalone use, and its doc comment and ADR-0040's amendment now say plainly that it is the honest
record of a fallback with nowhere to go rather than a stopgap: a run driven that way shows
`fallback.started` with no `fallback.completed`. The interpreter records `fallback.started`
because only it knows why the path stopped, and now returns that event's id as
`EscalatedWorkflowRun.fallbackSpanId`; the router records `fallback.completed` because only it
knows what happened next. The execution the router returns is the agent's own outcome with the
**whole** attempt's usage — the workflow's plus the agent's — because reporting only the second
half would make the compiled path look free every time it gave up, and with `fallbackCount: 1` and
the `workflowVersionId` that gave up, so the ledger can tell a fallback from a workflow that
answered on its own.

### M5-T6, Fallback context handoff

**Status:** completed (2026-09-20).

Construct `FallbackContext` from persisted node outputs and evidence references.

Rules:

- only successfully validated node outputs may be marked `trusted`;
- failed/partial node output is not automatically reusable;
- original `Job` remains immutable;
- remaining budget is recalculated before full-agent invocation;
- the full-agent adapter receives the fallback envelope through its documented runtime boundary;
- the trace links the compiled run span to the fallback agent execution.

Add an integration test proving the full agent can consume already completed research without the
harness repeating the research tool call.

**Result.** All six rules hold and each is asserted. `trusted` keeps ADR-0040's rule unchanged —
`code`, `artifact` and every control shape are trusted, a `read-only` `call` is trusted, and
`agent`, `jev` and every write `call` are not — and the build plan's "only successfully validated
node outputs may be marked `trusted`" is the necessary condition that rule refines: a failed or
partial node is not listed at all, and an `escalate` node is not listed either, because it produces
a `FallbackContext` rather than a value and an `outputRef` pointing at nothing would be worse than
an omission. `evidenceRefs` now carries `artifact:<id>` for every `artifact` node the run
completed, read off the node's own validated output.

**Each completed node carries its validated output inline**, in a new
`output: JsonValue | null` beside `outputRef`. This is a deliberate deviation from build plan
section 5, which names only the reference: that shape assumes the recipient can dereference a
pointer, and across the only channel a fallback has — the adapter's documented context surface —
it cannot, because what receives the envelope is a model rather than a process holding a `Storage`
handle. An envelope of references alone would have made M5-T5 unachievable in principle, and would
have left `instructions.md` telling the agent to reuse results it could not see. The reference
survives beside the value for a reader that does have the trace or the store. Outputs are carried
for **every** listed node, untrusted ones included, because everything in `completedNodes`
validated or it would not be listed, and withholding an `agent` node's result would withhold
exactly the expensive thing the fallback exists to reuse; `trusted` governs how a value may be
used, not whether it is shown. The interpreter leaves the outputs `null` and the **router** fills
them from the run's records, so `asAgentRuntime()`'s error payload stays lean and the size budget
is applied once. That budget is `FALLBACK_ENVELOPE_MAX_BYTES`, 64 KiB and harness-chosen, because
eve documents no limit for `clientContext` and an undocumented limit is not an absent one; over it,
the largest outputs drop to `null` first, `outputRef` and `trusted` survive, and `detail` names
what was dropped. The original `Job` is handed over untouched;
everything the fallback adds lives in a new optional `ExecutionContext.fallback`, because a job is
immutable and describes *what* to do while a context describes *this attempt*. The remaining budget
is recalculated **in the router, immediately before the agent is invoked** — the job's budget minus
what the workflow actually spent, floored at zero per dimension, with an absent dimension left
absent — and the context the agent runs under carries that budget, not the job's. The documented
runtime boundary is eve's turn-scoped `clientContext`: `EveAgentRuntime` adds the envelope under a
`harness.fallback` key beside the job it already sends there, which eve's shipped docs establish
is JSON-serialized into one context message that every model call of the turn sees and that is
discarded before the next turn and never persisted to durable session history. The transport is
eve's; the key and the shape under it are harness-owned, and the envelope carries references and
flags only, never node output, so an escalation cannot put an unredacted tool result into a prompt
(`../research/vercel/2026-09-20-m5-eve-client-context-for-fallback.md`). The trace link is one
span: the agent runs against the same recorder reporting `fallback.started` as its `rootId`, so its
whole `agent.*` subtree hangs under the escalation, and `fallback.completed` closes it — one
recorder and one sequence per run throughout (ADR-0031).
`apps/example-agent/agent/instructions.md` gained a paragraph telling the agent to build on a
trusted completed node rather than calling `lookup_vendor_evidence` again;
`pnpm --filter @internal/example-agent exec eve info` reports 0 errors, 0 warnings.

### M5-T7, Circuit breaker

**Status:** completed (2026-09-20).

If an active workflow exceeds configured failure/fallback thresholds over a rolling local
evaluation window, disable routing to it.

Initial version can require manual invocation.

**Result.** `createCircuitBreaker({ storage, registry, window: { runs }, thresholds })` in
`packages/registry/src/circuit-breaker.ts`. `evaluate(versionId)` reads that version's most recent
runs through a new `RunFilter.workflowVersionId` — implemented by both `Storage` implementations,
so "the last N runs of this version" is one indexed keyset range rather than a scan of the whole
ledger — and returns `{ tripped, fallbackRate, failureRate, sample }`. Only **finished** runs are
evidence: a `running` run has no outcome yet and an `aborted` run is evidence about its caller, and
an empty sample never trips, because an untried workflow is not a failing one and `0/0` is not `1`.
The window is a count of runs rather than a span of time, because a workflow that runs twice a day
and one that runs twice a minute need the same number of observations before anyone should conclude
anything about either. `trip(versionId, { actor, reason })` retires the version through the
registry and therefore appends a promotion row naming whose decision it was; **nothing calls it on
a timer**, which is AD-005 kept structural, and the build plan's "initial version can require
manual invocation" taken literally. Disabling routing needs no cache invalidation because the
router re-resolves per run, which is the same mechanism that makes the retirement acceptance
criterion true. `createRouter({ breaker })` is an optional seam that refuses *traffic* to a tripped
version without changing its status — the reversible half of the same idea.

**Not built, deliberately:** `pnpm harness workflow list`. M5-T1 gave the `Storage` port
`listWorkflowVersions()`, so the data exists, but the command needs a new parsed command shape, two
filter flags, a renderer and its own tests in `@internal/observability`, which is not the "small
addition" the task made it conditional on. The CLI's target list now marks it
`not yet implemented (M5 landed the storage read)` rather than `(M4)`, so the marker is accurate
about where it stands.

## Acceptance criteria

From the build plan. Every line below was verified on **2026-09-20** against the code in this
working tree; run ids are from local Supabase.

- **Same harness call can execute either workflow or full agent.** Verified. `createRouter()` is an
  `AgentRuntime`, so `createHarness({ agentRuntime: router, trace, storage })` is the one call.
  Three runs of the **same** command differ only in their input and their flags:
  `pnpm example:run:mock -- --workflow` completed through the compiled workflow
  (`01a0c0ac-0454-7001-a5f7-00f6684b00b4`, `pnpm harness run show` prints
  `route: 01a0c0ac-042d-7000-976e-ca5b4edf0bbf`, `fallbacks: 0`);
  `… --vendor "Aurelia Freight"` completed through the full agent after escalating
  (`01a0c0ac-5ac4-7001-9a3b-be76b059b7ab`, same `route:`, `fallbacks: 1`);
  `… --no-register-workflow` completed through the full agent directly
  (`01a0c0ac-e6c3-7001-99eb-82bd70a9964b`, `route: full-agent`, `fallbacks: 0`). Unit coverage:
  `packages/registry/src/router.test.ts` > "routes to the compiled workflow when an active
  compatible version exists" and "routes to the full agent when the registry holds nothing at all".
- **Unsupported jobs never force-fit into a workflow.** Verified. An exact-match selector has no
  nearest neighbour: `router.test.ts` > "never force-fits an unsupported job into a workflow, and
  says why" (a job type no active version declares) and "reports the selector's rejections when an
  active version is incompatible" (an input contract mismatch, reported as
  `input-schema-mismatch` in `RouteDecision.rejections` and in the execution's metadata). End to
  end: run `01a0c0ac-e6c3-7001-99eb-82bd70a9964b` has `workflow_version_id = null`.
- **Fallback reaches the full agent with accumulated context.** Verified. M5-T6's required
  integration test is `apps/example-agent/src/workflow/vendor-triage-fallback.test.ts` — the real
  domain, the real compiled workflow, the real router, the whole `createHarness()` path — with
  nine cases. "reaches the full agent with the research the workflow already completed" asserts the
  agent received `context.fallback` with `reason: "workflow_error"`, `nodeId: "decide"`, the
  workflow's id and version, and `node:research` among `completedNodes`; "does not repeat the
  research tool call" asserts exactly **one** `tool.started` and one `tool.completed` in the whole
  trace, both from the workflow, and `agent.started` twice with distinguishable payloads;
  "recalculates the remaining budget before the agent is invoked" asserts
  `maxModelCalls` 8 → 4 and `maxToolCalls` 8 → 7; "links the compiled run span to the fallback agent
  execution" asserts the agent's `agent.started` and the `fallback.completed` are both children of
  the `fallback.started` event. End to end, run `01a0c0ac-5ac4-7001-9a3b-be76b059b7ab`'s timeline
  is `node.completed` (the escalate node) → `fallback.started` → `agent.started` → `model.started`
  → `model.completed` → `agent.completed` → `fallback.completed` → `run.completed`, at sequences 8
  through 15, and its ledger row carries `fallback_count = 1`.
- **Workflow failure does not mark the job successful.** Verified. The router maps a
  `FailedWorkflowRun` to a failed execution and never escalates it, because a defect is not a
  fallback condition: `router.test.ts` > "reports a workflow defect as a failure, and never
  escalates it" (`fallbackCount: 0`, `status: "failed"`, the version id still recorded). A failed
  *fallback agent* also fails the run: "reports a failed fallback agent as a failure". M4's
  existing evidence that an escalated run is not reported as completed is unchanged
  (`vendor-triage-run.test.ts`).
- **Retiring an active workflow immediately returns traffic to the full agent.** Verified, with no
  invalidation call in between, because the router re-resolves per run and has no routing cache:
  `router.test.ts` > "returns traffic to the full agent the moment an active version is retired"
  routes the same job to the workflow, retires the version, and routes the next one to the full
  agent through the **same router instance**. The whole-path version is
  `vendor-triage-fallback.test.ts` > "routes straight to the full agent and leaves the workflow
  column null", which retires the active version mid-fixture and asserts
  `workflowVersionId: null` on the ledger row. `createCircuitBreaker().trip()` is what an operator
  calls to do this from evidence (`circuit-breaker.test.ts` > "retires the version through the
  registry, with an actor and a reason").
- **Registry lookup is deterministic and unit-tested.** Verified. The decision is
  `selectCompatibleWorkflow()`, a pure function with nine ordered checks and a stated tie-break
  (M5-T2, `packages/core/src/workflow-registry.test.ts`), and the router adds no non-determinism:
  `router.test.ts` > "is deterministic: the same job and registry decide the same way every time"
  routes one job three times concurrently and gets the same version each time. No model is
  reachable from the routing path.
