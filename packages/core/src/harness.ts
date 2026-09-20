import type { AgentExecution, AgentExecutionUsage, AgentRuntime } from "./agent-runtime.js";
import {
  type Budget,
  createExecutionContext,
  type DomainRef,
  HARNESS_RUNTIME_INFO,
  type RuntimeInfo,
  type ToolGrant,
} from "./context.js";
import type { DomainDefinition } from "./domain.js";
import {
  AgentExecutionError,
  type SerializedHarnessError,
  serializeError,
  ValidationError,
} from "./errors.js";
import { type JobId, newRunId, type RunId } from "./ids.js";
import type { Job } from "./job.js";
import type { JsonObject } from "./json.js";
import { validateWith } from "./schema.js";
import { createNoopTraceWriter, type TraceWriter } from "./trace.js";

/**
 * `createHarness()` (M1-T4): the public entry point, and the one choke point
 * where a run is validated on both sides.
 *
 * The build plan states the target API as:
 *
 * ```ts
 * const harness = createHarness({ agentRuntime, storage });
 * const result = await harness.run({ domain: vendorTriage, input });
 * ```
 *
 * Two of Milestone 1's acceptance criteria are properties of this file rather
 * than of any domain's or runtime's good behaviour: **input is validated before
 * execution**, and **output is validated before success**. A runtime asserts
 * its output type; it does not prove it. Re-validating here is what makes "one
 * intentionally invalid output fails closed" true no matter which adapter ran.
 */

/**
 * A source of the current time.
 *
 * The minimal interface the harness needs, declared here so that
 * `@internal/core` keeps zero dependencies and never imports the testing
 * package. It returns a `Date` rather than a number so that `createFakeClock()`
 * in `@internal/testing` satisfies it structurally with no adapter, exactly the
 * way a `zod` schema satisfies {@link Schema}.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;
}

/** The system clock. The default when no clock is supplied. */
const SYSTEM_CLOCK: Clock = {
  now(): Date {
    return new Date();
  },
};

/**
 * What {@link createHarness} accepts.
 *
 * **`storage` is deliberately absent.** The build plan's target API names it,
 * and M2 is the milestone that defines the `Storage` contract (the run ledger,
 * the trace persistence and the Supabase adapter behind it). Declaring a
 * placeholder type here would publish a guess as a contract and force M2 to
 * break it; omitting the option is honest, and adding an optional field later
 * is not a breaking change. Until then a run leaves its record through
 * {@link CreateHarnessOptions.trace}.
 */
export interface CreateHarnessOptions {
  /** The runtime every run is executed through. */
  readonly agentRuntime: AgentRuntime;
  /** Where run trace events go. Defaults to a no-op writer. */
  readonly trace?: TraceWriter;
  /** The time source used for trace timestamps. Defaults to the system clock. */
  readonly clock?: Clock;
}

/** What {@link Harness.run} accepts. */
export interface HarnessRunInput<TInput, TOutput> {
  /** The domain to run. */
  readonly domain: DomainDefinition<TInput, TOutput>;
  /** The input, validated against `domain.inputSchema` before anything else. */
  readonly input: TInput;
  /** Cancellation for this run. */
  readonly signal?: AbortSignal;
  /**
   * Budget overrides, merged shallowly over the job's own budget.
   *
   * A caller can only state a dimension the domain left open or replace one it
   * set. The harness does not try to prove an override is a *narrowing*: it has
   * no basis for comparing an absent limit (unlimited) with a present one, and
   * a rule it cannot enforce would be worse than none. Enforcing a budget at
   * all is M2's work; today this is metadata a runtime reads.
   */
  readonly budget?: Budget;
  /** Permissions for this run. **Replaces** the job's list rather than adding to it. */
  readonly permissions?: readonly ToolGrant[];
  /** Metadata merged over the job's own, per key. */
  readonly metadata?: JsonObject;
}

/** What every {@link HarnessRunResult} carries, whatever its outcome. */
interface HarnessRunResultBase {
  /** This run's identifier: a sortable UUIDv7 (M2-T1, ADR-0030). */
  readonly runId: RunId;
  /** The job that was run. */
  readonly jobId: JobId;
  /** The domain the job belongs to. */
  readonly domain: DomainRef;
  /** Which attempt produced this result, counting from 1. */
  readonly attempt: number;
  /** What the attempt consumed. */
  readonly usage: AgentExecutionUsage;
  /** Which runtime produced it. */
  readonly runtime: RuntimeInfo;
}

