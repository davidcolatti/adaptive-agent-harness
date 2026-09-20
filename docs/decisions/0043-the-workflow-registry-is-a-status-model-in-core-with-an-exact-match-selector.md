---
status: accepted
date: 2026-09-20
deciders: harness maintainers
related: [0005, 0015, 0030, 0033, 0036, 0038]
supersedes: null
superseded_by: null
---

# ADR-0043: The workflow registry is a status model in core with an exact-match selector

## Context

Milestone 5 has to answer one question on every job: run a compiled workflow, or run the full
agent? Build plan M5-T1 gives seven workflow statuses and nothing else — no edges between them,
no record shape, no storage. M5-T2 lists six things a workflow declares (domain, job type,
supported input schema, required capabilities, SOP compatibility, minimum harness version) and
one prohibition, "never route only by string name". M5-T3 requires the initial routing to be
deterministic and forbids asking a model whether a known workflow exists.

Four earlier decisions constrain what this can look like.

- **AD-005** puts a human in front of every promotion. Autonomous promotion is a later
  capability and must never bypass evaluation.
- **AD-015** requires a promoted workflow to pin its capabilities at exact versions, and
  [ADR-0039](0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md) already
  settled that schema compatibility is reference equality on `id@version` rather than structural
  comparison.
- **[ADR-0038](0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md)** put
  the workflow IR in `@internal/core` and behaviour over it in `@internal/workflow`, and
  deliberately left `WorkflowDefinition.domain` unpinned to a domain version.
- **[ADR-0036](0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md)**
  made `Storage` a core port with keyset paging, created `workflow_definitions`,
  `workflow_versions` and `workflow_promotions` as minimal keyed placeholders, and pointed
  `runs.workflow_version_id` at the second of them.

The build plan's dependency diagram puts `registry` under `workflow`, and section 4 states that
no domain package may mutate harness registry tables directly.

## Decision

### The status model lives in `@internal/core`; the service lives in `packages/registry`

`packages/core/src/workflow-registry.ts` declares `WORKFLOW_STATUSES`,
`WORKFLOW_STATUS_TRANSITIONS`, `canTransition()`, `WorkflowCompatibility`, `WorkflowRecord`,
`WorkflowVersionRecord`, `WorkflowPromotionRecord`, their parse boundaries,
`collectRequiredCapabilities()`, `describeWorkflowCompatibility()` and
`selectCompatibleWorkflow()`. All of it is data and pure functions with no I/O.

`@internal/registry` holds `createWorkflowRegistry({ storage, clock })`, which needs the
`Storage` port and a `CompiledWorkflow` and is therefore not a contract. This is the split
ADR-0038 already made for the IR and ADR-0031 made for the trace: core states what something
*is*, a package beside it does the work. `@internal/registry` is **not** an adapter and carries
core's dependency bans.

### The transition table

```text
draft     -> candidate | rejected
candidate -> shadow | canary | active | rejected
shadow    -> canary | active | retired | rejected
canary    -> active | retired | rejected
active    -> retired
retired   -> (terminal)
rejected  -> (terminal)
```

A transition to the same status is **not** a transition. There is no edge back into `draft` and
none out of a terminal state: a version's identity is its IR fingerprint, so "the same workflow,
reworked" is a different version, and a retired version coming back would make the promotion
ledger unreadable. `active -> rejected` is deliberately absent — `rejected` is a verdict on a
version that never served, and retiring one that did is a different statement.

Nothing in the harness performs a transition on its own. Every method that moves a status takes
an `actor`, which is AD-005 made structural rather than remembered.

### What a version declares, and how it is matched

`WorkflowCompatibility` is M5-T2's six declarations plus the output schema, which is added
because a workflow producing a different shape from the one the job promises its caller would be
a type error nobody checked. It is **derived** from the compiled IR by
`describeWorkflowCompatibility()`, not authored, so a version cannot declare compatibility its IR
does not have. The one field the IR cannot supply is `sop`, which is passed at registration.

