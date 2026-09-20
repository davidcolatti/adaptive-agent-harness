---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/execution-context.md
  - docs/contracts/redaction.md
  - docs/decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md
  - docs/decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md
  - docs/decisions/0010-observability-trace-is-a-product-surface-captured-from-the-first-run.md
implementation:
  - packages/core
---

# Error taxonomy

Nine error classes and one serialization function, defined in
`packages/core/src/errors.ts` and created by M1-T8. The build plan names the
classes; the serialization rule is recorded in
[ADR-0026](../decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md).

Two rules shape the whole file.

1. **Every failure is identified by a stable `code`, not by its class name.** A
   trace, a stored run record or a replay comparison is read long after the code
   that produced it changed, so the discriminant has to survive serialization
   and renaming. `name` carries the class name for humans; `code` is what
   machines branch on.
2. **Serialization is a whitelist, never a dump.** `serializeError` copies
   exactly `name`, `code`, `message`, `details` and a bounded `cause` chain. It
   never walks an error's own properties, and it never includes a stack unless
   asked.

## `HarnessError`

```ts
abstract class HarnessError extends Error {
  abstract readonly code: HarnessErrorCode;
  readonly details: JsonObject | undefined;
  constructor(message: string, options?: HarnessErrorOptions);
  toJSON(): SerializedHarnessError;
}

interface HarnessErrorOptions extends ErrorOptions {
  readonly details?: JsonObject;
}
```

Abstract, because the taxonomy is closed: a failure is one of the nine kinds
below, or it is not a harness error at all. `isHarnessError(value)` is the
guard.

`cause` is the standard `ErrorOptions` field, so
`new ToolExecutionError(msg, { cause: err, toolId })` behaves exactly as
`new Error(msg, { cause })` does. `name` is set from the constructed class, so
no subclass has to repeat it.

`toJSON()` returns the same value `serializeError` does, which makes
`JSON.stringify(error)` safe by default rather than by convention.

## Codes

`HarnessErrorCode` is a closed union. The scheme is `SCREAMING_SNAKE_CASE` of
the class name with the trailing `Error` dropped, so `BudgetExceededError` is
`BUDGET_EXCEEDED`. A new subclass follows the same derivation.

| Class | Code | Thrown when |
| --- | --- | --- |
| `ValidationError` | `VALIDATION` | A value failed its schema or contract. |
| `BudgetExceededError` | `BUDGET_EXCEEDED` | An execution hit a declared budget limit. |
| `PermissionDeniedError` | `PERMISSION_DENIED` | A tool was requested that the job's permissions do not grant. |
| `ToolExecutionError` | `TOOL_EXECUTION` | A permitted tool ran and failed. |
| `AgentExecutionError` | `AGENT_EXECUTION` | An agent run failed inside the runtime adapter. |
| `DecisionError` | `DECISION` | A bounded judgment could not be obtained. |
| `WorkflowError` | `WORKFLOW` | A workflow could not be validated or executed. |
| `StorageError` | `STORAGE` | Persistence failed. |
| `ReplayMismatchError` | `REPLAY_MISMATCH` | A replay diverged from the evidence it ran against. |
| (none) | `UNKNOWN` | Reported by `serializeError` for a throwable the harness did not define. |

`UNKNOWN` is the only member no class uses. It is what a plain `Error` from a
dependency, or a thrown string, serializes as.

Distinctions the taxonomy deliberately draws:

- **Denied versus failed.** A tool that is denied is a policy problem; a tool
  that throws is a reliability one. Learning and compilation treat them
  differently, so they are different classes.
- **Budget versus failure.** A budget error does not mean the work was going
  badly. The job may have been fine and simply ran out of the cost, time, model
  calls or tool calls it was given.
- **A failed judgment versus a low-confidence one.** `DecisionError` is the
  decision engine failing. A low-confidence answer is a normal result that
  policy handles, per ADR-0009, and is not an error.

## Typed fields

Classes with no extra fields (`AgentExecutionError`, `DecisionError`,
`WorkflowError`, `StorageError`) take `(message, options?)` and nothing more.
The rest carry exactly what their domain needs:

```ts
type ValidationIssue = {
  readonly path: readonly (string | number)[];
  readonly message: string;
};

class ValidationError      { readonly issues: readonly ValidationIssue[] }
class BudgetExceededError  { readonly dimension: BudgetDimension; readonly limit: number; readonly actual: number }
class PermissionDeniedError{ readonly toolId: string; readonly requested: ToolGrantMode }
class ToolExecutionError   { readonly toolId: string }
class ReplayMismatchError  { readonly nodeId: string; readonly expected: string; readonly actual: string }
```

`BudgetDimension` is `keyof Budget`, so the budget contract and the budget
error cannot drift apart.

`ValidationIssue.path` is a path of property names and array indices from the
root of the validated value; an empty path means the root itself.
**Which schema library produces these is M1-T3's decision**, not this
contract's. `ValidationIssue` is the schema-agnostic shape whatever validator
M1-T3 selects must normalize to.

`ReplayMismatchError` compares fingerprints as opaque strings. It does not know
how they are computed; that is M2-T8.

## `details`

`details` is the only free-form field that reaches a trace, which is why it is
opt-in: nothing lands there unless a caller put it there. Each concrete class
also merges its own typed fields in, so a serialized `BudgetExceededError`
still carries its dimension and limits even though the whitelist does not know
about them. Class fields are merged last and win over a caller's key of the
same name.

Redacting a secret a caller chose to put in `details` is **not this contract's
job**. The whitelist stops the harness from leaking values nobody chose to
publish; it cannot stop a caller from publishing one deliberately.

That redaction happens **in the trace pipeline**, not here (M2-T9, ADR-0035).
`createRedactingTraceWriter()` in `@internal/trace` walks a serialized error's
`message`, `details`, `stack` and its whole `cause` chain before anything buffers
or stores the event, replacing what it finds with `[REDACTED:<rule-name>]`.
`name` and `code` are left alone, because they are the discriminants a reader
branches on. See [`redaction.md`](./redaction.md).

## `serializeError`

```ts
function serializeError(error: unknown, options?: { includeStack?: boolean }): SerializedHarnessError;

type SerializedHarnessError = {
  readonly name: string;
  readonly code: HarnessErrorCode;
  readonly message: string;
  readonly details?: JsonObject;
  readonly cause?: SerializedHarnessError;
  readonly stack?: string;
};

const MAX_SERIALIZED_CAUSE_DEPTH = 5;
```

`SerializedHarnessError` is assignable to `JsonObject`, so it can be embedded
directly in a trace payload or stored as JSONB with no further conversion. A
unit test asserts that assignability at the type level.

The function is **total**. It accepts `unknown` because `catch` binds `unknown`
under this repository's `useUnknownInCatchVariables`, and it never throws, not
even on a value that cannot be stringified. Three cases:

| Input | Result |
| --- | --- |
| A `HarnessError` | Its `name`, `code`, `details`, and serialized `cause`. |
| Any other `Error` | Its `name` and `message`, `code: "UNKNOWN"`, and serialized `cause`. No other property is read. |
| Anything else | `{ name: "NonError", code: "UNKNOWN", message: String(value) }`. Its properties are never read. |

Three guarantees worth stating explicitly:

- **No stacks by default.** A stack leaks absolute filesystem paths and
  internal module structure into anything the trace is shown to. Pass
  `includeStack` for local debugging output, never for a persisted trace.
- **No arbitrary properties.** An error with an extra `apiKey` property
  serializes without it, whether the property was set on a harness error or on
  a plain one. A thrown plain object serializes as `"[object Object]"` rather
  than having its keys read.
- **Bounded output.** A `cause` chain is serialized to
  `MAX_SERIALIZED_CAUSE_DEPTH` levels, then replaced by a
  `{ name: "TruncatedCause", code: "UNKNOWN" }` marker rather than silently cut.
  The cap is also what makes a cyclic `cause` chain terminate.

## Open for later milestones

- M1-T3 decides which schema library produces `ValidationIssue` values and
  writes the adapter that normalizes them.
- M2-T9 is done: redaction over `message`, `details`, `stack` and the `cause`
  chain runs in the trace pipeline before persistence
  ([`redaction.md`](./redaction.md)).
- M2-T3 decides how a serialized error is carried on a trace event; this
  contract only guarantees the value is embeddable.
- No class carries a `retryable` flag. Retry is a policy decision about a
  situation, not a property of an error instance, and nothing in M1 through M6
  needs one yet. Adding one later is a deliberate change, not a gap.
