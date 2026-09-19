import type { Budget, ToolGrantMode } from "./context.js";
import type { JsonObject } from "./json.js";

/**
 * The harness error taxonomy (build plan, M1-T8) and its trace-safe
 * serialization.
 *
 * Two rules shape everything below.
 *
 * 1. **Every failure is identified by a stable `code`, not by its class name.**
 *    A trace, a stored run record or a replay comparison is read long after the
 *    code that produced it changed, so the discriminant has to survive
 *    serialization and renaming. `name` carries the class name for humans;
 *    `code` is what machines branch on.
 * 2. **Serialization is a whitelist, never a dump.** {@link serializeError}
 *    copies exactly `name`, `code`, `message`, `details` and a bounded `cause`
 *    chain. It never walks an error's own properties and never includes a
 *    stack unless asked. See ADR-0026.
 */

/**
 * The closed set of failure codes.
 *
 * Each concrete {@link HarnessError} subclass owns exactly one. `UNKNOWN` is
 * the only member no subclass uses: it is what {@link serializeError} reports
 * for a throwable the harness did not define, such as a plain `Error` from a
 * dependency or a thrown string.
 *
 * The scheme is `SCREAMING_SNAKE_CASE` of the class name with the trailing
 * `Error` dropped, so `BudgetExceededError` is `BUDGET_EXCEEDED`. A new
 * subclass follows the same derivation.
 */
export type HarnessErrorCode =
  | "VALIDATION"
  | "BUDGET_EXCEEDED"
  | "PERMISSION_DENIED"
  | "TOOL_EXECUTION"
  | "AGENT_EXECUTION"
  | "DECISION"
  | "WORKFLOW"
  | "STORAGE"
  | "REPLAY_MISMATCH"
  | "UNKNOWN";

/**
 * Options accepted by every harness error.
 *
 * `cause` is the standard `ErrorOptions` field, so `new ToolExecutionError(msg,
 * { cause: err, toolId })` behaves exactly as `new Error(msg, { cause })` does.
 */
export interface HarnessErrorOptions extends ErrorOptions {
  /**
   * Structured context the thrower explicitly chooses to publish.
   *
   * This is the only free-form field that reaches a trace, which is precisely
   * why it is opt-in: nothing lands in `details` unless a caller put it there.
   * A concrete subclass merges its own typed fields in as well, so a serialized
   * `BudgetExceededError` still carries its dimension and limits. Redacting
   * secrets a caller chose to include here is M2-T9's job, not this type's.
   */
  readonly details?: JsonObject;
}

/**
 * The trace-safe JSON form of any throwable.
 *
 * Assignable to {@link JsonObject}, so it can be embedded directly in a
 * {@link TraceEvent} payload or stored as JSONB without a further conversion.
 */
export type SerializedHarnessError = {
  /** The error class name, for humans. Not a stable discriminant. */
  readonly name: string;
  /** The stable machine discriminant. */
  readonly code: HarnessErrorCode;
  /** The error message. */
  readonly message: string;
  /** The structured context the thrower published, if any. */
  readonly details?: JsonObject;
  /** The serialized `cause`, bounded by {@link MAX_SERIALIZED_CAUSE_DEPTH}. */
  readonly cause?: SerializedHarnessError;
  /**
   * The stack trace. Present only when serialization was asked for it, because
   * a stack leaks absolute filesystem paths and internal module structure into
   * anything the trace is shown to.
   */
  readonly stack?: string;
};

/**
 * How deep a `cause` chain is serialized before it is truncated.
 *
 * The cap is what makes {@link serializeError} total: a chain that is very long,
 * or that cycles back on itself, terminates here instead of exhausting the
 * stack or producing an unbounded trace payload.
 */
export const MAX_SERIALIZED_CAUSE_DEPTH = 5;

/** Options for {@link serializeError}. */
export interface SerializeErrorOptions {
  /**
   * Include `stack` on every level of the chain. Defaults to `false`. Turn it
   * on for local debugging output, never for a persisted trace.
   */
  readonly includeStack?: boolean;
}

/**
 * The base class of every error the harness defines.
 *
 * Abstract because the taxonomy is closed: a failure is one of the nine kinds
 * below, or it is not a harness error at all.
 */
export abstract class HarnessError extends Error {
  /** The stable machine discriminant. Each subclass fixes one literal. */
  abstract readonly code: HarnessErrorCode;

  /** Structured context, as merged by the concrete subclass. */
  readonly details: JsonObject | undefined;

  constructor(message: string, options?: HarnessErrorOptions) {
    super(message, options);
    // `new.target` is the concrete subclass, so `name` matches the class that
    // was constructed without every subclass repeating the assignment.
    this.name = new.target.name;
    this.details = options?.details;
  }

