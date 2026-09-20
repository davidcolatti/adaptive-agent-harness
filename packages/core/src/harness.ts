import type { AgentExecution, AgentExecutionUsage, AgentRuntime } from "./agent-runtime.js";
import {
  type BehaviorFingerprint,
  behaviorFingerprintPayload,
  resolveBehaviorFingerprint,
} from "./behavior.js";
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
import { deepFreeze } from "./freeze.js";
import { type JobId, newRunId, type RunId } from "./ids.js";
import type { Job } from "./job.js";
import type { JsonObject } from "./json.js";
import { validateWith } from "./schema.js";
import {
  createNoopTraceWriter,
  createTraceRecorder,
  type TraceEvent,
  type TraceEventType,
  type TraceEventUsage,
  type TraceWriter,
} from "./trace.js";

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
  /**
   * The behavior this run executed, fingerprinted component by component
   * (M2-T8, ADR-0034), or `null` when the domain declares no behavior source.
   *
   * The same value every event of the run carries in
   * `TraceEvent.behaviorFingerprint`, which is its composite `fingerprint`
   * field. It is on the result as well as in the trace so that a caller which
   * keeps no trace — a test, a script, an eval harness — can still say what it
   * ran, and so a run's outcome and the behavior that produced it are one
   * value.
   */
  readonly behaviorFingerprint: BehaviorFingerprint | null;
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
   * @throws {ValidationError} if `input` does not satisfy `domain.inputSchema`,
   * or if `domain.behavior` produces a descriptor
   * {@link createBehaviorFingerprint} rejects. Whatever a `domain.behavior`
   * loader itself throws also propagates. Everything after that point is a
   * {@link HarnessRunResult}: both of these happen while a run is still being
   * prepared, so there is no run to report a failure against and nothing has
   * been spent.
   */
  run<TInput, TOutput>(input: HarnessRunInput<TInput, TOutput>): Promise<HarnessRunResult<TOutput>>;
}

/**
 * The trace event types this file emits.
 *
 * The four `run.*` members of the closed M2-T3 taxonomy. `run.aborted` is the
 * one the build plan's list does not name: a run its caller cancelled is
 * neither a completion nor a failure, and reporting it as either would be a
 * lie the run ledger then inherits. ADR-0031 records the amendment.
 */
const RUN_EVENTS = {
  started: "run.started",
  completed: "run.completed",
  failed: "run.failed",
  aborted: "run.aborted",
} as const satisfies Record<string, TraceEventType>;

/** The measured fields {@link TraceEvent} carries outside its payload. */
interface TraceEmitExtra {
  /** What the event's work consumed. */
  readonly usage?: TraceEventUsage | null;
  /** How long it took, in milliseconds. */
  readonly latencyMs?: number | null;
  /** Why it failed. Only a `*.failed` event carries one. */
  readonly error?: SerializedHarnessError | null;
}

/**
 * Project an execution's usage onto the trace event's usage shape.
 *
 * `durationMs` is deliberately not copied: the trace records duration as the
 * event's own `latencyMs`, measured by the harness clock, and carrying the
 * runtime's separate figure in the same event under a second name would make a
 * reader guess which one a cost or latency analysis should use.
 */
