---
status: active
owner: core
last_verified: 2026-09-20
related:
  - docs/milestones/build-plan.md
  - docs/contracts/storage.md
  - docs/contracts/workflow-ir.md
  - docs/contracts/capability-registry.md
  - docs/contracts/job.md
  - docs/decisions/0043-the-workflow-registry-is-a-status-model-in-core-with-an-exact-match-selector.md
  - docs/decisions/0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md
  - docs/decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md
implementation:
  - packages/core
  - packages/registry
  - packages/storage-supabase
  - packages/testing
  - supabase/migrations
---

# Workflow registry

The registry is what makes "run the compiled workflow or run the full agent" a decidable
question. It holds every version of every compiled workflow, what each version declares it can
handle, and the ledger of who promoted what. M5-T1 is the model, M5-T2 is the selector over it.
[ADR-0043](../decisions/0043-the-workflow-registry-is-a-status-model-in-core-with-an-exact-match-selector.md)
records why it is shaped this way.

```ts
const registry = createWorkflowRegistry({ storage });

const version = await registry.register(compiled, {
  domain: { id: "vendor-triage", version: "1.0.0" },
  actor: "david",
  sop: "vendor-triage-sop",
});

await registry.promote(version.id, "candidate", { actor: "david", reason: "evals cleared" });
await registry.promote(version.id, "active", { actor: "david" });

const selection = await registry.resolve(job, {
  manifest: capabilities.toManifest(),
  harnessVersion: HARNESS_RUNTIME_INFO.version,
});
```

## Where each half lives

| Half | Package | What it is |
|---|---|---|
| The model and the selector | `@internal/core` (`src/workflow-registry.ts`) | Statuses, the transition table, `WorkflowCompatibility`, the three records with their parse boundaries, and `selectCompatibleWorkflow()`. Pure, no I/O. |
| The service | `@internal/registry` | `createWorkflowRegistry({ storage, clock })`: register, promote, retire, find active, resolve. |
| Persistence | `Storage` (six methods) | Implemented by `@internal/storage-supabase` and by `createInMemoryStorage()` in `@internal/testing`; both run the same contract suite. |

It is the split [ADR-0038](../decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md)
already made for the IR: core states what a thing *is*, a package beside it does the work.
`@internal/registry` is **not** an adapter and carries core's dependency bans. "No domain package
may mutate harness registry tables directly" (build plan section 4) is what it exists to make
unnecessary.

## The seven statuses and the edges between them

```text
draft     -> candidate | rejected
candidate -> shadow | canary | active | rejected
shadow    -> canary | active | retired | rejected
canary    -> active | retired | rejected
active    -> retired
retired   -> (terminal)
rejected  -> (terminal)
```

`canTransition(from, to)` is the whole rule, and a move to the same status is **not** a
transition. There is no edge back into `draft` and none out of a terminal state: a version's
identity is its IR fingerprint, so "reworked" means a new version. `active -> rejected` is
absent on purpose — `rejected` is a verdict on a version that never served.

**Nothing promotes itself.** AD-005 puts a human in front of every promotion, so every method
that moves a status takes an `actor`, and there is no timer, threshold or eval hook that can
call one.

## What a version declares

`WorkflowCompatibility` is derived from the compiled IR by `describeWorkflowCompatibility()`, so
it cannot claim what the IR does not do. The only field the IR cannot supply is the SOP.

| Field | Where it comes from |
|---|---|
| `domainId` | The IR's `domain`. Not version-pinned (ADR-0038). |
| `jobType` | The IR's `jobType`. |
| `inputSchema` / `outputSchema` | The IR's, as `id@version` reference strings. |
| `requiredCapabilities` | `collectRequiredCapabilities()`: both workflow schemas, every node's two schemas, a `code`/`reduce` handler, a `call` tool, an `agent` agent, and a `branch`/`loop` policy. Sorted and deduplicated. |
| `sop` | Supplied at registration. Bare, matching `Job.contracts.sop`. |
| `sopFingerprint` | Optional `sha256:` digest of the SOP's content. |
| `minHarnessVersion` | Defaults to `HARNESS_RUNTIME_INFO.version`. |

