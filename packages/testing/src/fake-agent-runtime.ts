import type {
  AgentExecution,
  AgentRuntime,
  ExecutionContext,
  Job,
  RuntimeInfo,
} from "@internal/core";

/**
 * A scripted {@link AgentRuntime} for unit tests.
 *
 * Milestone 1's acceptance criteria include "a fake `AgentRuntime` can replace
 * `EveAgentRuntime` in a unit test" and "cancellation/abort signal reaches the
 * runtime". This is what proves both: it implements the same `AgentRuntime`
 * interface as the real adapter and nothing else, so a test that passes with it
 * is a test about the harness rather than about `eve`.
 *
 * It makes no model call, opens no socket and reads no environment variable.
 */

/** One recorded `run` call. */
export interface FakeAgentRuntimeCall {
  /** The job the runtime was handed. */
  readonly job: Job;
  /** The context it was handed. */
  readonly context: ExecutionContext;
}

/** A function that produces the result of one `run`. */
export type FakeAgentRuntimeHandler = (
  job: Job,
  context: ExecutionContext,
) => AgentExecution | Promise<AgentExecution>;

/** What a {@link FakeAgentRuntime} does on every call, plus its timing. */
export interface FakeAgentRuntimeBehaviour {
  /**
   * How long the run pretends to take, in milliseconds, before the handler is
   * consulted. This is the window in which `context.signal` can land, which is
   * how a test proves cancellation reaches the runtime. Defaults to `0`, a run
   * that finishes immediately.
   */
  readonly delayMs?: number;
  /**
   * What the runtime reports about itself. Defaults to
   * `{ name: "fake", version: "0.0.0", metadata: {} }`.
   */
  readonly runtime?: RuntimeInfo;
}

/** Return the same result on every call. */
export interface FakeAgentRuntimeResultOptions extends FakeAgentRuntimeBehaviour {
  /** The execution to resolve with. */
  readonly result: AgentExecution;
  readonly handler?: never;
}

/** Compute a result per call. */
export interface FakeAgentRuntimeHandlerOptions extends FakeAgentRuntimeBehaviour {
  /** Called with the job and context the runtime received. */
  readonly handler: FakeAgentRuntimeHandler;
  readonly result?: never;
}

/** The options {@link createFakeAgentRuntime} accepts. */
export type CreateFakeAgentRuntimeOptions =
  | FakeAgentRuntimeResultOptions
  | FakeAgentRuntimeHandlerOptions;

/** An {@link AgentRuntime} that also records what it was asked to do. */
export interface FakeAgentRuntime extends AgentRuntime {
  /** Every `run` call, in order, including ones that aborted. */
  readonly calls: readonly FakeAgentRuntimeCall[];
}

const DEFAULT_RUNTIME: RuntimeInfo = { name: "fake", version: "0.0.0", metadata: {} };

/**
 * Restate a scripted execution as the output type the caller's job declares.
 *
 * A test writes the result and knows what type it is standing in for; the
 * `AgentRuntime` interface, being generic in the job, cannot. This single
 * assertion is the whole of the fake's type-level dishonesty, and it is exactly
 * why the harness re-validates a completed output against the domain's schema
 * rather than trusting what a runtime claims.
 */
function asOutput<TOutput>(execution: AgentExecution): AgentExecution<TOutput> {
  return execution as AgentExecution<TOutput>;
}

/**
 * Resolve to `true` if `signal` aborts within `delayMs`, `false` if the delay
 * elapses first.
 *
 * A real timer rather than `createFakeClock`, because a fake clock does not
 * schedule anything: nothing would ever resume the run. The timer is cleared
 * and the listener removed on whichever branch wins, so no test leaks a handle.
 */
function raceAbort(signal: AbortSignal, delayMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, delayMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Create a {@link FakeAgentRuntime}.
 *
 * ```ts
 * const runtime = createFakeAgentRuntime({
 *   result: {
 *     status: "completed",
 *     output: { category: "bookkeeping" },
 *     usage: { modelCalls: 1, toolCalls: 1, durationMs: 3 },
 *     runtime: { name: "fake", version: "0.0.0", metadata: {} },
 *   },
 * });
 * ```
 *
 * Cancellation is honoured the way the contract requires of a real adapter: an
 * already-aborted signal resolves with `status: "aborted"` without consulting
 * the handler at all, and a signal that fires during `delayMs` does the same.
 * The call is still recorded in {@link FakeAgentRuntime.calls} either way, so a
 * test can assert that the runtime was reached before it was cancelled.
 */
export function createFakeAgentRuntime(options: CreateFakeAgentRuntimeOptions): FakeAgentRuntime {
  const calls: FakeAgentRuntimeCall[] = [];
  const runtimeInfo = options.runtime ?? DEFAULT_RUNTIME;
  const delayMs = options.delayMs ?? 0;

  const scripted = options.result;
  const handler: FakeAgentRuntimeHandler =
    options.handler ??
    ((): AgentExecution => {
      if (scripted === undefined) {
        throw new TypeError(
          "createFakeAgentRuntime: exactly one of `result` or `handler` is required",
        );
      }
      return scripted;
    });

  function aborted(): AgentExecution {
    return {
      status: "aborted",
      usage: { modelCalls: 0, toolCalls: 0, durationMs: 0 },
      runtime: runtimeInfo,
    };
  }

  return {
    calls,
    async run<TInput, TOutput>(
      job: Job<TInput, TOutput>,
      context: ExecutionContext,
    ): Promise<AgentExecution<TOutput>> {
      calls.push({ job, context });

      if (context.signal.aborted) {
        return asOutput<TOutput>(aborted());
      }

      if (delayMs > 0 && (await raceAbort(context.signal, delayMs))) {
        return asOutput<TOutput>(aborted());
      }

      return asOutput<TOutput>(await handler(job, context));
    },
  };
}