/** The agent produced an output and it satisfied the domain's output schema. */
export interface CompletedHarnessRunResult<TOutput> extends HarnessRunResultBase {
  readonly status: "completed";
  /** The **validated** output, as parsed by `domain.outputSchema`. */
  readonly output: TOutput;
}

/**
 * The run failed, or produced an output the domain's schema rejected.
 *
 * There is deliberately **no `output` field on this variant**. A value that
 * failed validation is not a result, and making it unreachable is stronger than
 * documenting that it must not be read.
 */
export interface FailedHarnessRunResult extends HarnessRunResultBase {
  readonly status: "failed";
  /** Why, already in its trace-safe form. */
  readonly error: SerializedHarnessError;
}

/** The run stopped because the supplied signal fired. */
export interface AbortedHarnessRunResult extends HarnessRunResultBase {
  readonly status: "aborted";
}

/**
 * What a run produced, as a discriminated union on `status`.
 *
 * `harness.run()` **does not throw for a failed run**, for the same reason
 * `AgentRuntime.run()` does not: a failure is a result with usage attached. The
 * one thing it does throw for is a caller bug, an input the domain's schema
 * rejects, because at that point there is no run to report on.
 */
export type HarnessRunResult<TOutput = unknown> =
  | CompletedHarnessRunResult<TOutput>
  | FailedHarnessRunResult
  | AbortedHarnessRunResult;

/** The harness: one method, and the invariants around it. */
export interface Harness {
  /**
   * Validate an input, build its job, run it, and validate what comes back.
   *
   * @throws {ValidationError} if `input` does not satisfy `domain.inputSchema`.
   * Nothing else throws: every other outcome is a {@link HarnessRunResult}.
   */
  run<TInput, TOutput>(input: HarnessRunInput<TInput, TOutput>): Promise<HarnessRunResult<TOutput>>;
}

/**
 * The trace event types this file emits.
 *
 * **M1 placeholders.** M2-T3 owns the event taxonomy and the full
 * `TraceEvent` schema (event ID, parent span, node reference, event version,
 * behavior fingerprint, usage, latency, error metadata). These four names are
 * the ones the build plan already fixes for a run's lifecycle, so emitting them
 * now costs nothing and establishes the ordering guarantee; nothing may branch
 * on the payload shape until M2-T3 settles it.
 */
const RUN_EVENTS = {
  started: "run.started",
  completed: "run.completed",
  failed: "run.failed",
  aborted: "run.aborted",
} as const;

/** Usage reported when the harness never reached the runtime. */
const NO_USAGE: AgentExecutionUsage = Object.freeze({
  modelCalls: 0,
  toolCalls: 0,
  durationMs: 0,
});

function mergeBudget(base: Budget, override: Budget | undefined): Budget {
  return override === undefined ? base : { ...base, ...override };
}

function mergeMetadata(base: JsonObject, override: JsonObject | undefined): JsonObject {
  return override === undefined ? base : { ...base, ...override };
}

/**
 * Create a {@link Harness}.
 *
 * ```ts
 * const harness = createHarness({ agentRuntime: new EveAgentRuntime() });
 * const result = await harness.run({ domain: vendorTriage, input });
 *
 * if (result.status === "completed") {
 *   console.log(result.output.recommendation.decision);
 * }
 * ```
 *
 * The harness holds no state between runs. It is a closure over the runtime,
 * the trace writer and the clock, so two runs cannot interfere and nothing has
 * to be reset.
 */