A `jev` node's `question` is deliberately **absent** from `requiredCapabilities`. A question is
not one of the five capability kinds — M3 owns the question contract — so there is nothing to
resolve it against, which is the same exclusion M4-T9's validator makes.

The SOP is an identifier with no version because M2 settled that the SOP's *content* is captured
by the behavior fingerprint's `sop` component
([ADR-0034](../decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md)),
not by a version string somebody has to remember to bump. `sopFingerprint` is how "the SOP was
rewritten under the same name" stops being invisible; it is compared only when **both** sides
have one.

## The selector

```ts
selectCompatibleWorkflow(job, candidates, { manifest, harnessVersion, sopFingerprint? })
  : { kind: "match"; version } | { kind: "none"; rejections }
```

Pure. No storage, no clock, no registry lookup. Nine checks, in this order, and the **first**
failure is the reason reported:

| Order | Check | Rejection reason |
|---|---|---|
| 1 | the version is `active` | `not-active` |
| 2 | domain matches the job's | `domain-mismatch` |
| 3 | job type matches | `job-type-mismatch` |
| 4 | input schema reference matches | `input-schema-mismatch` |
| 5 | output schema reference matches | `output-schema-mismatch` |
| 6 | every pinned capability is in the manifest at that exact version | `missing-capability` |
| 7 | SOP identifier matches | `sop-mismatch` |
| 8 | SOP fingerprints match, when both exist | `sop-fingerprint-mismatch` |
| 9 | `minHarnessVersion <= harnessVersion` | `harness-too-old` |

Every comparison is exact. Schemas compare as reference strings, the way M4's validator already
compares them ([ADR-0039](../decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md));
capabilities resolve at the version written and nowhere else (AD-015). **The workflow's `id` is
never consulted**, which is the build plan's "never route only by string name" enforced rather
than intended.

**The tie-break is the newest `WorkflowVersionId`.** Ids are UUIDv7, so that is the most recently
registered matching version. It is specified rather than left to array order because "registry
lookup is deterministic and unit-tested" is a Milestone 5 acceptance criterion.

`minHarnessVersion` is the one place versions are *ordered* rather than compared for equality,
by `compareExactVersions()`. A minimum rather than a pin, because refusing a newer harness would
retire every workflow on every release.

## The three records

| Record | Table | Identity |
|---|---|---|
| `WorkflowRecord` | `workflow_definitions` | `(domainId, workflowKey)` is unique. One row per workflow, across all its versions. |
| `WorkflowVersionRecord` | `workflow_versions` | `(workflowId, fingerprint)` is unique. The fingerprint **is** the version. |
| `WorkflowPromotionRecord` | `workflow_promotions` | One row per status change. Append-only. |

`parseWorkflowRecord()`, `parseWorkflowVersionRecord()` and `parseWorkflowPromotionRecord()` are
the read boundaries, beside `parseJob()` and `parseRunRecord()`. Two of them do more than check
shape:

- `parseWorkflowVersionRecord()` **recomputes the fingerprint** from the stored definition and
  rejects a row whose digest and IR disagree. A hand-edited payload or a partial migration fails
  here rather than quietly winning a tie-break. It is also why the record carries no
  `canonicalJson` field: that value is derivable, and a stored second copy could disagree with
  the definition it claims to encode.
- `parseWorkflowPromotionRecord()` **re-checks the transition table**, so a ledger row claiming a
  move the model forbids is not a record of something that happened.

`workflow_versions.metadata` is registry-owned free-form detail: who registered it, which
compiler run produced it. `register()` always writes `registeredBy`.

## The `Storage` methods

| Method | Meaning |
|---|---|
| `saveWorkflow(record)` | Upsert by `(domainId, workflowKey)` and **return the row that now exists**. When the key was taken, the returned record carries the *original* `WorkflowId`, which is the id versions hang off. Also upserts the domain, like `saveJob`. |
| `saveWorkflowVersion(record)` | Plain insert. A duplicate `(workflowId, fingerprint)` rejects loudly. |
| `getWorkflowVersion(id)` | One version, or `null`. |
| `listWorkflowVersions(filter?, cursor?)` | Newest first, filtered by `domainId`, `jobType`, `status`, `workflowId`, keyset-paged on the version id. `DEFAULT_WORKFLOW_VERSION_PAGE_SIZE` is 50; `MAX_PAGE_SIZE` still applies. |
| `setWorkflowVersionStatus(input)` | One transition plus its ledger row. See below. |
| `listWorkflowPromotions(versionId)` | One version's history, **oldest first** and unpaged. |