function traceUsage(usage: AgentExecutionUsage): TraceEventUsage {
  return {
    modelCalls: usage.modelCalls,
    toolCalls: usage.toolCalls,
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
  };
}

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
    //
    //    **The effective job is the job** (M2-T2, ADR-0032). The overrides are
    //    part of creating it, not a later amendment to it: they are applied
    //    here, before anything executes, and what comes out is the single value
    //    the runtime receives, the trace records and persistence stores. There
    //    is no second job and nothing mutates the first. `deepFreeze` rather
    //    than `Object.freeze` is what makes "immutable after execution begins"
    //    reach `budget.maxCostUsd` and `permissions[0].mode` rather than
    //    stopping at the top level.
    const job = domain.createJob(validInput);
    const effectiveJob: Job<TInput, TOutput> = deepFreeze({
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

    // 4. Fingerprint the behavior, **before the first event is recorded**
    //    (M2-T8, ADR-0034). Resolving it here rather than lazily is what makes
    //    "every event of a run carries the same fingerprint" true: the
    //    descriptor is gathered once, so an instructions file edited while a
    //    run is in flight cannot split one run across two behaviors.
    //
    //    A domain that declares no `behavior` yields `null`, and `null` is what
    //    the recorder stamps. A placeholder digest would be worse than an
    //    absent one, because every comparison built on it would silently
    //    succeed (ADR-0031, M2-T3's reason for leaving the field `null`).
    const behavior = await resolveBehaviorFingerprint(domain.behavior);

    // The run's single sequence owner (M2-T3/M2-T4, ADR-0031). The harness's
    // `run.*` events and the adapter's `agent.*`/`model.*`/`tool.*` events go
    // through this one recorder, which is why a run now has one total order
    // instead of two collections each numbered from 0.
    const recorder = createTraceRecorder({
      runId,
      writer: trace,
      attempt,
      clock,
      behaviorFingerprint: behavior?.fingerprint ?? null,
    });

    const emit = async (
      type: TraceEventType,
      payload: JsonObject,
      extra: TraceEmitExtra = {},
    ): Promise<void> => {
      // Every `run.*` event is a root: a run is already identified by `runId`,
      // so it needs no pointer to itself. The adapter's `agent.started` hangs
      // off `recorder.rootId` instead, which is this run's `run.started`.
      await recorder.record({ type, payload, parentId: null, ...extra });
    };

    const context = createExecutionContext({
      runId,
      jobId: effectiveJob.id,
      domain: effectiveJob.domain,
      attempt,
      budget: effectiveJob.budget,
      permissions: effectiveJob.permissions,
      recorder,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      // `runtime` is deliberately omitted: the harness does not yet know which
      // adapter will run this job. See `HARNESS_RUNTIME_INFO`.
    });

    const base = {
      runId,
      jobId: effectiveJob.id,
      domain: effectiveJob.domain,
      attempt,
      behaviorFingerprint: behavior,
    } as const;

    const startedAt = clock.now().getTime();

    await emit(RUN_EVENTS.started, {
      jobId: effectiveJob.id,
      domain: effectiveJob.domain.id,
      domainVersion: effectiveJob.domain.version,
      jobType: effectiveJob.jobType,
      attempt,
      // The per-component digests, so a trace on its own can answer *which*
      // part of the behavior changed between two runs rather than only that
      // something did. Every value is a `sha256:` string, so this is identity
      // data and keeps the payload identity-only (ADR-0031); the descriptor's
      // actual content never enters a trace.
      ...(behavior === null ? {} : { behavior: behaviorFingerprintPayload(behavior) }),
    });

    /**
     * Record the run's terminal event and flush, then return the result.
     *
     * Usage, latency and error are derived from the result rather than passed
     * in at each call site, so the three can never disagree with what the
     * caller is handed back.
     *
     * **`flush()` is awaited and its failure is not caught.** A `StorageError`
     * from the writer propagates out of `harness.run()`, which is M2's
     * "storage failures cannot silently turn into successful runs" acceptance
     * criterion: a run whose trace was not persisted is not a run anyone can
     * inspect, evaluate or replay, so reporting it as `completed` would be a
     * false record (ADR-0031).
     */
    const finish = async <TResult extends HarnessRunResult<TOutput>>(
      type: TraceEventType,
      payload: JsonObject,
      result: TResult,
    ): Promise<TResult> => {
      await emit(type, payload, {
        usage: traceUsage(result.usage),
        latencyMs: Math.max(0, clock.now().getTime() - startedAt),
        error: result.status === "failed" ? result.error : null,
      });
      await recorder.flush();
      return result;
    };

    // 6. A signal that is already aborted short-circuits. The runtime is not
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

    // 7. Run. A runtime is contractually required to *return* a failure rather
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
        { jobId: effectiveJob.id, errorCode: error.code },
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
        { jobId: effectiveJob.id, errorCode: execution.error.code },
        { ...base, ...outcome, status: "failed", error: execution.error },
      );
    }

    // 8. Validate the output before calling the run a success. This is the
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
        { jobId: effectiveJob.id, errorCode: error.code },
        { ...base, ...outcome, status: "failed", error },
      );
    }

    return await finish(
      RUN_EVENTS.completed,
      { jobId: effectiveJob.id },
      { ...base, ...outcome, status: "completed", output },
    );
  }

  return { run };
}