export function createHarness(options: CreateHarnessOptions): Harness {
  const { agentRuntime } = options;
  const trace = options.trace ?? createNoopTraceWriter();
  const clock = options.clock ?? SYSTEM_CLOCK;

  if (typeof agentRuntime?.run !== "function") {
    throw new ValidationError("createHarness: `agentRuntime` must implement `run(job, context)`", {
      issues: [{ path: ["agentRuntime"], message: "expected an object with a `run` method" }],
    });
  }

  async function run<TInput, TOutput>(
    input: HarnessRunInput<TInput, TOutput>,
  ): Promise<HarnessRunResult<TOutput>> {
    const { domain } = input;

    // 1. Validate the input. This throws rather than returning a `failed`
    //    result: an input the domain's own schema rejects is a caller bug
    //    found *before* a run exists, so there is no run to report a failure
    //    against and nothing has been spent.
    const validInput = await validateWith(domain.inputSchema, input.input, {
      label: `${domain.id} job input`,
    });

    // 2. Build the job, then apply the caller's overrides. A domain decides the
    //    defaults; a caller tightens or annotates them for one run.
    const job = domain.createJob(validInput);
    const effectiveJob: Job<TInput, TOutput> = Object.freeze({
      ...job,
      budget: mergeBudget(job.budget, input.budget),
      permissions: input.permissions === undefined ? job.permissions : [...input.permissions],
      metadata: mergeMetadata(job.metadata, input.metadata),
    });

    // 3. Identify the run. A sortable UUIDv7 (M2-T1, ADR-0030), so runs sort
    //    in start order and a run id can be a cursor over the run ledger.
    const runId = newRunId();
    // M1 has no retries, so every run is its first and only attempt. Retry
    // policy is not this milestone's, and a counter that never moves is
    // honest about that.
    const attempt = 1;

    let sequence = 0;
    const emit = async (type: string, payload: JsonObject): Promise<void> => {
      await trace.append({
        runId,
        sequence: sequence++,
        timestamp: clock.now().toISOString(),
        type,
        payload,
      });
    };

    const context = createExecutionContext({
      runId,
      jobId: effectiveJob.id,
      domain: effectiveJob.domain,
      attempt,
      budget: effectiveJob.budget,
      permissions: effectiveJob.permissions,
      trace,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      // `runtime` is deliberately omitted: the harness does not yet know which
      // adapter will run this job. See `HARNESS_RUNTIME_INFO`.
    });

    const base = {
      runId,
      jobId: effectiveJob.id,
      domain: effectiveJob.domain,
      attempt,
    } as const;

    const startedAt = clock.now().getTime();

    await emit(RUN_EVENTS.started, {
      jobId: effectiveJob.id,
      domain: effectiveJob.domain.id,
      domainVersion: effectiveJob.domain.version,
      jobType: effectiveJob.jobType,
      attempt,
    });

    const finish = async <TResult extends HarnessRunResult<TOutput>>(
      type: string,
      payload: JsonObject,
      result: TResult,
    ): Promise<TResult> => {
      await emit(type, payload);
      await trace.flush();
      return result;
    };

    // 4. A signal that is already aborted short-circuits. The runtime is not
    //    called at all: handing work to an adapter that the contract then
    //    obliges it to abandon is pointless, and it would make "the runtime saw
    //    this run" false in the trace while true in the adapter's own records.
    //    A signal that fires *during* the run is the adapter's to honour, and
    //    it reports `aborted` itself.
    if (context.signal.aborted) {
      return await finish(
        RUN_EVENTS.aborted,
        { reason: "signal was already aborted before the run started" },
        { ...base, status: "aborted", usage: NO_USAGE, runtime: HARNESS_RUNTIME_INFO },
      );
    }

    // 5. Run. A runtime is contractually required to *return* a failure rather
    //    than throw, but a defect in an adapter must not become a defect in the
    //    harness, so a thrown value is contained and reported as a failure.
    let execution: AgentExecution<TOutput>;

    try {
      execution = await agentRuntime.run(effectiveJob, context);
    } catch (cause) {
      const error = new AgentExecutionError(
        `${domain.id}: the agent runtime threw instead of returning a failed execution`,
        { cause, details: { runId, jobId: effectiveJob.id } },
      );

      return await finish(
        RUN_EVENTS.failed,
        { error: serializeError(error) },
        {
          ...base,
          status: "failed",
          error: serializeError(error),
          usage: { ...NO_USAGE, durationMs: clock.now().getTime() - startedAt },
          runtime: HARNESS_RUNTIME_INFO,
        },
      );
    }

    const outcome = { usage: execution.usage, runtime: execution.runtime } as const;

    if (execution.status === "aborted") {
      return await finish(
        RUN_EVENTS.aborted,
        { reason: "the runtime reported the run was cancelled" },
        { ...base, ...outcome, status: "aborted" },
      );
    }

    if (execution.status === "failed") {
      return await finish(
        RUN_EVENTS.failed,
        { error: execution.error },
        { ...base, ...outcome, status: "failed", error: execution.error },
      );
    }

    // 6. Validate the output before calling the run a success. This is the
    //    "fails closed" criterion: an output that does not satisfy the domain's
    //    schema produces a `failed` result carrying the `ValidationError`, and
    //    the offending value is not returned.
    let output: TOutput;

    try {
      output = await validateWith(domain.outputSchema, execution.output, {
        label: `${domain.id} agent output`,
      });
    } catch (cause) {
      const error = serializeError(cause);

      return await finish(
        RUN_EVENTS.failed,
        { error },
        { ...base, ...outcome, status: "failed", error },
      );
    }

    return await finish(
      RUN_EVENTS.completed,
      { jobId: effectiveJob.id, usage: { ...execution.usage } },
      { ...base, ...outcome, status: "completed", output },
    );
  }

  return { run };
}
