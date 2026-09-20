---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/domain-definition.md
  - docs/contracts/execution-context.md
  - docs/contracts/agent-runtime.md
  - docs/contracts/harness.md
  - docs/contracts/identifiers.md
  - docs/decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md
  - docs/decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md
implementation:
  - packages/core
---

# Job

A `Job` is one immutable unit of work. It is defined in
`packages/core/src/job.ts`, was created by M1-T3 in the shape build plan
section 5 states, and was **finalized by M2-T2**
([ADR-0032](../decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md)).

The field list did not change. What M2-T2 settled is everything around it:
immutability is deep rather than one level, the job the runtime receives is
*the* job, creation time comes from the id rather than from a field, an attempt
is not part of a job, and an untrusted value becomes a job by passing through
`parseJob()`.

## The split from `ExecutionContext`

A job says *what* to do. An [`ExecutionContext`](execution-context.md) says
everything about *this attempt* at doing it. A retry reuses the same job and
receives a new context. That is why `attempt`, `trace` and `signal` are not
fields here, and why `budget` and `permissions` are: they are decided when the
job is created and do not change between attempts.

## Shape

```ts
interface Job<TInput = unknown, TOutput = unknown> {
  readonly id: JobId;
  readonly domain: DomainRef;
  readonly jobType: string;
  readonly objective: string;
  readonly input: TInput;
  readonly contracts: JobContracts;
  readonly budget: Budget;
  readonly permissions: readonly ToolGrant[];
  readonly metadata: JsonObject;
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique identifier for this job: a sortable, branded `JobId` that also carries the creation time. |
| `domain` | The domain and domain version the job belongs to, as `{ id, version }`. Stamped by `defineDomain()`. |
| `jobType` | Which kind of job this is within the domain, e.g. `vendor-triage`. |
| `objective` | What the job is for, in one sentence, addressed to whatever executes it. |
| `input` | The input, typed by the domain, and expected to be JSON-representable. |
| `contracts` | String references to the contracts the job was created under. |
| `budget` | The limits execution must stay inside. An absent dimension is unlimited. |
| `permissions` | The tools execution may use. An empty list grants nothing. |
| `metadata` | Domain-owned detail, serializable and free-form. |

`DomainRef`, `Budget`, `ToolGrant` and `JsonObject` are documented in
[the execution context contract](execution-context.md); the job and the context
deliberately use the same types rather than parallel ones.

There is no `createdAt`, no `attemptId`, and no `parentJobId`. The first two are
decisions, below. The third is an absence: subworkflows and fallback (build plan
sections 5 and 9) will need a linkage field, and inventing it now would be a
guess.

## Immutability is deep

Every field is `readonly`, and the value is passed through `deepFreeze()` when
it is built. "Jobs are immutable after execution begins" (M2-T2) is therefore a
property of the value, not a convention a caller has to honour.

**Deep matters, and one level would not have been enough.** `Object.freeze` is
shallow: it stops `job.budget = {}` and does nothing about
`job.budget.maxCostUsd = 1e9`, `job.permissions[0].mode = "write"` or
`job.metadata.approved = true`. Those are the mutations that matter, because
each one widens what an execution may spend or may do while the run record
still names the original job.

Because every module here is an ES module and therefore strict, a write to a
frozen property **throws a `TypeError`**:

```ts
const job = vendorTriage.createJob(input);

