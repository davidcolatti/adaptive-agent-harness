---
status: accepted
date: 2026-09-19
deciders: coding agent (implementer) during M1-T8; recorded under ADR-0016
related: [0010, 0014, 0016]
supersedes: null
superseded_by: null
---

# ADR-0026: Harness errors serialize to a whitelisted, stack-free trace-safe shape

## Context

M1-T8 requires the nine-class error taxonomy (`ValidationError`,
`BudgetExceededError`, `PermissionDeniedError`, `ToolExecutionError`,
`AgentExecutionError`, `DecisionError`, `WorkflowError`, `StorageError`,
`ReplayMismatchError`) and states one further requirement about all of them:
"Every error must be serializable into a trace-safe representation." The build
plan does not define what "trace-safe" means, which under the no-assumption
stop condition (AGENTS.md) makes it a harness-owned choice that has to be made
explicitly rather than implied by whichever implementation lands first.

Three constraints already in the repository decide what the choice has to
satisfy. ADR-0010 makes the trace a product surface rather than debug logging,
captured from the first working run and read by replay, evaluation, learning
and cost analysis long after the code that produced it changed. Milestone 2's
acceptance criteria require that "seeded secrets never appear in stored trace
payloads," with redaction (M2-T9) as a separate pipeline stage. North-star
invariant 3 requires every workflow version to be inspectable, which in
practice means a stored failure has to be readable by a human who does not have
the original process.

The default JavaScript behaviour is the opposite of all three.
`JSON.stringify(new Error("x"))` yields `{}`, because `Error`'s own fields are
non-enumerable, so an error written to a trace naively loses its message
entirely. The obvious correction, enumerating the error's own properties, goes
too far the other way: it publishes whatever anyone happened to attach to the
error object, including credentials attached by a failing client library, and
it publishes `stack`, which carries absolute filesystem paths and internal
module structure. A cause chain adds two further hazards: it can be arbitrarily
long, and it can cycle.

## Decision

Every harness error MUST serialize through a single function,
`serializeError(error: unknown): SerializedHarnessError`, and through
`HarnessError.prototype.toJSON()`, which MUST return the same value so that
`JSON.stringify` of an error is safe by default rather than by convention.

Serialization MUST be a **whitelist**. The serialized form contains exactly
`name`, `code`, `message`, an optional `details`, an optional `cause`, and an
optional `stack`. No other property of an error is read, whether the error is a
`HarnessError` or any other throwable. Enumerating an error's own properties is
prohibited.

`stack` MUST be omitted by default and included only when the caller explicitly
passes `includeStack`. A stack MUST NOT be written to a persisted trace.

`details` is the only free-form field, MUST be typed `JsonObject`, and MUST
carry only what the thrower explicitly chose to publish, plus the concrete
error class's own typed fields, which the class merges in so that a serialized
error does not lose its dimension, tool ID or fingerprints. `details` is NOT a
redaction boundary: removing a secret a caller deliberately placed there
remains M2-T9's responsibility.

Every failure MUST carry a stable machine discriminant, `code`, drawn from the
closed `HarnessErrorCode` union, separate from `name`, which carries the class
name for humans. Consumers MUST branch on `code`, not on `name` or on
`instanceof`, when reading stored evidence. The code scheme is
`SCREAMING_SNAKE_CASE` of the class name with the trailing `Error` dropped.

`serializeError` MUST be total: it accepts `unknown`, because `catch` binds
`unknown` under this repository's `useUnknownInCatchVariables`, and it MUST NOT
throw. A non-`Error` throwable serializes as
`{ name: "NonError", code: "UNKNOWN", message: String(value) }` with its
properties never read, and a value that cannot be stringified MUST still
produce a result rather than raise.

A `cause` chain MUST be serialized to a bounded depth
(`MAX_SERIALIZED_CAUSE_DEPTH`, currently 5) and MUST be replaced at the cap by
an explicit truncation marker rather than silently cut. The cap is also what
makes a cyclic `cause` chain terminate.

`SerializedHarnessError` MUST be assignable to `JsonObject`, so a serialized
error can be embedded in a trace payload or stored as JSONB with no further
conversion, and that assignability MUST be asserted at the type level.

## Consequences

### Positive

- A stored failure is readable years later without the original process:
  `code` survives class renames, and the message and published context survive
  serialization, which is what ADR-0010's "reconstruct execution without
  application logs" requires of the failure path.
- Secret leakage through errors becomes a bounded, reviewable problem. The
  harness cannot leak a value nobody chose to publish, so M2-T9's redaction has
  one field to inspect (`details`) rather than an open set of error properties.
- The failure path cannot itself fail. A totalized serializer means a hostile or
  malformed throwable produces a trace entry instead of a second exception
  during error handling.
- Trace payload size from a failure is bounded, and a cyclic cause chain is not
  a denial-of-service against the trace writer.

### Negative

- A field a subclass adds is invisible to the trace unless that subclass merges
  it into `details`. This is a real ongoing obligation on whoever adds the
  tenth error class, and nothing mechanical enforces it today beyond the
  per-class unit tests.
- Debugging a failure from a trace alone is harder without stacks. The
  `includeStack` option exists for local output, so the cost is felt when
  diagnosing from stored evidence rather than at the keyboard.
- Deliberately publishing a secret through `details` is still possible. This
  decision narrows the attack surface; it does not close it, and M2-T9 remains
  required.

### Neutral

- Constrains `packages/core` now, and `packages/trace`, `packages/storage-supabase`
  and `packages/replay` when they land, since all three consume the serialized
  form.
- Fixes the code scheme for any future error class, which is a naming
  constraint rather than an architectural one.

## Alternatives considered

- **Serialize an error's own enumerable properties.** Rejected: it publishes
  whatever a failing dependency attached to the error, which is exactly the
  seeded-secret failure Milestone 2's acceptance criteria forbid, and it makes
  the serialized shape unpredictable across library versions.
- **Include stacks by default and redact them later.** Rejected: redaction
  (M2-T9) removes secret *values*, not filesystem paths and module structure,
  so a stack would survive it. Excluding stacks at the source is the cheaper and
  more reliable order.
- **Discriminate on `instanceof` or on `name` rather than a `code` field.**
  Rejected: neither survives serialization. `instanceof` is meaningless once an
  error has been through JSONB, and `name` changes whenever a class is renamed,
  which would silently break stored-evidence comparisons.
- **Leave the serialization rule to the WORKLOG as a small implementation
  choice** (the other branch ADR-0016 permits). Rejected: the rule is
  cross-cutting, binds every future package that writes a trace, and is the kind
  of choice a future engineer would need the *why* of before relaxing it, which
  is ADR-0016's own test for requiring an ADR.
- **Add a `retryable` flag to the base class.** Rejected as speculative:
  whether a failure is worth retrying is a policy decision about a situation,
  not a property of an error instance, and nothing in M1 through M6 needs one.

## References

- `docs/milestones/build-plan.md` Milestone 1 (M1-T8), Milestone 2 (M2-T3,
  M2-T4, M2-T9), §17 north-star invariant 3
- Related ADRs: 0010 (trace is a product surface), 0016 (internal choices are
  recorded explicitly), 0014 (handoff/WORKLOG discipline)
- Related code paths: `packages/core/src/errors.ts`,
  `docs/contracts/errors.md`