`listWorkflowPromotions` is the only list on the port that returns oldest first: it is the
narrative of how a version reached its status, and a narrative read backwards is not one. It is
unpaged because the transition table bounds it.

### `setWorkflowVersionStatus` is a compare-and-set

```ts
await storage.setWorkflowVersionStatus({
  versionId, from: "candidate", to: "active",
  actor: "david", reason: null,
  promotionId: newPromotionId(),
  changedAt: clock.now().toISOString(),
});
```

`from` is required, and that is the design. The Supabase implementation applies it as a single
conditional update, so two processes promoting the same version cannot both succeed and a
promotion decided against a status that has since changed fails instead of overwriting whatever
happened in between. An illegal transition is a `ValidationError`; a lost race or a missing
version is a `StorageError`, and the message says which.

The ledger row is appended **after** the status moved, so a row exists only for a transition that
happened. PostgREST gives no transaction across the two statements, so the residual failure mode
is a status change whose ledger row is missing: it raises a `StorageError` rather than being
swallowed, and it is visible afterwards as a version whose status disagrees with its last
promotion.

`promotionId` is supplied by the caller, because ids are harness-minted UUIDv7 with no database
default ([ADR-0030](../decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md)).

## The registry service

| Method | Meaning |
|---|---|
| `register(compiled, { domain, actor, sop, sopFingerprint?, minHarnessVersion?, metadata? })` | Upserts the workflow row, derives compatibility, inserts a **`draft`** version. Rejects when `domain.id` disagrees with the IR's `domain`. |
| `promote(versionId, to, { actor, reason? })` | Reads the current status, then moves through `setWorkflowVersionStatus`. |
| `retire(versionId, { actor, reason? })` | `promote(versionId, "retired", …)`, named for the acceptance criterion it satisfies. |
| `findActive({ domainId, jobType })` | Every active version, paged to exhaustion. |
| `resolve(job, env)` | `findActive` for the job's domain and type, then `selectCompatibleWorkflow`. |

`findActive` pages to exhaustion deliberately: the tie-break is "the newest matching version",
which is a statement about every candidate, so stopping at the first page would make the answer
depend on the page size.

**Registration never promotes.** A freshly registered workflow is a `draft`, and there is no
option that would make it anything else.

**Retiring is immediate.** Nothing caches the candidate list between the registry and the store,
so "retiring an active workflow immediately returns traffic to the full agent" is a property of
the design rather than of an invalidation step.

## The schema

`supabase/migrations/20260920202604_workflow_registry_columns.sql` fills the three placeholder
tables M2-T5 created and drops their `payload jsonb` placeholder, which nothing ever wrote. The
M2 migration is not edited (ADR-0033: a migration is a fact about what was applied).

| Table | Columns added | Constraints |
|---|---|---|
| `workflow_definitions` | `workflow_key`, `job_type` | unique `(domain_id, workflow_key)` |
| `workflow_versions` | `domain_id`, `job_type`, `fingerprint`, `status`, `definition`, `compatibility`, `status_changed_at`, `metadata` | `status` check over the seven statuses; unique `(workflow_id, fingerprint)`; indexes `(status, id desc)` and `(domain_id, job_type, status, id desc)` |
| `workflow_promotions` | `from_status`, `to_status`, `actor`, `reason` | status checks on both |

`domain_id` and `job_type` on `workflow_versions` are **denormalized index columns**. The
router's only hot-path query is "every active version that could serve this job", and ADR-0036's
own rule is that stable indexed metadata lives in columns while versioned payloads live in
`jsonb`. The adapter reads the record's domain and job type from `compatibility`, never from the
columns, so a row that had drifted cannot look consistent.

Row-level security stays enabled with no policies, and ids stay `uuid` with no database default.

## Router and fallback (M5-T3 through M5-T7)