`selectCompatibleWorkflow(job, candidates, env)` is pure and applies nine checks in this order,
reporting the **first** failure as the rejection reason:

| # | Check | Reason |
| --- | --- | --- |
| 1 | `status === "active"` | `not-active` |
| 2 | `domainId === job.domain.id` | `domain-mismatch` |
| 3 | `jobType === job.jobType` | `job-type-mismatch` |
| 4 | `inputSchema === job.contracts.inputSchema` | `input-schema-mismatch` |
| 5 | `outputSchema === job.contracts.outputSchema` | `output-schema-mismatch` |
| 6 | every `requiredCapabilities` entry is in the manifest at that exact version | `missing-capability` |
| 7 | `sop === job.contracts.sop` | `sop-mismatch` |
| 8 | both fingerprints present and equal | `sop-fingerprint-mismatch` |
| 9 | `minHarnessVersion <= harnessVersion` | `harness-too-old` |

Every comparison is exact. Schemas compare as reference strings (ADR-0039), capabilities resolve
at the version written and nowhere else (AD-015), and **the workflow's `id` is never consulted**,
which is the build plan's "never route only by string name" enforced rather than intended. The
minimum harness version is the one place versions are *ordered* rather than compared for
equality, by `compareExactVersions()`, because refusing a newer harness would retire every
workflow on every release.

### The tie-break is the newest version id

When more than one active version matches, the version with the greatest `WorkflowVersionId`
wins. Ids are UUIDv7 (ADR-0030), so that is the most recently registered one. It is stated rather
than left to array order because "registry lookup is deterministic and unit-tested" is a
Milestone 5 acceptance criterion and the order a store returns rows in is not part of any
contract.

### Promotions are a ledger

Every status change appends one `workflow_promotions` row carrying `from_status`, `to_status`,
`actor`, `reason` and a timestamp. A version's history is therefore readable in full rather than
from a column that remembers only the last move, which is what AD-005's "explicit developer
approval" needs to be auditable. `parseWorkflowPromotionRecord()` re-checks the transition table,
so a stored row claiming an impossible move is rejected at the read boundary.

`Storage.setWorkflowVersionStatus()` is a **compare-and-set**: the caller states the status the
version must currently be in, and the Supabase implementation applies it as a single conditional
update. Two processes promoting the same version cannot both succeed. The ledger row is appended
after the status moved, so a row exists only for a transition that happened; PostgREST offers no
transaction across the two statements, so the residual failure mode is a status change whose
ledger row is missing, which raises a `StorageError` and is visible afterwards as a version whose
status disagrees with its last promotion.

### The fingerprint is the version's identity

`(workflowId, fingerprint)` is unique, so registering byte-identical IR twice is a conflict
rather than two rows. `WorkflowVersionRecord` therefore carries **no `canonicalJson` field**: it
is a pure function of `definition`, and a stored second copy could disagree with the definition
it claims to encode. `parseWorkflowVersionRecord()` goes further and **recomputes** the
fingerprint from the stored IR and rejects a row whose digest and definition disagree.

### The migration

`supabase/migrations/20260920202604_workflow_registry_columns.sql` adds the real columns to the
three placeholder tables and drops their `payload jsonb` placeholder, which nothing ever wrote.
The M2 migration is not edited: a migration is a fact about what was applied, and rewriting one
makes the committed history stop describing any database that ever existed (ADR-0033). RLS stays
enabled with no policies (ADR-0036), ids stay `uuid` with no database default (ADR-0030), and
`pnpm supabase:reset` followed by `pnpm supabase:types` regenerates the committed
`database.types.ts`.

`workflow_versions` carries `domain_id` and `job_type` as **denormalized index columns**, beside
the authoritative copies inside `compatibility`. The router's only hot-path query is "every
active version that could serve this job", and ADR-0036's own rule is that stable indexed
metadata lives in columns while versioned payloads live in `jsonb`. The adapter reads the
record's domain and job type from `compatibility`, never from the columns, so a row that had
drifted cannot look consistent.