job.budget.maxCostUsd = 1e9;       // TypeError
job.permissions[0].mode = "write"; // TypeError
job.metadata.approved = true;      // TypeError
```

### Where the depth stops

`deepFreeze` recurses into **arrays and plain objects only**. A `Date`, a `Map`,
a `Set`, a class instance or a function is left exactly as found: neither frozen
nor walked. So:

> A job is deeply immutable exactly as far as it is JSON-representable, which is
> exactly as far as it is persistable, traceable and replayable.

Two reasons, both about what `Object.freeze` can actually do. Freezing a `Date`
does not stop `setTime()` and freezing a `Map` does not stop `set()`, because
their state lives in internal slots rather than in properties, so the protection
would be advertised and absent. And freezing a class instance that caches into a
field breaks it, at a distance from the code that froze it.

This is the practical reason `input` is documented as something JSON should be
able to represent. A domain whose schema library hands back a `Date` gets a job
frozen around that value but not inside it.

`deepFreeze` freezes **in place** and returns its argument, so a domain that
returns a module-level constant as `metadata` will find the constant frozen. A
domain that means to keep mutating a value should return a copy.

## The effective job is the job

`harness.run()` accepts `budget`, `permissions` and `metadata` overrides. It
applies them **while building the job**, before anything executes, and the
result is the single authoritative value:

- it is what `AgentRuntime.run(job, context)` receives;
- it is what a trace records and what M2-T5 persists;
- it is what M6 replays;
- it carries the id `domain.createJob()` minted, because it is the same job.

There is no second job and nothing mutates the first. `effectiveJob` in
`harness.ts` is a local name for the second half of a two-step construction, not
a second contract type. See [the harness contract](harness.md) for the merge
rules.

## Creation time comes from the id

A `JobId` is an RFC 9562 UUIDv7 whose first 48 bits are the creation
millisecond, so a job needs no `createdAt` field and deliberately has none: two
sources of truth for one instant can disagree, with no rule for which wins.

```ts
import { entityIdTimestamp } from "@internal/core";

entityIdTimestamp(job.id); // a Date
```

A persisted row that wants a queryable timestamp column derives it there. The
value is the creation time to millisecond resolution, with the two bounded
caveats the [identifier contract](identifiers.md) documents: it can read
marginally ahead of the wall clock after a burst, and marginally behind it while
the system clock is stepped backwards.

## An attempt is not part of a job

`AttemptId` exists as a type (M2-T1) and `Job` has no field for it. An attempt
belongs to a run: a **retry reuses this job unchanged** and receives a new
`ExecutionContext`, which is where `attempt` lives. Where attempt identity
surfaces — as a trace field, a run-ledger column, or both — is M2-T3's and
M2-T5's decision, not this contract's.

## `JobContracts`

```ts
interface JobContracts {
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly sop: string;
}
```

These are **references, not schemas**. A job is serialized into a trace and a
run record, and a validator cannot survive `JSON.stringify`, so the job names
its contracts instead of embedding them. The example domain writes
`"vendor-triage.input@1.0.0"`, `"vendor-triage.output@1.0.0"` and
`"procurement-sop"`.

The two schema references are capability references, `id@version`, resolved
through `parseCapabilityRefString` and the capability registry (M1-T9). The SOP
reference is a **bare identifier** with no version, because a SOP is content
rather than a registered executable capability, which is why M1-T9 deliberately
left `procurement-sop` unregistered.

**Three fields, and M2-T2 added no fourth.** If M2-T8's behavior fingerprint
concludes that a SOP reference has to name a version, that is a contract change
with an ADR; it is recorded as an open question in ADR-0032 rather than
anticipated with a field.

## `parseJob`: reading a job back

M2-T5 reads a job out of a Supabase row, M2-T10's inspector reads a stored run,
and M6 replays frozen evidence. All three hold an `unknown` that claims to be a
job.

```ts
import { isJob, parseJob } from "@internal/core";

