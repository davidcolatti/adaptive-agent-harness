---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/job.md
  - docs/contracts/errors.md
  - docs/decisions/0027-standard-schema-is-the-harness-schema-contract.md
  - docs/decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md
  - docs/examples/README.md
implementation:
  - packages/core
  - apps/example-agent
---

# Domain definition

A `DomainDefinition` is what a consuming domain hands the harness: its identity,
its input and output schemas, how it turns an input into a [`Job`](job.md), and
its fixture cases. It is defined in `packages/core/src/domain.ts` and was
created by M1-T3.

Every value of this type comes from `defineDomain()`. That is the point of the
function: the invariants below hold of *every* domain definition, because there
is no other way to make one.

## Shape

```ts
interface DomainDefinition<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly version: string;
  readonly inputSchema: Schema<TInput>;
  readonly outputSchema: Schema<TOutput>;
  createJob(input: TInput): Job<TInput, TOutput>;
  readonly evals: readonly DomainEval<TInput, TOutput>[];
}
```

Build plan section 5 states this shape. The only addition is that `evals` is
always present, defaulting to the empty list rather than being absent.

## The schema contract

`Schema<TOutput, TInput = unknown>` is a harness-owned copy of
**Standard Schema v1** (<https://standardschema.dev>): an object with a
`~standard` property carrying `version: 1`, a `vendor` name, optional inferred
`types`, and a `validate` function. `@internal/core` declares it structurally
and imports no schema library, which is how the package stays at zero
dependencies while domains author schemas in `zod`, `valibot` or `arktype`.
[ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md)
records the decision and the alternatives.

There is no registration, adapter or conversion step. A `zod` schema **is** a
`Schema<T>`, because `zod@4.6.5` declares `"~standard"` on every schema type.

### `validateWith`

```ts
function validateWith<TOutput>(
  schema: Schema<TOutput>,
  value: unknown,
  options?: { label?: string },
): Promise<TOutput>;
```

The single conversion point between a schema library and the error taxonomy.
It returns the **parsed** value, which is not always the value it was given: a
schema may coerce or strip.

It throws [`ValidationError`](errors.md) in three cases, so that a caller has
one error type to handle:

| Case | Message | Issues |
| --- | --- | --- |
| the schema reported problems | `<label> failed validation` | one per reported issue, paths normalized |
| `schema` is not a Standard Schema | `<label> is not a Standard Schema` | one, with an empty path |
| `validate` itself threw | `<label> could not be validated: the schema threw` | one, with an empty path; the original is in `cause` |

It is asynchronous because the specification permits `validate` to return a
promise, even though the installed `zod` answers synchronously.

Path normalization handles both forms the specification allows: a bare
`PropertyKey`, and an object with a `key`. Both become
`ValidationIssue.path`, which is `(string | number)[]` because it has to survive
`JSON.stringify` into a trace. A `symbol` segment is rendered with `String()`,
so `Symbol("k")` becomes `"Symbol(k)"`; it is **not** dropped, because dropping
a middle segment would silently produce a path pointing at a different field.

`isSchema(value)` and `assertIsSchema(value, options?)` are the same structural
check on its own.

## `defineDomain`

```ts
export const vendorTriage = defineDomain({
  id: "vendor-triage",
  version: "1.0.0",
  inputSchema,
  outputSchema,
  createJob,
  evals,
});
```

`TInput` and `TOutput` are inferred from the two schemas; explicit type
arguments are never needed.

### What it validates

All of it throws `ValidationError` with an issue naming the offending field.

| Field | Rule | Why here |
| --- | --- | --- |
| `id` | Starts with a letter or digit, then letters, digits, `.`, `-`, `_`. No whitespace, no `/`, no `@`. | An ID that cannot be written into a contract reference such as `vendor-triage.input@1.0.0` is a registration-time problem, not a first-run one. The rule is deliberately lenient about style: a domain owns its own naming. |
| `version` | Exactly `major.minor.patch`, no leading zeros. No ranges, pre-release tags or build metadata. | A range would make "which version produced this trace" unanswerable, and a promoted workflow pins an exact version (ADR-0015). Nothing in the harness yet defines an ordering for pre-release tags. |
| `inputSchema`, `outputSchema` | Publish a well-formed `~standard`. | A domain that hands over something that is not a schema fails at registration rather than at its first validation. |
| `createJob` | Is a function. | Same reason. |

### What it returns

A **frozen** `DomainDefinition`, with `evals` copied and frozen too. A
registered domain cannot be repointed at a different schema or version after
something has been executed against it, and a caller cannot mutate its own
`evals` array into one.

### The `createJob` wrapper

The domain's own `createJob` returns a `CreateJobInput<TInput>`, which is a
`Job` **minus `id` and `domain`**:

```ts
interface CreateJobInput<TInput> {
  readonly jobType: string;
  readonly objective: string;
  readonly input: TInput;
  readonly contracts: JobContracts;
  readonly budget?: Budget;
  readonly permissions?: readonly ToolGrant[];
  readonly metadata?: JsonObject;
}
```

Omitting `domain` is deliberate. If a domain could return its own domain
reference, it could return one that disagrees with the definition it belongs to,
and every consumer downstream would have to check. Making it unstatable means
the disagreement cannot be expressed, which is stronger than validating it away.

The wrapper then:

1. calls the domain's `createJob`;
2. checks the returned body names a `jobType`, an `objective`, and all three
   `contracts` references, each a non-blank string;
3. stamps `domain` from the definition and generates `id`;
4. applies the defaults, each the conservative reading and the same one
   `createExecutionContext()` uses: `budget` defaults to `{}` (unlimited, not
   zero), `permissions` to `[]` (permission is explicit, so the default is
   denial), `metadata` to `{}`;
5. **deep-freezes** the job with `deepFreeze()`, so the nested `budget`,
   `permissions`, `contracts`, `metadata` and the JSON-shaped part of `input`
   are immutable too, not just the top level (M2-T2,
   [ADR-0032](../decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md)).
   A one-level `Object.freeze` would have left `job.budget.maxCostUsd` and
   `job.permissions[0].mode` writable, which are the two values that decide
   what an execution may spend and may do. The freeze is in place and reaches
   whatever `input` and `metadata` the domain returned, so a domain that means
   to keep mutating one of those should return a copy. See
   [the job contract](job.md) for where the depth stops.

### What it deliberately does not do

**`createJob` does not validate its input.** Validation before execution is
`createHarness()`'s job (M1-T4), so there is exactly one choke point where it
happens. A domain cannot accidentally skip it, and a caller does not get it
twice with two different error messages. A unit test asserts this:
`createJob` succeeds even when the domain's `inputSchema` rejects everything.

The same applies to output: a runtime's claimed output is re-validated against
`outputSchema` by the harness, not by the domain. That is what makes Milestone
1's "one intentionally invalid output fails closed" a property of the harness.

## `DomainEval`

```ts
interface DomainEval<TInput, TOutput> {
  readonly id: string;
  readonly description: string;
  readonly input: TInput;
  readonly expect?: (output: TOutput) => void | Promise<void>;
}
```

**This is the M1 shape, and M6 owns evals.** M6-T5 and M6-T6 define what is
actually measured (quality, cost, latency, false-auto rate, calibration) and
M6-T2 defines dataset splits. None of that is decided here, because M1 has no
execution to measure. What M1 needs is somewhere for a domain to write "here is
an input, and here is what a good answer looks like", so the example domain is
a worked example rather than a type declaration.

`expect` **throws** to fail. That is how every assertion library already
behaves, so a domain uses whichever one it has without the harness depending on
one or inventing a result type M6 would then replace. **Nothing runs these
cases yet.**

## A worked example

`apps/example-agent/src/domain/` is the vendor-triage domain: `schemas.ts`
(the `zod` input and output schemas, field names matching
`agent/instructions.md`), `procurement-sop.ts` (the SOP the fixture evals pass
in) and `index.ts` (the `defineDomain()` call). See
[the examples map](../examples/README.md).

## Open for later milestones

- **M1-T4** owns `createHarness()`, and with it validation before execution and
  re-validation of output.
- **M1-T9** defines what a `contracts` reference resolves to, and the
  serializable capability manifest a domain must be able to produce.
- **M6** replaces `DomainEval` with the real eval model.
- Nothing yet registers a domain anywhere. `defineDomain()` returns a value; it
  does not add it to a registry. Duplicate-ID detection is M1-T9's criterion.