  /**
   * The trace-safe form, so `JSON.stringify(error)` is safe by default rather
   * than by convention. Stacks are excluded; use {@link serializeError} with
   * `includeStack` when one is genuinely wanted.
   */
  toJSON(): SerializedHarnessError {
    return serializeError(this);
  }
}

/** One thing that was wrong with a validated value. */
export type ValidationIssue = {
  /**
   * Where the problem is, as a path of property names and array indices from
   * the root of the validated value. An empty path means the root itself.
   */
  readonly path: readonly (string | number)[];
  /** What is wrong, in one sentence. */
  readonly message: string;
};

/** Options for {@link ValidationError}. */
export interface ValidationErrorOptions extends HarnessErrorOptions {
  /** Every issue found, not just the first. */
  readonly issues: readonly ValidationIssue[];
}

/**
 * A value failed its schema or contract.
 *
 * Thrown when job input fails the domain's input schema, when agent output
 * fails its output schema, or when a harness API is called with an argument it
 * cannot accept. Which schema library produces {@link ValidationIssue} values
 * is M1-T3's decision; this type is the schema-agnostic shape it normalizes to.
 */
export class ValidationError extends HarnessError {
  readonly code = "VALIDATION" as const;
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, options: ValidationErrorOptions) {
    super(message, { ...options, details: { ...options.details, issues: options.issues } });
    this.issues = options.issues;
  }
}

/** The budget dimension that was exceeded. Exactly the keys of {@link Budget}. */
export type BudgetDimension = keyof Budget;

/** Options for {@link BudgetExceededError}. */
export interface BudgetExceededErrorOptions extends HarnessErrorOptions {
  /** Which budget dimension ran out. */
  readonly dimension: BudgetDimension;
  /** The limit the job declared. */
  readonly limit: number;
  /** The value that broke it. */
  readonly actual: number;
}

/**
 * An execution hit a declared budget limit.
 *
 * Distinct from a failure of the work itself: the job may have been going fine
 * and simply ran out of the cost, time, model calls or tool calls it was given.
 */
export class BudgetExceededError extends HarnessError {
  readonly code = "BUDGET_EXCEEDED" as const;
  readonly dimension: BudgetDimension;
  readonly limit: number;
  readonly actual: number;

  constructor(message: string, options: BudgetExceededErrorOptions) {
    super(message, {
      ...options,
      details: {
        ...options.details,
        dimension: options.dimension,
        limit: options.limit,
        actual: options.actual,
      },
    });
    this.dimension = options.dimension;
    this.limit = options.limit;
    this.actual = options.actual;
  }
}

/** Options for {@link PermissionDeniedError}. */
export interface PermissionDeniedErrorOptions extends HarnessErrorOptions {
  /** The tool that was asked for. */
  readonly toolId: string;
  /** The access that was asked for, which no grant allowed. */
  readonly requested: ToolGrantMode;
}

/**
 * A tool was requested that the job's permissions do not grant.
 *
 * Fails closed: the absence of a grant is a denial, never an implicit
 * allowance. North-star invariant 7 ("every external write has explicit
 * permission semantics") is enforced by throwing this rather than proceeding.
 */
export class PermissionDeniedError extends HarnessError {
  readonly code = "PERMISSION_DENIED" as const;
  readonly toolId: string;
  readonly requested: ToolGrantMode;

  constructor(message: string, options: PermissionDeniedErrorOptions) {
    super(message, {
      ...options,
      details: { ...options.details, toolId: options.toolId, requested: options.requested },
    });
    this.toolId = options.toolId;
    this.requested = options.requested;
  }
}

/** Options for {@link ToolExecutionError}. */
export interface ToolExecutionErrorOptions extends HarnessErrorOptions {
  /** The tool that failed. */
  readonly toolId: string;
}

/**
 * A permitted tool ran and failed.
 *
 * The underlying failure belongs in `cause`. Keeping this separate from
 * {@link PermissionDeniedError} matters for learning and compilation: a tool
 * that is denied is a policy problem, a tool that throws is a reliability one.
 */
export class ToolExecutionError extends HarnessError {
  readonly code = "TOOL_EXECUTION" as const;
  readonly toolId: string;

  constructor(message: string, options: ToolExecutionErrorOptions) {
    super(message, { ...options, details: { ...options.details, toolId: options.toolId } });
    this.toolId = options.toolId;
  }
}

/**
 * An agent run failed inside the runtime adapter.
 *
 * Thrown by an `AgentRuntime` implementation (M1-T5, M1-T6) after normalizing
 * whatever the underlying framework threw. The framework's own error goes in
 * `cause`, which is how `eve` and AI SDK details stay out of the core
 * contracts (ADR-0003).
 */
export class AgentExecutionError extends HarnessError {
  readonly code = "AGENT_EXECUTION" as const;
}