## Consequences

### Positive

- Routing is decidable from data alone. `selectCompatibleWorkflow()` takes candidates and an
  environment and returns a match or a list of typed rejections, so the router (M5-T3) is a thin
  deterministic shell and every rejection reason is unit-testable without a database.
- A rejected job says *why* in a closed vocabulary, which is what M7 needs to find out what the
  compiler keeps getting wrong.
- Retiring an active version returns traffic to the full agent immediately, because nothing
  caches the candidate list between the registry and the store.
- Registering the same behaviour twice is impossible, and a stored version whose digest and IR
  disagree cannot be read back at all.

### Negative

- A capability version bump silently makes every pinned workflow incompatible until a new version
  is registered and promoted. That is AD-015 working as designed, but it means the fallback rate
  moves for a reason that looks unrelated to the workflow.
- `describeWorkflowCompatibility()` needs an SOP identifier the IR does not carry, so
  registration has one argument that cannot be derived and must be right.
- The status change and its ledger row are two statements, not one transaction.
- `domain_id` and `job_type` on `workflow_versions` are a third copy of two values.

### Neutral

- Six methods join the `Storage` port rather than forming a second port. A run's ledger row
  already carries `workflowVersionId`, and a registry behind its own port would be a second thing
  to configure against the same database.
- `shadow` and `canary` are legal statuses with no behaviour behind them yet. The selector
  refuses both, so they cost nothing until M5-T3 and M6 give them meaning.

## Alternatives considered

- **Statuses as a bare list with no transition table.** The build plan gives seven names and no
  edges, so "any status may follow any status" was available. It would have made
  `active -> draft` and `retired -> active` legal, and the promotion ledger meaningless.
- **Automatic promotion once evals clear.** Directly forbidden by AD-005 and by the scope
  discipline list ("autonomous promotion").
- **Routing by workflow id or name.** Explicitly forbidden by M5-T2: "Never route only by string
  name."
- **Structural schema comparison.** Rejected for the reason ADR-0039 already rejected it: two
  schemas that look alike today are not the same contract, and the reference form is what
  `Job.contracts` already carries.
- **Semver *ranges* for capability pins.** Rejected by AD-015, which requires exact versions;
  ordering is used only for the harness minimum, where a pin would retire every workflow on every
  harness release.
- **Storing `canonicalJson` beside the definition.** Rejected: a derived value stored twice is a
  value that can disagree with itself.
- **Tie-breaking on the IR's `version` field.** Rejected: it is author-supplied and two versions
  may carry the same string, while the id is minted and totally ordered.
- **A second `WorkflowRegistryStorage` port.** Rejected: one database, one configuration, one
  contract suite.
- **Joining `workflow_definitions` for the router's filter instead of denormalizing.** Rejected:
  it makes the only hot-path query depend on PostgREST's embedded-resource filtering and breaks
  the single-table keyset paging every other list on the port uses.

## References

- `docs/milestones/build-plan.md` — Milestone 5 (M5-T1, M5-T2, M5-T3), section 4 (dependency
  rule), AD-005, AD-015, AD-016.
- Related ADRs: ADR-0005 (human promotion first), ADR-0015 (typed capability registry), ADR-0030
  (UUIDv7 ids), ADR-0033 (Supabase CLI and the reset gate), ADR-0036 (`Storage` as a core port),
  ADR-0038 (IR in core, behaviour beside it), ADR-0039 (reference equality for schemas).
- Related code paths: `packages/core/src/workflow-registry.ts`, `packages/core/src/storage.ts`,
  `packages/registry/src/`, `packages/storage-supabase/src/supabase-storage.ts`,
  `packages/testing/src/in-memory-storage.ts`,
  `supabase/migrations/20260920202604_workflow_registry_columns.sql`.
- Contract: `docs/contracts/workflow-registry.md`.