```ts
createRouter(options: CreateRouterOptions): Router      // AgentRuntime & { route(job) }
createCircuitBreaker(options: CreateCircuitBreakerOptions): CircuitBreaker
```

Both live in `@internal/registry`. [ADR-0044](../decisions/0044-the-router-is-an-agentruntime-and-a-fallback-travels-in-the-execution-context.md)
records the design; the envelope itself is documented in
[`workflow-ir.md`](workflow-ir.md).

### The router is an `AgentRuntime`

```ts
const router = createRouter({
  registry,                 // createWorkflowRegistry({ storage })
  capabilities,             // the domain's CapabilityRegistry
  workflowRuntime,          // createWorkflowRuntime({ registry: capabilities, ... })
  fullAgent,                // the AgentRuntime an unmatched or escalated job reaches
});

const harness = createHarness({ agentRuntime: router, trace, storage });
```

`createHarness()` gains no option and its contract does not change. That is what "the same harness
call can execute either workflow or full agent" means here: from the harness's point of view there
is still exactly one runtime.

It takes the **`CapabilityRegistry`**, not a manifest, because it needs both halves and is the only
thing that holds both: the selector compares a version's pinned capabilities against
`capabilities.toManifest()`, and `compileWorkflow()` resolves those pins to the actual schemas,
handlers, tools and policies. A router given only a manifest could choose a workflow it cannot run.

```text
run(job, context)
  └─ registry.resolve(job, { manifest, harnessVersion, sopFingerprint? })
       ├─ none  ─────────────────────────▶ fullAgent.run(job, context)
       └─ match ─▶ compile (cached by version id)
                     └─ workflowRuntime.run(compiled, job, context)
                          ├─ completed ──▶ the output
                          ├─ failed ─────▶ a failed run, never a completed one
                          ├─ aborted ────▶ aborted
                          └─ escalated ──▶ fullAgent.run(job, fallbackContext)
```

Three properties, none of them accidental:

- **Deterministic, with no model call.** The decision is `selectCompatibleWorkflow()`, a pure
  function. "Do not use an LLM to decide whether a known workflow exists" (M5-T3) is structural:
  the router has no model to ask.
- **Re-resolved on every run.** Compilation is cached by version id; routing is not. That is why
  retiring an active version returns traffic to the full agent immediately, with nothing to
  invalidate.
- **A workflow failure is a failed run.** Only an `escalated` result reaches the full agent. A
  defect is reported as a failure, because escalating one would hide a bug behind a working system.

`route(job)` answers the same question without executing, which is what an operator asking "why is
my workflow not getting traffic?" wants:

```ts
interface RouteDecision {
  route: "workflow" | "full-agent";
  version: WorkflowVersionRecord | null;
  compiled: CompiledWorkflow | null;
  rejections: readonly WorkflowRejection[];   // populated on a `full-agent` route
  refusal: RouteRefusal | null;               // circuit-breaker, or compile-failed
}
```

Every execution the router returns carries the same facts in `AgentExecution.metadata`
(`route`, `workflowVersionId`, `workflowId`, `workflowVersion`, `rejections`, and `fallback` when
one happened), plus two fields that are **not** metadata because they are ledger columns:
`workflowVersionId` and `fallbackCount`. `createHarness()` copies those into `RunFinish`, so
`runs.workflow_version_id` and `runs.fallback_count` are filled by whatever routed, and
`pnpm harness run show <run-id>` prints the version id on its `route:` line with no inspector
change.

### The fallback handoff

When the compiled path escalates, the router invokes the full agent with the **original immutable
job** and a context that differs from the run's in exactly three ways:

1. `fallback` is the envelope the interpreter built, with each completed node's **validated output
   filled in** from the run's records and the whole thing capped at
   `FALLBACK_ENVELOPE_MAX_BYTES` (64 KiB, harness-chosen because eve documents no limit). The
   interpreter leaves those outputs `null` and the router fills them, so `asAgentRuntime()`'s error
   payload stays lean and the size budget is applied once, in the one place that has an agent to
   hand the envelope to;
2. `budget` is what is left — the job's budget minus what the workflow spent, recalculated at the
   moment of handoff, floored at zero per dimension, with an absent dimension left absent;
