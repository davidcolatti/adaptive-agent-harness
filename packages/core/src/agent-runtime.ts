import type { ExecutionContext, RuntimeInfo } from "./context.js";
import type { SerializedHarnessError } from "./errors.js";
import type { WorkflowVersionId } from "./ids.js";
import type { Job } from "./job.js";
import type { JsonObject } from "./json.js";

/**
 * What one attempt consumed.
 *
 * These four dimensions are the ones {@link Budget} limits, so a runtime that
 * reports usage reports it in the same terms the budget was written in. Cost is
 * optional because a local or faked runtime genuinely has none, and reporting
 * `0` would be a claim rather than an absence.
 */
export interface AgentExecutionUsage {
  /** How many model calls the attempt made. */
  readonly modelCalls: number;
  /** How many tool calls the attempt made. */
  readonly toolCalls: number;
  /** Wall-clock duration of the attempt, in milliseconds. */
  readonly durationMs: number;
  /** Total model spend in US dollars, when the runtime knows it. */
  readonly costUsd?: number;
}

/** What every {@link AgentExecution} carries, whatever its outcome. */
interface AgentExecutionBase {
  /** What the attempt consumed. */
  readonly usage: AgentExecutionUsage;
  /** Which runtime adapter produced this result. */
  readonly runtime: RuntimeInfo;
  /**
   * Adapter-specific detail. This is where a runtime publishes what it knows
   * without its vocabulary becoming part of this contract (ADR-0003).
   */
  readonly metadata?: JsonObject;
  /**
   * The compiled workflow version that executed this attempt, when one did
   * (M5-T3, ADR-0044).
   *
   * **Absent, not `null`, from a runtime that does not route.** The harness
   * copies it onto the run's ledger row (`runs.workflow_version_id`), and an
   * absent field leaves `startRun`'s value alone rather than overwriting it. A
   * router sets it for a workflow run *and* for a run that escalated from one,
   * because the ledger's question is "which compiled version was this job given
   * to?", and `fallbackCount` is what says the workflow handed it back.
   *
   * It is not in `metadata` because `metadata` is adapter vocabulary and this is
   * a harness column: two runtimes must not be free to spell it differently.
   */
  readonly workflowVersionId?: WorkflowVersionId;
  /**
   * How many times this attempt fell back from a compiled path to a full agent.
   *
   * `0` or absent for a run that never escalated; `1` for one that did. It is a
   * count rather than a flag because a future router may escalate more than
   * once, and `runs.fallback_count` is already a count.
   */
  readonly fallbackCount?: number;
  /**
   * How many decisions this attempt asked a `DecisionEngine` for (M3, M5).
   *
   * The harness copies it into `runs.jev_calls`. **Absent and `0` mean
   * different things to the reader of this field and the same thing to the
   * ledger**: absent is "this runtime does not make decisions and has no
   * opinion", `0` is "it does, and made none". Both land as `0`, which is the
   * honest ledger value either way.
   *
   * It is not part of {@link AgentExecutionUsage} because a decision is not one
   * of the four dimensions a `Budget` limits. The workflow interpreter charges
   * the budget one model call per decision, which is a documented floor rather
   * than a measurement of what the decision cost; this is the count itself.
   */
  readonly jevCalls?: number;
}

/** The agent produced an output. */
export interface CompletedAgentExecution<TOutput> extends AgentExecutionBase {
  readonly status: "completed";
  /**
   * The output the runtime **claims** the agent produced.
   *
   * It is typed `TOutput` but not yet trusted: a runtime asserts the type, it
   * does not prove it. `createHarness()` (M1-T4) re-validates this value
   * against the domain's `outputSchema` before any caller sees it, which is
   * what makes "one intentionally invalid output fails closed" true.
   */
  readonly output: TOutput;
}

/** The agent run failed. */
export interface FailedAgentExecution extends AgentExecutionBase {
  readonly status: "failed";
  /**
   * The failure, already in its trace-safe form.
   *
   * Serialized rather than thrown, because a failed run is a result with usage
   * attached: the attempt cost something and that has to be reported alongside
   * the reason. An adapter normalizes whatever the framework threw into a
   * harness error first (`AgentExecutionError`), so `eve` and AI SDK error
   * types do not cross this boundary.
   */
  readonly error: SerializedHarnessError;
}

/** The run stopped because {@link ExecutionContext.signal} fired. */
export interface AbortedAgentExecution extends AgentExecutionBase {
  readonly status: "aborted";
}

/**
 * The result of one attempt, as a discriminated union on `status`.
 *
 * A union rather than an optional-output record, so that "completed with no
 * output" is not expressible. Narrowing is `execution.status === "completed"`;
 * no type guard is exported, because the discriminant already does the work.
 *
 * **Nothing from `eve` or the AI SDK appears here.** No messages, no steps, no
 * sessions, no tool-call transcript. Those belong to the adapter and reach the
 * outside world as trace events (M2) or as `metadata`, which is the boundary
 * ADR-0003 draws.
 */
export type AgentExecution<TOutput = unknown> =
  | CompletedAgentExecution<TOutput>
  | FailedAgentExecution
  | AbortedAgentExecution;

/**
 * Anything that can run a {@link Job}.
 *
 * Stated verbatim by build plan section 5. It is the whole of what the harness
 * requires of an agent implementation, which is what makes `EveAgentRuntime`
 * (M1-T6) replaceable by a fake in a unit test: `createFakeAgentRuntime()` in
 * `@internal/testing` implements this same interface and nothing else.
 *
 * Two obligations an implementation has that the signature cannot express:
 *
 * 1. **Propagate `context.signal`.** An adapter must pass it to the work it
 *    starts and resolve with `status: "aborted"` rather than hanging or
 *    rejecting when it fires.
 * 2. **Do not throw for an agent failure.** A run that failed resolves with
 *    `status: "failed"`. Throwing is reserved for a defect in the adapter
 *    itself.
 */
export interface AgentRuntime {
  /** Run one attempt at `job` under `context`. */
  run<TInput, TOutput>(
    job: Job<TInput, TOutput>,
    context: ExecutionContext,
  ): Promise<AgentExecution<TOutput>>;
}
