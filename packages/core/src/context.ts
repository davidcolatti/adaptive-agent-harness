import { ValidationError } from "./errors.js";
import type { JsonObject } from "./json.js";
import { createNoopTraceWriter, type TraceWriter } from "./trace.js";

/**
 * A reference to a versioned thing by stable ID.
 *
 * The build plan uses this exact `{ id, version }` pair for `Job.domain` and
 * for `CapabilityRef` (section 5). It is one type here rather than two, because
 * the shape and its meaning are identical; M1-T9 may alias it for capabilities.
 */
export interface DomainRef {
  /** Stable domain ID, e.g. `vendor-triage`. */
  readonly id: string;
  /** The domain's own version, e.g. `1.0.0`. */
  readonly version: string;
}

/**
 * The limits an execution must stay inside.
 *
 * Exactly `Job.budget` from build plan section 5. Every dimension is optional:
 * an absent dimension is unlimited, not zero. `FallbackContext.remainingBudget`
 * uses the same type, which is why it is readonly.
 */
export interface Budget {
  /** Maximum total model spend, in US dollars. */
  readonly maxCostUsd?: number;
  /** Maximum wall-clock duration, in milliseconds. */
  readonly maxDurationMs?: number;
  /** Maximum number of model calls. */
  readonly maxModelCalls?: number;
  /** Maximum number of tool calls. */
  readonly maxToolCalls?: number;
}

/**
 * The access a {@link ToolGrant} confers.
 *
 * `write` means the tool can change something outside the harness, which is
 * the distinction north-star invariant 7 cares about. `read` is strictly
 * weaker: a `read` grant never satisfies a `write` request.
 */
export type ToolGrantMode = "read" | "write";

/**
 * Permission to use one tool.
 *
 * The build plan names `ToolGrant` in `Job.permissions` but does not define it,
 * so this is a harness-owned shape and deliberately the smallest one that can
 * answer "may this job call this tool this way?". M2 and M5 are expected to
 * extend it (expiry, approval requirements, per-resource constraints); treat
 * this as the M1 shape, not the final one.
 */
export interface ToolGrant {
  /** The tool this grant is about, matching the tool's registered capability ID. */
  readonly toolId: string;
  /** The access granted. */
  readonly mode: ToolGrantMode;
  /**
   * An optional narrowing of what the grant covers, interpreted by the tool
   * itself: a repository name, a directory, a table. An absent scope means the
   * grant is not narrowed, not that it covers nothing.
   */
  readonly scope?: string;
}

/**
 * Which runtime is executing, and anything it wants recorded about itself.
 *
 * `name`/`version` identify the adapter (for example `eve` and `0.63.0`) so a
 * trace can say what produced it. `metadata` is deliberately opaque: it is how
 * an adapter publishes its own detail without those details becoming core
 * contract fields, which is the rule ADR-0003 sets for keeping `eve` session
 * specifics out of core.
 */
export interface RuntimeInfo {
  /** The runtime adapter's name. */
  readonly name: string;
  /** The runtime adapter's version. */
  readonly version: string;
  /** Adapter-specific detail, serializable and free-form. */
  readonly metadata: JsonObject;
}

/**
 * What {@link createExecutionContext} reports when no runtime is named.
 *
 * `name` is `harness` because that is literally what is executing at the
 * moment the context is built: `createHarness()` has not handed the job to an
 * adapter yet. `version` is a module constant rather than a value read from
 * `packages/core/package.json` at runtime, because reading a package manifest
 * from a compiled `dist/` at an unknown path is brittle and would make the
 * contract depend on file layout. It tracks the package version by hand, and
 * nothing branches on it.
 */
export const HARNESS_RUNTIME_INFO: RuntimeInfo = Object.freeze({
  name: "harness",
  version: "0.0.0",
  metadata: Object.freeze({}),
});

/**
 * Everything an execution needs that is not the job itself.
 *
 * The split matters: a `Job` is immutable and describes *what* to do, while an
 * `ExecutionContext` describes *this particular attempt* at doing it, and so
 * carries the attempt number, the writer to trace into and the signal to stop
 * on. A retry reuses the job and gets a new context.
 *
 * Every field is readonly. Nothing in an execution is allowed to reassign its
 * own budget or widen its own permissions mid-run.
 */