const job = parseJob(JSON.parse(row.job));      // Job<unknown, unknown>, or throws
parseJob(value, ["row", "job"]);                // issue paths prefixed for a caller
isJob(value);                                   // the predicate form; freezes nothing
```

What it checks:

| Field | Rule |
| --- | --- |
| `id` | A lowercase UUIDv7, via `parseEntityId("job", …)`. |
| `domain` | An `{ id, version }` pair, by the rule `defineDomain()` applies. |
| `jobType`, `objective` | Non-empty strings. |
| `input` | A JSON value. |
| `contracts.inputSchema`, `contracts.outputSchema` | `id@version` capability references. |
| `contracts.sop` | A bare identifier. |
| `budget` | Known dimensions only; each a finite number >= 0; whole for `maxDurationMs`, `maxModelCalls` and `maxToolCalls`; fractional for `maxCostUsd`. |
| `permissions` | Tool grants: non-empty `toolId`, `read`/`write` mode, optional non-empty `scope`. |
| `metadata` | A JSON object. |

Four properties of it are worth knowing before calling it:

- **It does not validate the input against the domain's schema, and cannot.** It
  has no domain to ask. Typed validation stays with
  `DomainDefinition.inputSchema` and the one choke point `createHarness()`
  already owns. That is also why the return type is `Job<unknown, unknown>`: a
  caller that knows the domain narrows with the domain's own schema, and a
  caller that does not gets the honest type.
- **It reports every problem at once**, each at the path of the field that
  caused it, in the same `collectRefIssues` style the rest of the package uses.
- **An unknown field is an error, not something to drop** — at the top level, in
  `contracts`, in `budget` and in a grant. A job is a closed contract whose
  purpose is reproducibility, so discarding a field on read loses data from the
  record that is meant to be complete. A mistyped budget dimension would
  otherwise read as unlimited.
- **The returned job is deep-frozen**, and the freeze reaches the `input` and
  `metadata` values it shares with the argument. A caller that intends to keep
  mutating what it passed should pass a copy.

Producer and validator are held together by a test: for a job the harness built,
`parseJob(JSON.parse(JSON.stringify(job)))` deep-equals it.

## `TOutput` is a phantom type parameter

Nothing in a job's data mentions its output. The output is produced later, by
the runtime. But `AgentRuntime.run(job, context)` has to infer the output type
from the job it is handed, and a type parameter that appears nowhere in a type's
structure does not participate in inference: `Job<I, A>` and `Job<I, B>` would
be the same structural type, and every `run()` would infer `unknown`.

The parameter is therefore carried by a marker property under a `unique symbol`
key, declared and never assigned:

```ts
export declare const JOB_OUTPUT_TYPE: unique symbol;

interface Job<TInput = unknown, TOutput = unknown> {
  // ...
  readonly [JOB_OUTPUT_TYPE]?: TOutput;
}
```

It is optional, so no value ever supplies it; it is symbol-keyed, so it can
never collide with a real field or appear in JSON; and it is `declare`d, so
nothing is emitted for it at runtime. It is not re-exported from the package
barrel, because it is not something a caller should name. Reading it is never
correct.

## Identifiers

`defineDomain()` generates `id` with `newJobId()`, which mints a sortable
RFC 9562 UUIDv7 (M2-T1,
[ADR-0030](../decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md)).
Jobs created in order therefore sort in order.

`JobId` is a branded string: at runtime it is a plain lowercase UUID that needs
no unwrapping to serialize, and at compile time it is distinct from `RunId` and
from a bare `string`, so the two cannot be transposed. Build one with
`newJobId()`, or turn an untrusted value into one with
`parseEntityId("job", value)`. The full scheme, its ordering guarantee, the
timestamp helpers and the other eleven brands are in
[the identifier contract](identifiers.md).

## Where jobs come from

Only from `DomainDefinition.createJob()`, whose result `createHarness()`
completes with the run's overrides. A domain describes the body of the job; the
harness stamps `id` and `domain`, applies the defaults, applies the overrides
and freezes the result. See [the domain definition contract](domain-definition.md).

## Open for later milestones

- **M2-T3 and M2-T5** decide where attempt identity surfaces, which is why
  `Job` has no attempt field.
- **M2-T5** stores a job. `parseJob`'s rules are the written specification its
  columns and constraints have to match.
- **M2-T8** may find that a SOP reference needs a version. That is a change to
  `JobContracts`, recorded as an open question in ADR-0032.
- **M4** will need workflow linkage (`parentJobId` or similar) for subworkflows
  and fallback. Nothing claims one yet.