/**
 * A bounded judgment could not be obtained.
 *
 * Covers the decision engine failing, not a decision coming back with low
 * confidence: a low-confidence answer is a normal result that policy handles
 * (ADR-0009). Implemented against by `packages/decision-jev` in M3.
 */
export class DecisionError extends HarnessError {
  readonly code = "DECISION" as const;
}

/**
 * A workflow could not be validated or executed.
 *
 * Covers invalid IR, an unresolvable capability reference, an undeclared cycle
 * and a node that failed in a way the workflow cannot route around (M4+).
 */
export class WorkflowError extends HarnessError {
  readonly code = "WORKFLOW" as const;
}

/**
 * Persistence failed.
 *
 * Thrown only by a storage adapter (`packages/storage-supabase`, M2). Nothing
 * in core touches a database, so core never throws this; it is defined here
 * because the trace and run ledger have to be able to record it.
 */
export class StorageError extends HarnessError {
  readonly code = "STORAGE" as const;
}

/** Options for {@link ReplayMismatchError}. */
export interface ReplayMismatchErrorOptions extends HarnessErrorOptions {
  /** The workflow node whose replay diverged. */
  readonly nodeId: string;
  /** The fingerprint the recorded evidence carries. */
  readonly expected: string;
  /** The fingerprint the replay produced. */
  readonly actual: string;
}

/**
 * A replay diverged from the evidence it was replayed against.
 *
 * Fingerprints are compared as opaque strings; this type does not know how they
 * are computed (M2-T8). The mismatch is the finding, so it is an error rather
 * than a log line: a replay that silently accepts drift proves nothing.
 */
export class ReplayMismatchError extends HarnessError {
  readonly code = "REPLAY_MISMATCH" as const;
  readonly nodeId: string;
  readonly expected: string;
  readonly actual: string;

  constructor(message: string, options: ReplayMismatchErrorOptions) {
    super(message, {
      ...options,
      details: {
        ...options.details,
        nodeId: options.nodeId,
        expected: options.expected,
        actual: options.actual,
      },
    });
    this.nodeId = options.nodeId;
    this.expected = options.expected;
    this.actual = options.actual;
  }
}

/** Whether `value` is one of the harness's own errors. */
export function isHarnessError(value: unknown): value is HarnessError {
  return value instanceof HarnessError;
}

/**
 * `String(value)` that cannot itself throw.
 *
 * A thrown value is not required to be stringifiable: `Object.create(null)` has
 * no `toString`, and a hostile object can define one that throws. Serialization
 * runs on the failure path, so it must not add a second failure to the first.
 */
function describeUnknown(value: unknown): string {
  try {
    return String(value);
  } catch {
    return `[unstringifiable ${typeof value}]`;
  }
}

function serializeAt(error: unknown, includeStack: boolean, depth: number): SerializedHarnessError {
  if (depth > MAX_SERIALIZED_CAUSE_DEPTH) {
    return {
      name: "TruncatedCause",
      code: "UNKNOWN",
      message: `cause chain truncated at depth ${MAX_SERIALIZED_CAUSE_DEPTH}`,
    };
  }

  if (error instanceof Error) {
    const code: HarnessErrorCode = isHarnessError(error) ? error.code : "UNKNOWN";
    const details = isHarnessError(error) ? error.details : undefined;

    return {
      name: error.name,
      code,
      message: error.message,
      // Every field below is spread conditionally rather than assigned as
      // `undefined`, because the repository compiles with
      // `exactOptionalPropertyTypes`: an optional property is either absent or
      // has its declared type, never explicitly `undefined`.
      ...(details === undefined ? {} : { details }),
      ...(error.cause === undefined
        ? {}
        : { cause: serializeAt(error.cause, includeStack, depth + 1) }),
      ...(includeStack && error.stack !== undefined ? { stack: error.stack } : {}),
    };
  }

  // Anything else that was thrown: a string, a number, a bare object. Only its
  // string form is kept; its properties are never read, so a thrown object
  // carrying a credential cannot leak one into a trace.
  return { name: "NonError", code: "UNKNOWN", message: describeUnknown(error) };
}

/**
 * Convert any throwable into its trace-safe JSON form.
 *
 * Total: it accepts `unknown` because `catch` binds `unknown` under this
 * repository's `useUnknownInCatchVariables`, and it never throws.
 *
 * What it keeps is a fixed whitelist: `name`, `code`, `message`, the thrower's
 * own `details`, and the `cause` chain up to
 * {@link MAX_SERIALIZED_CAUSE_DEPTH}. What it never keeps is an error's other
 * own properties, and it omits `stack` unless `includeStack` is set. See
 * ADR-0026 for why.
 */
export function serializeError(
  error: unknown,
  options?: SerializeErrorOptions,
): SerializedHarnessError {
  return serializeAt(error, options?.includeStack ?? false, 0);
}
