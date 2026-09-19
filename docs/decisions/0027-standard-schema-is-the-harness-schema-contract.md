---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M1-T3
related:
  - docs/contracts/domain-definition.md
  - docs/contracts/errors.md
  - docs/milestones/build-plan.md
supersedes: null
superseded_by: null
---

# ADR-0027: Standard Schema is the harness schema contract, declared structurally in core

## Context

Build plan section 5 types a domain definition as:

```ts
type DomainDefinition<TInput, TOutput> = {
  inputSchema: Schema<TInput>;
  outputSchema: Schema<TOutput>;
  // ...
};
```

and never says what `Schema<T>` is. Milestone 1 needs the answer, because two of
its acceptance criteria are "input is validated before execution" and "one
intentionally invalid output fails closed", and neither is expressible without
one.

Three constraints meet here:

- **`packages/core` declares no dependency and must keep none.** The dependency
  rule (build plan section 4, AGENTS.md) is enforced mechanically by
  `tests/architecture/boundaries.ts`, and `@internal/core` carries an explicit
  per-package ban as well.
- **Domains will use a real schema library.** `apps/example-agent` already
  depends on `zod@4.6.5`, because the `eve` tool it authors takes a zod
  `inputSchema`. A domain writing its contracts twice, once for the agent and
  once for the harness, would be a source of drift, not a boundary.
- **The error taxonomy is already schema-agnostic.** `ValidationError.issues`
  is `{ path, message }[]` (M1-T8), chosen so that whatever M1-T3 picked could
  normalize into it.

The no-assumption stop condition applies: nothing in `eve`, the AI SDK or the
build plan establishes a schema contract, so the harness must design one
explicitly rather than assume one.

## Decision

The harness schema contract is **Standard Schema v1**
(<https://standardschema.dev>), and `@internal/core` declares it
**structurally**, as its own interface, rather than importing it.

- `packages/core/src/schema.ts` defines `Schema<TOutput, TInput = unknown>`: an
  object with a readonly `~standard` property carrying `version: 1`, a string
  `vendor`, optional inferred `types`, and
  `validate(value: unknown) => SchemaResult<TOutput> | Promise<SchemaResult<TOutput>>`.
  The file carries an attribution comment naming the specification and its
  version. The parameter order is the harness's own (validated type first); the
  property names inside are the specification's, which is what structural
  compatibility depends on.
- A schema library MUST NOT be imported by `@internal/core`, now or later. Any
  library that implements the specification satisfies these types with no
  adapter and no registration step.
- `validateWith(schema, value, options?)` is the single conversion point between
  a schema and the harness error taxonomy. It MUST normalize the specification's
  issue shape to `ValidationIssue`, accepting both path forms the specification
  allows (a bare `PropertyKey`, or an object with a `key`), and MUST throw
  `ValidationError` on failure. It is asynchronous because the specification
  permits `validate` to return a promise.
- A value that does not publish a well-formed `~standard` MUST be rejected with
  a `ValidationError` carrying a root-path issue, not a `TypeError`, so that
  every failure crossing a harness boundary has one type to catch.
- A `symbol` path segment is rendered with `String()` rather than dropped,
  because `ValidationIssue.path` must survive `JSON.stringify` into a trace and
  dropping a segment would silently point the path at a different field.

## Consequences

### Positive

- `@internal/core` keeps zero dependencies while domains author schemas in a
  real library. The boundary test needs no exception.
- A consuming domain repository chooses its own schema library. `zod`, `valibot`
  and `arktype` all implement the specification; the harness never learns which
  one was used.
- The harness gains one validation choke point. Every schema failure anywhere in
  the system is a `ValidationError` with normalized issues, which is what makes
  "fails closed" a property of the harness rather than of a domain's care.
- Nothing has to be registered, wrapped or adapted. A zod schema *is* a
  `Schema<T>`, verified by `apps/example-agent/src/domain/domain.test.ts`.

### Negative

- The copy can drift if the specification publishes a v2. The mitigation is
  that `version` is a literal `1` in the type, so a v2-only schema fails to
  typecheck rather than failing at runtime, and the drift is a deliberate edit.
- The harness cannot use library-specific features: no `.describe()` metadata,
  no JSON Schema conversion, no error codes beyond `message` and `path`. A later
  milestone that needs JSON Schema (for a capability manifest, M1-T9, or for
  model-facing structured output, M1-T6) will need the separate
  `StandardJSONSchemaV1` surface or a per-library conversion behind an adapter.
- `validateWith` is asynchronous even for a synchronous library, so every
  validation site is `await`ed.

### Neutral

- The specification's own parameter order is `<Input, Output>` and the harness's
  is `<TOutput, TInput>`. That is naming only; assignability is structural.
- `zod@4.6.5` returns synchronously and emits bare `PropertyKey` path segments.
  The harness handles the asynchronous and object-segment forms anyway, because
  the specification permits them and another vendor may use them.

## Alternatives considered

- **Depend on `zod` in `@internal/core`.** Rejected: it breaks the zero-
  dependency rule the architecture test enforces, and it would force every
  consuming domain onto one schema library for the life of the harness. That is
  precisely the coupling ADR-0001 (a reusable package, not a domain monorepo)
  exists to avoid.
- **A harness-owned `Schema` interface with per-library adapter functions**
  (`fromZod(schema)`, `fromValibot(schema)`). Rejected: it is the same interface
  plus a conversion step, and the conversion is exactly what the Standard Schema
  specification already removed. It would also put a library-specific module
  somewhere in the workspace, which would then need an adapter package.
- **JSON Schema strings.** Rejected: it loses the TypeScript types entirely,
  so `DomainDefinition<TInput, TOutput>` would carry no real type information
  and `createJob(input)` would take `unknown`. It would also require a validator
  dependency anyway. JSON Schema remains the right format for the *serializable*
  capability manifest (M1-T9), which is a different problem: describing a schema
  to something outside the process rather than validating in it.
- **`validate(value): value is T` type-guard predicates written by hand.**
  Rejected: no issue detail, so `ValidationError.issues` would always be empty
  and "the issue points at the field" would be unachievable.

## References

- `docs/milestones/build-plan.md` §5 (Core Contracts, Domain definition)
- Standard Schema v1: <https://standardschema.dev>; the identical copy shipped
  by the installed `zod@4.6.5` at `zod/v4/core/standard-schema.d.ts`, and
  `zod/v4/core/schemas.d.ts` where `$ZodType` declares `"~standard"`
- Related ADRs: ADR-0001, ADR-0003, ADR-0024, ADR-0025, ADR-0026
- Related code paths: `packages/core/src/schema.ts`,
  `packages/core/src/domain.ts`, `apps/example-agent/src/domain/schemas.ts`
