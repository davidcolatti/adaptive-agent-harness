---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/domain-definition.md
  - docs/contracts/execution-context.md
  - docs/contracts/agent-runtime.md
implementation:
  - packages/core
---

# Job

A `Job` is one immutable unit of work. It is defined in
`packages/core/src/job.ts` and was created by M1-T3, in the shape build plan
section 5 states.

**M2-T2 finalizes this schema.** The fields below are the build plan's,
unchanged; M2 adds what persistence and the run ledger need, and fixes the
identifier format. Nothing here is expected to be removed.

## The split from `ExecutionContext`

A job says *what* to do. An [`ExecutionContext`](execution-context.md) says
everything about *this attempt* at doing it. A retry reuses the same job and
receives a new context. That is why `attempt`, `trace` and `signal` are not
fields here, and why `budget` and `permissions` are: they are decided when the
job is created and do not change between attempts.

Every field is readonly, and `defineDomain()` freezes the object it returns.
"Jobs are immutable after execution begins" (M2-T2) is therefore a property of
the value, not a convention a caller has to honour.

## Shape

```ts
interface Job<TInput = unknown, TOutput = unknown> {
  readonly id: string;
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
| `id` | Unique identifier for this job. Opaque in M1. |
| `domain` | The domain and domain version the job belongs to, as `{ id, version }`. Stamped by `defineDomain()`. |
| `jobType` | Which kind of job this is within the domain, e.g. `vendor-triage`. |
| `objective` | What the job is for, in one sentence, addressed to whatever executes it. |
| `input` | The input, typed by the domain. |
| `contracts` | String references to the contracts the job was created under. |
| `budget` | The limits execution must stay inside. An absent dimension is unlimited. |
| `permissions` | The tools execution may use. An empty list grants nothing. |
| `metadata` | Domain-owned detail, serializable and free-form. |

`DomainRef`, `Budget`, `ToolGrant` and `JsonObject` are documented in
[the execution context contract](execution-context.md); the job and the context
deliberately use the same types rather than parallel ones.

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
`"procurement-sop"` by hand.

**Nothing resolves these strings yet.** The capability registry (M1-T9) is what
turns a reference into the value it names, and it is also what will fix the
reference format. Until then, they are honest labels: a job records which
contract version it was created under even though no code looks it up.

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

`defineDomain()` generates `id` with `crypto.randomUUID()`.

**M2-T1 replaces this.** That task chooses the sortable scheme (UUIDv7 or
equivalent) for every entity ID in the system, `job_id` among them. Nothing may
depend on the current format: it is an opaque string, not a v4 UUID that
anything is entitled to parse.

## Where jobs come from

Only from `DomainDefinition.createJob()`. A domain describes the body of the
job; the harness stamps `id` and `domain` and applies the defaults. See
[the domain definition contract](domain-definition.md).

## Open for later milestones

- **M2-T2** finalizes the schema and defines persistence.
- **M2-T1** fixes the identifier format.
- **M1-T9** defines what a `contracts` reference resolves to.
- `Job` has no `parentJobId` or workflow linkage yet. Subworkflows and fallback
  (build plan sections 5 and 9) will need one; inventing it now would be a guess.
