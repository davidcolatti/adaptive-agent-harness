---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md
  - docs/decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md
  - docs/contracts/job.md
  - docs/contracts/execution-context.md
  - docs/contracts/harness.md
implementation:
  - packages/core
---

# Entity identifiers

Every entity the harness names carries a **sortable, branded identifier**. The
scheme is defined in `packages/core/src/ids.ts`, was created by M2-T1, and is
recorded in
[ADR-0030](../decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md).

Two separate properties are being bought, and it is worth keeping them apart.

- **Sortability.** An id sorts lexicographically in creation order, so a run
  ledger or a trace listing ordered by id is in the order things happened, and
  an id works as a pagination cursor and as a tiebreaker between two events that
  share a timestamp.
- **Type distinctness.** A run id and a job id are both UUID strings. The brands
  make passing one where the other belongs a compile error.

This contract is separate from
[`identifiers.ts`'s other rule](domain-definition.md), the `{ id, version }`
naming rule that `defineDomain()` and the capability registry share. That rule
is about *names a human writes* (`vendor-triage`, `1.0.0`); this one is about
*ids a machine mints*.

## The scheme

`ENTITY_ID_SCHEME` is `"uuidv7"`. It is a constant so a persisted record can
state which scheme it was written under, the same way `FINGERPRINT_ALGORITHM_PREFIX`
lets a stored fingerprint state its algorithm.

An id is an RFC 9562 version 7 UUID in the usual `8-4-4-4-12` textual form:

```text
01a0bc70-c781-7e42-901d-04ec7e8d85ee
│              │  │ │  │
│              │  │ │  └─ rand_b, 62 random bits
│              │  │ └─ variant, bits `10`
│              │  └─ rand_a, a 12-bit monotonic counter
│              └─ version, always `7`
└─ Unix milliseconds, 48 bits
```

**Lowercase only.** An uppercase spelling is rejected, never normalized: an id
is compared and sorted as a string, and two spellings of one id would break both
comparison and any index built on it.

## The ordering guarantee

Within one process, ids are **strictly increasing**. Generating them in a loop
and sorting the result reproduces creation order exactly, with no equal pairs.

That is stronger than the UUIDv7 format alone provides, and it is the reason the
harness owns the generator rather than calling Node's `crypto.randomUUIDv7()`.
The Node built-in's own documentation says its timestamp "is not guaranteed to
be strictly increasing", and measured on the pinned Node 24.21.0 roughly half of
20 000 consecutive ids came out non-increasing, because ids minted inside the
same millisecond are ordered only by their random bits. ADR-0030 has the
measurement and the reasoning.

The generator adds RFC 9562 §6.2 Method 1, a fixed bit-length dedicated counter
in `rand_a`:

| Situation | What happens |
|---|---|
| A new millisecond | The counter resets to 0; the timestamp alone orders the id. |
| The same millisecond | The counter increments, and a larger counter is a larger string. |
| The system clock steps backwards | Treated as the same millisecond, so the counter increments. An id never goes down, even when `Date.now()` does. |
| More than 4096 ids in one millisecond | The timestamp borrows 1 ms forward and the counter resets. Ordering holds; the embedded time becomes approximate. |

**Across processes, ordering is carried by the timestamp alone**, to millisecond
resolution. Two processes minting inside one millisecond have no happens-before
relationship to preserve, and none is claimed.

## The twelve brands

`EntityId<TKind>` is a `string` carrying a phantom property under a
`unique symbol` key, the same idiom `Job` uses for its phantom output marker.
**The runtime representation is a plain string**: an id serializes, indexes and
compares with no unwrapping, and a branded id still assigns to `string`, so
nothing has to convert it to put it in a trace payload.

| Type | Entity | Minted by | Where it appears today |
|---|---|---|---|
| `JobId` | One unit of work | `newJobId()` | `Job.id`, `ExecutionContext.jobId`, `HarnessRunResult.jobId` |
| `RunId` | One run of a job | `newRunId()` | `ExecutionContext.runId`, `TraceEvent.runId`, `HarnessRunResult.runId` |
| `AttemptId` | One attempt within a run | `newAttemptId()` | nowhere yet; not on `Job` (M2-T2), so M2-T3/M2-T5 decide |
| `TraceEventId` | One trace event | `newTraceEventId()` | nowhere yet; M2-T3 decides |
| `WorkflowId` | One workflow across versions | `newWorkflowId()` | nowhere yet; M4 |
| `WorkflowVersionId` | One version of one workflow | `newWorkflowVersionId()` | nowhere yet; M4 |
| `NodeExecutionId` | One execution of one node | `newNodeExecutionId()` | nowhere yet; M4 |
| `DecisionId` | One decision-engine judgment | `newDecisionId()` | nowhere yet; M3 |
| `EvalRunId` | One evaluation run | `newEvalRunId()` | nowhere yet; M6 |
| `LearningRunId` | One learning run | `newLearningRunId()` | nowhere yet; M7 |
| `CompilerRunId` | One compiler run | `newCompilerRunId()` | nowhere yet; M8 |
| `PromotionId` | One promotion | `newPromotionId()` | nowhere yet; M6 |

These are the twelve the build plan's M2-T1 lists. Nine of them have no field on
any contract yet, and that is deliberate: the *type* exists so a later milestone
does not invent a thirteenth scheme, but inventing the field now would publish a
guess as a contract.

## Generating

Twelve zero-argument generators, one per entity:

```ts
import { newJobId, newRunId } from "@internal/core";

const jobId = newJobId();   // JobId
const runId = newRunId();   // RunId
```

They are twelve functions rather than one `newEntityId(kind)` because the kind
has no runtime meaning at generation time: every id is the same string whatever
it names, so a generic generator would take an argument purely to pick a return
type.

## Validating

```ts
import { isEntityId, parseEntityId } from "@internal/core";

isEntityId(value);                        // boolean type guard, kind-agnostic
parseEntityId("run", value);              // RunId, or throws ValidationError
parseEntityId("job", row.job_id, ["row", "job_id"]);
```

`parseEntityId` is the boundary function: a value from a database row, a request
body or a stored trace arrives as `unknown` and becomes a branded id only by
passing through it. It throws `ValidationError` with the issue at the path the
caller supplies, following the same convention as `collectRefIssues`.

Parsing is generic where generating is not, because here the kind does something
real: it names the entity in the failure message. `isEntityId` is deliberately
kind-agnostic, since the scheme encodes a timestamp, a counter and entropy and
nothing about which entity an id names. No guard can recover a kind from a
string; the surrounding type is what carries that knowledge.

## Reading the creation time back

The first 48 bits of an id **are** its creation time, so an entity does not need
a separate `createdAt` field and `Job` deliberately has none (M2-T2,
[ADR-0032](../decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md)).
Two sources of truth for one instant can disagree, with no rule for which wins.

```ts
import { entityIdTimestamp, entityIdTimestampMs } from "@internal/core";

entityIdTimestamp(job.id);   // a Date
entityIdTimestampMs(job.id); // Unix milliseconds
```

Both throw a `ValidationError` for anything that is not a well-formed id in this
scheme, and both take the same optional issue-path argument as `parseEntityId`,
so a caller reading a database row can point at the column. Refusing rather than
returning a plausible-looking date is the point: a v4 UUID's leading bits are
random, and reading them as a timestamp would produce a confident wrong answer.

The value is the creation time **to millisecond resolution**, and it inherits
two bounded caveats from the ordering guarantee above:

| Situation | Effect on the derived time |
|---|---|
| A burst past 4096 ids in one millisecond | The timestamp is borrowed forward, so it reads marginally **ahead** of the wall clock. |
| The system clock steps backwards | The timestamp is held, so it reads marginally **behind** it until the clock catches up. |

Both are the price of an id that never goes down. Treat the value as the
creation time, not as an audited clock reading.

## What an entity id is not

**It is not a capability token.** The timestamp and counter are not secret, and
the first id of any millisecond has a `rand_a` of `000`. Unguessability rests on
the 62 random bits of `rand_b`, which is enough to make an id hard to guess but
is not an authorization mechanism. Permission is `ToolGrant` and the approval
machinery, never knowledge of an id.

**It is not a sequence number.** `TraceEvent.sequence` still exists and still
orders events within a run. An id orders globally and approximately; a sequence
orders locally and exactly.

## Open for later milestones

- **M2-T2 decided that an attempt is not part of a job** (ADR-0032). An attempt
  belongs to a run, a retry reuses the job unchanged, and `AttemptId` therefore
  still has no field. Where attempt identity surfaces is M2-T3's and M2-T5's
  decision; `ExecutionContext.attempt` stays a number.
- **M2-T3** defines the real trace-event schema, including where `TraceEventId`
  lands.
- **M2-T5** chooses the column type. A `uuid` column is the obvious fit, with
  the caveat that its ordering must be verified to match the textual ordering
  this scheme guarantees; a `text` column trivially matches it.
- Ordering across processes is bounded by millisecond clock resolution and
  nothing refines it. A future distributed ledger that needs a total order will
  need more than an id.