export interface ExecutionContext {
  /** The run this attempt belongs to. Matches `TraceEvent.runId`. */
  readonly runId: string;
  /** The job being executed. */
  readonly jobId: string;
  /** The domain the job belongs to. */
  readonly domain: DomainRef;
  /** Which attempt this is, counting from 1. */
  readonly attempt: number;
  /** The limits this attempt must stay inside. */
  readonly budget: Budget;
  /**
   * The tools this attempt may use. An empty list grants nothing: permission
   * is explicit, so the default is denial rather than open access.
   */
  readonly permissions: readonly ToolGrant[];
  /** Where trace events go. */
  readonly trace: TraceWriter;
  /** Cancellation. An adapter must propagate this to the work it starts. */
  readonly signal: AbortSignal;
  /** What is executing. */
  readonly runtime: RuntimeInfo;
}

/** The {@link RuntimeInfo} fields {@link createExecutionContext} accepts. */
export interface RuntimeInfoInput {
  /** The runtime adapter's name. */
  readonly name: string;
  /** The runtime adapter's version. */
  readonly version: string;
  /** Adapter-specific detail. Defaults to `{}`. */
  readonly metadata?: JsonObject;
}

/** The input {@link createExecutionContext} accepts. */
export interface CreateExecutionContextInput {
  /** The run this attempt belongs to. */
  readonly runId: string;
  /** The job being executed. */
  readonly jobId: string;
  /** The domain the job belongs to. */
  readonly domain: DomainRef;
  /** Which attempt this is. Defaults to `1`. */
  readonly attempt?: number;
  /** The limits this attempt must stay inside. Defaults to `{}`, unlimited. */
  readonly budget?: Budget;
  /** The tools this attempt may use. Defaults to `[]`, which grants nothing. */
  readonly permissions?: readonly ToolGrant[];
  /** Where trace events go. Defaults to a no-op writer. */
  readonly trace?: TraceWriter;
  /** Cancellation. Defaults to a signal that never aborts. */
  readonly signal?: AbortSignal;
  /**
   * What is executing.
   *
   * **Optional, and the default is the honest answer.** The harness builds the
   * context *before* it calls an adapter, so at construction time it does not
   * yet know which adapter will run the job or what version that adapter is.
   * Omitting this field yields {@link HARNESS_RUNTIME_INFO}, which says "the
   * harness is orchestrating this attempt" rather than naming a runtime that
   * has not spoken yet. The adapter identifies itself where it actually can:
   * `AgentExecution.runtime`, which is the value that reaches a caller and a
   * trace.
   *
   * An adapter that builds its own context (a nested or delegated run) supplies
   * its own identity here.
   */
  readonly runtime?: RuntimeInfoInput;
}

/**
 * Build an {@link ExecutionContext}, applying the documented defaults.
 *
 * The defaults are all the conservative one: no budget is unlimited rather than
 * zero, because a budget the caller did not set is not a budget of nothing; no
 * permissions is the empty list, because permission is explicit; and no signal
 * is a signal that never aborts rather than one already aborted.
 *
 * @throws {ValidationError} if `attempt` is not an integer of at least 1.
 * Attempts are 1-based, and an off-by-one here would silently mislabel every
 * retry in the trace, so it fails loudly at construction instead.
 */
export function createExecutionContext(input: CreateExecutionContextInput): ExecutionContext {
  const attempt = input.attempt ?? 1;

  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new ValidationError("createExecutionContext: `attempt` must be an integer >= 1", {
      issues: [
        { path: ["attempt"], message: `expected an integer >= 1, received ${String(attempt)}` },
      ],
    });
  }

  return {
    runId: input.runId,
    jobId: input.jobId,
    domain: input.domain,
    attempt,
    budget: input.budget ?? {},
    permissions: input.permissions ?? [],
    trace: input.trace ?? createNoopTraceWriter(),
    // The controller is intentionally discarded: nothing holds a reference to
    // it, so the signal it produced can never be aborted. That is the honest
    // "no cancellation was supplied" value, and it keeps `signal` non-optional
    // so no caller has to null-check it.
    signal: input.signal ?? new AbortController().signal,
    runtime:
      input.runtime === undefined
        ? HARNESS_RUNTIME_INFO
        : {
            name: input.runtime.name,
            version: input.runtime.version,
            metadata: input.runtime.metadata ?? {},
          },
  };
}
