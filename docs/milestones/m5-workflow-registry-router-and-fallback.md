# Milestone 5, Workflow Registry, Router, and Fallback

**Status:** in progress. No task has started.

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

**Status:** not started.

Initial routing is deterministic.

```text
compatible active workflow?
  yes -> workflow
  no  -> full agent
```

Do not use an LLM to decide whether a known workflow exists.

### M5-T4, Fallback contract

**Status:** not started.

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

### M5-T5, Full-agent escalation

**Status:** not started.

Fallback should preserve:

- original job
- workflow evidence
- completed safe node results
- fallback reason

The full agent should not blindly repeat completed research if trustworthy evidence already
exists.

### M5-T6, Fallback context handoff

**Status:** not started.

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

### M5-T7, Circuit breaker

**Status:** not started.

If an active workflow exceeds configured failure/fallback thresholds over a rolling local
evaluation window, disable routing to it.

Initial version can require manual invocation.

## Acceptance criteria

From the build plan.

- Same harness call can execute either workflow or full agent. **not yet verified**
- Unsupported jobs never force-fit into a workflow. **not yet verified**
- Fallback reaches the full agent with accumulated context. **not yet verified**
- Workflow failure does not mark the job successful. **not yet verified**
- Retiring an active workflow immediately returns traffic to the full agent. **not yet verified**
- Registry lookup is deterministic and unit-tested. **not yet verified**