3. `trace` is the same recorder reporting a different `rootId`: the escalation's
   `fallback.started` event.

That third point is what "the trace links the compiled run span to the fallback agent execution"
means in the event stream. An adapter parents its first event on `context.trace.rootId`, so the
agent's whole subtree hangs under the escalation:

```text
run.started
├─ node.started/node.completed …          the compiled path
├─ fallback.started                        reason, detail, nodeId, workflow id/version/fingerprint,
│  ├─ agent.started                        completed and trusted counts
│  │  ├─ model.started / model.completed
│  │  └─ …
│  ├─ agent.completed
│  └─ fallback.completed                   outcome, the agent runtime's name, its usage
└─ run.completed
```

There is still exactly one `TraceRecorder` and one sequence per run (ADR-0031). The interpreter
records `fallback.started` because only it knows why the path stopped, and returns that event's id
on `EscalatedWorkflowRun.fallbackSpanId`; the router records `fallback.completed` because only it
knows what happened next.

`WorkflowRuntime.asAgentRuntime()` still maps an escalation to a failure. That is for standalone
use, where there is no full agent to hand the job to, and it is the honest record of a fallback
with nowhere to go — such a run shows `fallback.started` with no `fallback.completed`. Anything
that should actually fall back uses the router.

### The circuit breaker

```ts
const breaker = createCircuitBreaker({
  storage,
  registry,
  window: { runs: 20 },
  thresholds: { fallbackRate: 0.5, failureRate: 0.2 },
});

const reading = await breaker.evaluate(versionId);
// { tripped, fallbackRate, failureRate, sample }

await breaker.trip(versionId, { actor: "david", reason: "fallback rate over 50%" });
```

`evaluate()` reads the version's most recent runs through `listRuns({ workflowVersionId })` — the
`RunFilter` field M5-T7 added to the port — and counts only **finished** ones. A `running` run has
no outcome yet and an `aborted` run is evidence about its caller, so neither is in the sample; an
empty sample never trips, because an untried workflow is not a failing one. The window is a count
of runs rather than a span of time, because a workflow that runs twice a day and one that runs
twice a minute need the same number of observations before anyone should conclude anything.

`trip()` retires the version through the registry and therefore takes an `actor`. **Nothing calls
it on a timer**: that is AD-005, and a breaker that retired versions by itself would be the harness
demoting its own workflows. A router given an optional `breaker` refuses *traffic* to a tripped
version without changing its status, which is the reversible half of the same idea.

## What M5 leaves for later

- **`shadow` and `canary`** are legal statuses that the selector refuses. They cost nothing until
  M6 gives them meaning.
- **A `jev` node's question is not validated at registration.** M4-T9 left that to M5 and M3
  together; the registry does not do it today.
- **`low_confidence` and `missing_evidence`** are reasons no interpreter raises. They are reserved
  for a policy layer that reads a judgment's confidence.

## Testing

- `packages/core/src/workflow-registry.test.ts` — the transition table exhaustively (every
  `from`/`to` pair), capability collection, compatibility derivation, the three parse boundaries,
  and every rejection reason of the selector plus the tie-break.
- `packages/registry/src/workflow-registry.test.ts` — the service against
  `createInMemoryStorage()`, including "registration never promotes" and "retiring returns
  traffic to the full agent".
- `packages/registry/src/router.test.ts` — routing, determinism, the escalation path, the trusted
  rule, budget recalculation, the trace link, and the breaker seam, all against in-memory storage
  and fake agent runtimes.
- `packages/registry/src/circuit-breaker.test.ts` — both thresholds, the empty sample, the window
  bound, and what is excluded from it.
- `apps/example-agent/src/workflow/vendor-triage-fallback.test.ts` — M5-T6's required integration
  test: the real domain, the real compiled workflow, the real router and the whole
  `createHarness()` path, proving the full agent finishes the job without repeating the research
  tool call.
- `packages/storage-supabase/src/storage.contract.test.ts` — the registry cases in the **shared**
  contract suite: round trip, list filtering and keyset paging, duplicate fingerprint rejected,
  illegal transition rejected, compare-and-set, and the promotion ledger. Both implementations
  run them.
