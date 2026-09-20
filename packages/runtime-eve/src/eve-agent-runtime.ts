import { createRequire } from "node:module";
import {
  type AgentExecution,
  AgentExecutionError,
  type AgentExecutionUsage,
  type AgentRuntime,
  BudgetExceededError,
  type ExecutionContext,
  type FallbackContext,
  type Job,
  type JsonObject,
  type JsonValue,
  PermissionDeniedError,
  type RuntimeInfo,
  type Schema,
  serializeError,
  ToolExecutionError,
  type TraceEventId,
  type TraceEventUsage,
  type TraceRecorder,
  type TraceSpan,
  type TraceSpanEndInput,
  ValidationError,
} from "@internal/core";
import {
  type CancelSessionResult,
  Client,
  type ClientAuth,
  type ClientRedirectPolicy,
  type HeadersValue,
  isTurnFailureEvent,
  type MessageStreamEvent,
  type SendTurnInput,
} from "eve/client";
import {
  actionRequestToolName,
  actionResultCallId,
  actionResultToolName,
  eveEventIdentity,
  failureDetail,
  LOAD_SKILL_TOOL_ID,
  readErrorCode,
  stepTraceUsage,
  stepUsage,
} from "./eve-events.js";
import { type EveOutputSchema, toEveOutputSchema } from "./eve-schema.js";

/**
 * `EveAgentRuntime`, the harness's `eve` adapter (M1-T6).
 *
 * See `docs/architecture/runtime.md` for the end-to-end description and
 * ADR-0028 for the decisions behind it. The three that shape this file:
 *
 * 1. **URL only.** The adapter is a client and never spawns a process. `eve`
 *    0.63.0 exposes no in-process run API — its own Next, Nuxt and SvelteKit
 *    adapters spawn `eve dev --no-ui --port 0` as a child
 *    (`eve/dist/src/public/next/server.js`) and `eve eval` targets an HTTP URL
 *    (`eve/docs/evals/targets.mdx`) — so somebody has to own a server, and a
 *    runtime adapter that owns child processes is the wrong place for it.
 *    `startEveDevServer()` in `@internal/runtime-eve/testing` is that somebody.
 * 2. **The `eve/client` event stream is the observation source**, consumed live
 *    rather than through `MessageResponse.result()`, because the adapter has to
 *    police permissions and budget as the run proceeds. ADR-0028 amends
 *    ADR-0012's "`eve/hooks`" wording; it is the same documented envelope
 *    (`eve/docs/concepts/sessions-runs-and-streaming.md`, "The event envelope").
 * 3. **Terminal state is read from turn boundary events**, never from
 *    `MessageResult.status`, which reports where the *session* ended and was
 *    observed to be `"waiting"` for a success, a failure and a cancellation
 *    alike (research note §15.7).
 */

const requireFromHere = createRequire(import.meta.url);

/** The adapter's `RuntimeInfo.name`. Stable; a trace reader branches on it. */
const RUNTIME_NAME = "eve";

let cachedEveVersion: string | undefined;

/**
 * The installed `eve` version, read from the package's own manifest.
 *
 * `eve/package.json` is a declared subpath of eve's export map (verified), so
 * this is a public read rather than a reach into an internal path. Cached
 * because it cannot change while the process runs, and read lazily so a
 * resolution problem surfaces on a run rather than on import.
 */
export function eveVersion(): string {
  if (cachedEveVersion !== undefined) {
    return cachedEveVersion;
  }

  let version = "unknown";

  try {
    const manifest: unknown = requireFromHere("eve/package.json");

    if (typeof manifest === "object" && manifest !== null) {
      const declared: unknown = (manifest as { readonly version?: unknown }).version;

      if (typeof declared === "string" && declared !== "") {
        version = declared;
      }
    }
  } catch {
    version = "unknown";
  }

  cachedEveVersion = version;

  return version;
}

/**
 * The turn handle the adapter needs from `eve/client`.
 *
 * Structurally satisfied by `MessageResponse`. Declared here rather than
 * imported so a unit test can inject a scripted stream without a server, and so
 * the adapter depends on three members instead of a class.
 */
export interface EveTurnResponse extends AsyncIterable<MessageStreamEvent> {
  /** The session id the server assigned. */
  readonly sessionId: string;
  /** Request cooperative cancellation of this exact turn. */
  cancel(): Promise<CancelSessionResult>;
}

/**
 * The client surface the adapter needs.
 *
 * Structurally satisfied by `eve/client`'s `Client`. Injecting one is how the
 * unit tests exercise every branch below with no process and no credential;
 * the contract tests use a real `Client` against a real server.
 */
export interface EveClientLike {
  /** Fail fast when the server is not up. */
  health(): Promise<unknown>;
  readonly sessions: {
    /** Create a fresh session and start its first turn. */
    create<TOutput>(input: SendTurnInput<TOutput>): Promise<{ readonly response: EveTurnResponse }>;
  };
}

/**
 * The minimum of a `DomainDefinition` the adapter needs.
 *
 * A `DomainDefinition` from `@internal/core` satisfies it structurally, so a
 * caller writes `domains: [vendorTriage]`.
 *
 * **Why the adapter needs this at all.** `AgentRuntime.run(job, context)` hands
 * over a `Job`, and a job names its contracts as strings
 * (`vendor-triage.output@1.0.0`) rather than carrying schema objects, because a
 * job is serialized into a trace. Resolving a reference to a schema is the
 * capability registry's job, and the registry is M1-T9. Until it exists, the
 * adapter is given the schemas directly. **M1-T9 replaces this option.**
 */
export interface EveDomainOutputSchema {
  /** The domain's stable id, matching `Job.domain.id`. */
  readonly id: string;
  /** The domain's version, matching `Job.domain.version`. */
  readonly version: string;
  /** The schema every agent output for this domain must satisfy. */
  readonly outputSchema: Schema<unknown>;
}

/** A source of "now". Structurally satisfied by `createFakeClock()`. */
export interface EveClock {
  /** The current instant. */
  now(): Date;
}

/** The options {@link EveAgentRuntime} accepts. */
export interface EveAgentRuntimeOptions {
  /**
   * Base URL of a running eve server, e.g. `http://127.0.0.1:2000`. Required
   * unless {@link client} is supplied.
   */
  readonly host?: string;
  /** Credentials for a protected eve channel route. Forwarded to `Client`. */
  readonly auth?: ClientAuth;
  /** Headers sent with every request. Forwarded to `Client`. */
  readonly headers?: HeadersValue;
  /**
   * Redirect policy. Forwarded to `Client`, which documents that a
   * credential-bearing client should use `"manual"` or `"error"` so custom
   * authorization headers cannot follow a cross-origin redirect. The adapter
   * defaults to `"manual"` whenever `auth` or `headers` is set.
   */
  readonly redirect?: ClientRedirectPolicy;
  /**
   * An already-built client, instead of `host`. This is the unit-test seam and
   * also lets a caller share one client across runtimes.
   */
  readonly client?: EveClientLike;
  /**
   * The domains whose output schemas this runtime can request. A job for an
   * unlisted domain fails before any turn starts. Replaced by M1-T9.
   */
  readonly domains?: readonly EveDomainOutputSchema[];
  /** Where wall-clock time comes from. Defaults to the system clock. */
  readonly clock?: EveClock;
}

const SYSTEM_CLOCK: EveClock = { now: () => new Date() };

/**
 * Whatever `SendTurnOptions.clientContext` accepts, derived from the public
 * type. Derived for the same reason {@link EveOutputSchema} is: eve's
 * `JsonObject` forbids an `undefined` property value and core's admits one, so
 * the two are not mutually assignable and the conversion belongs in one place.
 */
type EveClientContext = NonNullable<SendTurnInput<unknown>["clientContext"]>;

/**
 * Restate eve's `JsonValue` result as the output type the caller's job declares.
 *
 * The same single, contained assertion `createFakeAgentRuntime()` makes, and for
 * the same reason: `AgentExecution<TOutput>` is generic in the job while the
 * value came off a wire as JSON. A runtime asserts an output type, it does not
 * prove one, which is exactly why `createHarness()` re-validates the value
 * against the domain's `outputSchema` before any caller sees it.
 */
function asOutput<TOutput>(value: JsonValue): TOutput {
  return value as TOutput;
}

/** Mutable accounting for one `run()`. */
interface RunState {
  modelCalls: number;
  toolCalls: number;
  costUsd: number | undefined;
  sessionId: string | undefined;
  turnId: string | undefined;
}

/**
 * The spans one turn has open, so a terminal event can close the right one.
 *
 * `sequence` used to live on {@link RunState} and no longer does: the run's
 * {@link TraceRecorder} owns ordering now, which is what stops the harness's
 * `run.*` events and this adapter's events from both numbering themselves from
 * 0 within one run (M2-T3/M2-T4, ADR-0031). What the adapter still has to track
 * is span identity, and eve tells it exactly how: model spans are keyed by turn
 * and `stepIndex`, and tool spans by `callId`, which
 * `ActionsRequestedStreamEvent`'s own documentation requires ("consumers must
 * correlate action lifecycles by call ID").
 */
interface TurnSpans {
  /** The turn's `agent.started`, and the parent of everything inside it. */
  agent: TraceSpan | undefined;
  /** Open `model.started` spans, keyed by `<turnId>:<stepIndex>`. */
  readonly model: Map<string, TraceSpan>;
  /** Open `tool.started` spans, keyed by eve's `callId`. */
  readonly tool: Map<string, TraceSpan>;
}

/**
 * The first real {@link AgentRuntime}: it runs a {@link Job} as one turn of one
 * fresh `eve` session, over `eve/client`.
 *
 * ```ts
 * const runtime = new EveAgentRuntime({ host, domains: [vendorTriage] });
 * const execution = await runtime.run(job, context);
 * ```
 *
 * `run()` never throws for an agent failure; it resolves `failed` with a
 * serialized harness error, or `aborted` when `context.signal` fires. The
 * constructor throws `TypeError` for a programmer error, because a runtime
 * built without a target is not a run that failed.
 */
export class EveAgentRuntime implements AgentRuntime {
  readonly #client: EveClientLike;
  readonly #clock: EveClock;
  readonly #outputSchemas: ReadonlyMap<string, Schema<unknown>>;

  constructor(options: EveAgentRuntimeOptions) {
    if (options.client === undefined && options.host === undefined) {
      throw new TypeError("EveAgentRuntime: one of `host` or `client` is required");
    }

    if (options.client !== undefined && options.host !== undefined) {
      throw new TypeError("EveAgentRuntime: `host` and `client` are mutually exclusive");
    }

    this.#client = options.client ?? new Client(clientOptions(options));
    this.#clock = options.clock ?? SYSTEM_CLOCK;
    this.#outputSchemas = new Map(
      (options.domains ?? []).map((domain) => [
        domainKey(domain.id, domain.version),
        domain.outputSchema,
      ]),
    );
  }

  async run<TInput, TOutput>(
    job: Job<TInput, TOutput>,
    context: ExecutionContext,
  ): Promise<AgentExecution<TOutput>> {
    const startedAt = this.#clock.now().getTime();
    const state: RunState = {
      modelCalls: 0,
      toolCalls: 0,
      costUsd: undefined,
      sessionId: undefined,
      turnId: undefined,
    };

    const usage = (): AgentExecutionUsage => ({
      modelCalls: state.modelCalls,
      toolCalls: state.toolCalls,
      durationMs: Math.max(0, this.#clock.now().getTime() - startedAt),
      ...(state.costUsd === undefined ? {} : { costUsd: state.costUsd }),
    });

    const runtime = (): RuntimeInfo => ({
      name: RUNTIME_NAME,
      version: eveVersion(),
      metadata: {
        ...(state.sessionId === undefined ? {} : { sessionId: state.sessionId }),
        ...(state.turnId === undefined ? {} : { turnId: state.turnId }),
      },
    });

    const failed = (error: unknown): AgentExecution<TOutput> => ({
      status: "failed",
      error: serializeError(error),
      usage: usage(),
      runtime: runtime(),
    });

    const aborted = (): AgentExecution<TOutput> => ({
      status: "aborted",
      usage: usage(),
      runtime: runtime(),
    });

    try {
      return await this.#runTurn(job, context, state, { usage, runtime, failed, aborted });
    } catch (cause) {
      // The contract reserves throwing for a defect in the adapter, so anything
      // that escapes the turn is reported as a failure with the usage it
      // accrued rather than propagated to the caller.
      return failed(
        new AgentExecutionError("EveAgentRuntime: the run ended unexpectedly", { cause }),
      );
    }
  }

  async #runTurn<TInput, TOutput>(
    job: Job<TInput, TOutput>,
    context: ExecutionContext,
    state: RunState,
    result: {
      usage: () => AgentExecutionUsage;
      runtime: () => RuntimeInfo;
      failed: (error: unknown) => AgentExecution<TOutput>;
      aborted: () => AgentExecution<TOutput>;
    },
  ): Promise<AgentExecution<TOutput>> {
    if (context.signal.aborted) {
      return result.aborted();
    }

    // 1. Resolve the domain's output schema and lower it to JSON Schema.
    const schema = this.#outputSchemas.get(domainKey(job.domain.id, job.domain.version));

    if (schema === undefined) {
      return result.failed(
        new AgentExecutionError(
          `EveAgentRuntime: no output schema is registered for domain ${domainKey(job.domain.id, job.domain.version)}. Pass it in \`domains\` when constructing the runtime.`,
          { details: { domain: job.domain.id, version: job.domain.version } },
        ),
      );
    }

    let outputSchema: EveOutputSchema;

    try {
      outputSchema = toEveOutputSchema(schema, `${job.domain.id} outputSchema`);
    } catch (cause) {
      return result.failed(cause);
    }

    // 2. Preflight. A server that is not up should say so before a session
    //    exists, not as a transport error halfway through a turn.
    try {
      await this.#client.health();
    } catch (cause) {
      if (context.signal.aborted) {
        return result.aborted();
      }
      return result.failed(
        new AgentExecutionError("EveAgentRuntime: the eve server is not reachable", { cause }),
      );
    }

    // 3. Create a fresh session and start its first turn. One session per run:
    //    a brand-new session starts with clean history and fresh state
    //    (`eve/docs/concepts/state.md`), so no teardown is needed and none is
    //    done. `session.reset()` is deliberately not called; it would retire the
    //    id a human might want to inspect with `eve dev <url>`.
    let response: EveTurnResponse;

    try {
      const created = await this.#client.sessions.create<unknown>({
        message: job.objective,
        clientContext: jobClientContext(job, context),
        outputSchema,
        signal: context.signal,
      });
      response = created.response;
    } catch (cause) {
      if (context.signal.aborted) {
        return result.aborted();
      }
      return result.failed(
        new AgentExecutionError("EveAgentRuntime: the turn could not be started", { cause }),
      );
    }

    state.sessionId = response.sessionId;

    return await this.#consume(response, context, state, result);
  }

  async #consume<TOutput>(
    response: EveTurnResponse,
    context: ExecutionContext,
    state: RunState,
    result: {
      usage: () => AgentExecutionUsage;
      runtime: () => RuntimeInfo;
      failed: (error: unknown) => AgentExecution<TOutput>;
      aborted: () => AgentExecution<TOutput>;
    },
  ): Promise<AgentExecution<TOutput>> {
    let cancelRequested = false;

    /**
     * Ask eve to stop this exact turn. Best-effort and idempotent: the run is
     * already ending for a reason the caller will be told about, and a failed
     * cancel must not replace that reason. Both documented outcomes,
     * `"accepted"` and `"no_active_turn"`, are success.
     */
    const cancelTurn = (): void => {
      if (cancelRequested) {
        return;
      }
      cancelRequested = true;
      void response.cancel().catch(() => undefined);
    };

    // `context.signal` is propagated twice, as the execution-context contract
    // requires: it was passed to the client call above so a hung transport
    // cannot outlive the job, and it cancels the durable run here. Aborting the
    // request alone would leave the turn running server-side.
    const onAbort = (): void => {
      cancelTurn();
    };
    context.signal.addEventListener("abort", onAbort, { once: true });

    // Budget: a wall-clock limit that is only checked when an event arrives is
    // not a limit at all, because a stalled turn emits nothing. The timer is the
    // one piece of enforcement that does not depend on the stream.
    let policyFailure: unknown;
    const recordPolicyFailure = (error: unknown): void => {
      policyFailure ??= error;
      cancelTurn();
    };

    const maxDurationMs = context.budget.maxDurationMs;
    const durationTimer =
      maxDurationMs === undefined
        ? undefined
        : setTimeout(() => {
            recordPolicyFailure(
              new BudgetExceededError(
                `EveAgentRuntime: the run exceeded its ${maxDurationMs}ms duration budget`,
                { dimension: "maxDurationMs", limit: maxDurationMs, actual: maxDurationMs },
              ),
            );
          }, maxDurationMs);
    durationTimer?.unref?.();

    const spans: TurnSpans = { agent: undefined, model: new Map(), tool: new Map() };
    let turnCompleted = false;
    let turnCancelled = false;
    let failureEvent: MessageStreamEvent | undefined;
    let inputRequested = false;
    let resultData: JsonValue | undefined;
    let streamError: unknown;

    try {
      for await (const event of response) {
        state.turnId ??= "data" in event ? readTurnId(event.data) : undefined;

        await this.#trace(event, context, state, spans);

        this.#account(event, state);
        this.#enforce(event, context, state, recordPolicyFailure);

        if (isTurnFailureEvent(event)) {
          failureEvent ??= event;
        }

        switch (event.type) {
          case "result.completed":
            resultData = event.data.result;
            break;
          case "input.requested":
            inputRequested = true;
            // M1 has no human in the loop. The turn would park durably "for as
            // long as it takes", so it is stopped rather than waited on.
            recordPolicyFailure(
              new AgentExecutionError(
                "EveAgentRuntime: the agent asked for human input, which the M1 harness cannot answer",
                { details: { requestCount: event.data.requests.length } },
              ),
            );
            break;
          case "turn.completed":
            turnCompleted = true;
            break;
          case "turn.cancelled":
            turnCancelled = true;
            break;
          default:
            break;
        }
      }
    } catch (cause) {
      streamError = cause;
    } finally {
      context.signal.removeEventListener("abort", onAbort);
      if (durationTimer !== undefined) {
        clearTimeout(durationTimer);
      }
    }

    // The order below is the precedence the adapter promises. The caller's own
    // cancellation outranks everything, because a run the caller stopped is
    // `aborted` whatever else the stream said on its way out.
    if (context.signal.aborted) {
      return result.aborted();
    }

    if (policyFailure !== undefined) {
      return result.failed(policyFailure);
    }

    if (streamError !== undefined) {
      return result.failed(
        new AgentExecutionError("EveAgentRuntime: the turn's event stream failed", {
          cause: streamError,
        }),
      );
    }

    if (failureEvent !== undefined) {
      const detail = failureDetail(failureEvent);
      return result.failed(
        new AgentExecutionError(`EveAgentRuntime: eve reported ${detail.code}`, {
          // eve publishes no catalogue of failure codes, so the adapter carries
          // the code it was given rather than switching on it (research note
          // §11 item 7).
          details: { code: detail.code, message: detail.message, event: failureEvent.type },
        }),
      );
    }

    if (inputRequested) {
      return result.failed(
        new AgentExecutionError(
          "EveAgentRuntime: the turn parked on a human-input request and could not settle",
        ),
      );
    }

    if (turnCancelled) {
      return result.failed(
        new AgentExecutionError("EveAgentRuntime: the turn was cancelled without a harness reason"),
      );
    }

    if (!turnCompleted) {
      return result.failed(
        new AgentExecutionError(
          "EveAgentRuntime: the turn's event stream ended without a terminal boundary",
        ),
      );
    }

    if (resultData === undefined) {
      // The turn settled without fulfilling the schema it was given. The
      // adapter never falls back to `MessageResult.message`, which is
      // `undefined` on a structured turn anyway (research note §15.7 item 2).
      return result.failed(
        new ValidationError(
          "EveAgentRuntime: the turn completed without producing the requested structured output",
          { issues: [{ path: [], message: "expected a `result.completed` event, received none" }] },
        ),
      );
    }

    return {
      status: "completed",
      output: asOutput<TOutput>(resultData),
      usage: result.usage(),
      runtime: result.runtime(),
    };
  }

  /**
   * Map one eve stream event onto the harness trace taxonomy (M2-T3).
   *
   * **The adapter no longer invents `eve.<type>` event names.** M1 namespaced
   * them because the taxonomy did not exist yet; it does now, so an event
   * either *is* one of its members or is not a trace event at all. The table:
   *
   * | eve stream event | trace event |
   * | --- | --- |
   * | `turn.started` | `agent.started` (opens the run's agent span) |
   * | `turn.completed` | `agent.completed` |
   * | `turn.failed`, `session.failed` | `agent.failed` |
   * | `turn.cancelled` | `agent.failed`, `payload.cancelled: true` |
   * | `step.started` | `model.started` |
   * | `step.completed` | `model.completed`, with the step's usage |
   * | `step.failed` | `model.failed` |
   * | `actions.requested` | one `tool.started` per requested action |
   * | `action.result` | `tool.completed`, or `tool.failed` when eve's `status` is `failed` or `rejected` |
   * | `input.requested` | `approval.requested` |
   * | `input.resolved` | `approval.resolved` |
   *
   * Every other eve event is **not** a trace event: the deltas
   * (`message.appended`, `reasoning.appended`, `action.input.appended`,
   * `action.partial`) are content this trace does not carry, `result.completed`
   * *is* the model's output, and the session, compaction, context, subagent,
   * authorization and approval-candidate events have no counterpart in a
   * taxonomy that M2 has nothing to do with yet. ADR-0031 lists them and says
   * what would have to change to add one.
   *
   * A cancelled turn maps to `agent.failed` rather than to nothing, because a
   * span that is never closed makes a trace unreadable; `payload.cancelled`
   * and the error's message are what distinguish it from a real failure, and
   * the run-level event is `run.aborted` in that case anyway.
   */
  async #trace(
    event: MessageStreamEvent,
    context: ExecutionContext,
    state: RunState,
    spans: TurnSpans,
  ): Promise<void> {
    const recorder = context.trace;
    const at = event.meta.at;
    const identity = eveEventIdentity(event);
    // Inside a turn, everything hangs off the agent span. Before one exists
    // (or after it closed), the run's own `run.started` is the parent.
    const parentId = spans.agent?.id ?? recorder.rootId;

    switch (event.type) {
      case "turn.started": {
        spans.agent = await recorder.span({
          type: "agent.started",
          timestamp: at,
          parentId: recorder.rootId,
          payload: {
            ...identity,
            runtime: RUNTIME_NAME,
            ...(state.sessionId === undefined ? {} : { sessionId: state.sessionId }),
          },
        });
        return;
      }

      case "turn.completed": {
        await endAgentSpan(recorder, spans, {
          type: "agent.completed",
          timestamp: at,
          payload: identity,
          usage: accruedUsage(state),
        });
        return;
      }

      case "turn.failed":
      case "session.failed": {
        const { code } = failureDetail(event);

        await endAgentSpan(recorder, spans, {
          type: "agent.failed",
          timestamp: at,
          payload: { ...identity, code },
          usage: accruedUsage(state),
          // The code, never eve's message: a provider failure message is text
          // the harness did not author and has not redacted (M2-T9).
          error: serializeError(
            new AgentExecutionError(`EveAgentRuntime: eve reported ${code}`, {
              details: { code, event: event.type },
            }),
          ),
        });
        return;
      }

      case "turn.cancelled": {
        await endAgentSpan(recorder, spans, {
          type: "agent.failed",
          timestamp: at,
          payload: { ...identity, cancelled: true },
          usage: accruedUsage(state),
          error: serializeError(
            new AgentExecutionError(
              "EveAgentRuntime: the turn was cancelled before it produced a result",
              { details: { event: event.type } },
            ),
          ),
        });
        return;
      }

      case "step.started": {
        spans.model.set(
          stepKey(event.data.turnId, event.data.stepIndex),
          await recorder.span({
            type: "model.started",
            timestamp: at,
            parentId,
            payload: { ...identity, modelId: event.data.modelId },
          }),
        );
        return;
      }

      case "step.completed": {
        await endKeyedSpan(
          recorder,
          spans.model,
          stepKey(event.data.turnId, event.data.stepIndex),
          parentId,
          {
            type: "model.completed",
            timestamp: at,
            payload: { ...identity, finishReason: event.data.finishReason },
            usage: stepTraceUsage(event),
          },
        );
        return;
      }

      case "step.failed": {
        const { code } = failureDetail(event);

        await endKeyedSpan(
          recorder,
          spans.model,
          stepKey(event.data.turnId, event.data.stepIndex),
          parentId,
          {
            type: "model.failed",
            timestamp: at,
            payload: { ...identity, code },
            error: serializeError(
              new AgentExecutionError(`EveAgentRuntime: a model call reported ${code}`, {
                details: { code, event: event.type },
              }),
            ),
          },
        );
        return;
      }

      case "actions.requested": {
        // One span per requested action, not one per event: eve documents that
        // a step's calls may arrive across several events and must be
        // correlated by `callId`.
        for (const action of event.data.actions) {
          spans.tool.set(
            action.callId,
            await recorder.span({
              type: "tool.started",
              timestamp: at,
              parentId,
              payload: {
                ...identity,
                tool: actionRequestToolName(action),
                callId: action.callId,
                kind: action.kind,
              },
            }),
          );
        }
        return;
      }

      case "action.result": {
        const { status } = event.data;
        const callId = actionResultCallId(event.data.result);
        const tool = actionResultToolName(event.data.result) ?? LOAD_SKILL_TOOL_ID;
        const code = event.data.error === undefined ? undefined : readErrorCode(event.data.error);
        const payload: JsonObject = {
          ...identity,
          tool,
          callId,
          status,
          ...(code === undefined ? {} : { code }),
        };

        await endKeyedSpan(recorder, spans.tool, callId, parentId, {
          type: status === "completed" ? "tool.completed" : "tool.failed",
          timestamp: at,
          payload,
          usage: { toolCalls: 1 },
          ...(status === "completed"
            ? {}
            : { error: serializeError(toolFailure(status, tool, code)) }),
        });
        return;
      }

      case "input.requested": {
        await recorder.record({
          type: "approval.requested",
          timestamp: at,
          parentId,
          payload: { ...identity, requestCount: event.data.requests.length },
        });
        return;
      }

      case "input.resolved": {
        await recorder.record({
          type: "approval.resolved",
          timestamp: at,
          parentId,
          payload: {
            ...identity,
            outcomes: event.data.resolutions.map((resolution) => resolution.outcome),
          },
        });
        return;
      }

      default:
        // No counterpart in the taxonomy, so not a trace event (ADR-0031).
        return;
    }
  }

  /**
   * Usage arithmetic over documented fields.
   *
   * `modelCalls` counts `step.completed` and `toolCalls` counts `action.result`;
   * eve publishes no aggregate usage, so the roll-up is the harness's
   * (research note §11 item 4). **Retried steps are counted.** eve runs a
   * durable step up to four times and "no field records which attempt
   * finished", so every `step.completed` is summed and the figure is
   * provider-attempted usage. Over-reporting cost is the safe error.
   */
  #account(event: MessageStreamEvent, state: RunState): void {
    if (event.type === "step.completed") {
      state.modelCalls += 1;

      const cost = stepUsage(event)?.costUsd;

      if (cost !== undefined) {
        state.costUsd = (state.costUsd ?? 0) + cost;
      }

      return;
    }

    if (event.type === "action.result") {
      state.toolCalls += 1;
    }
  }

  /**
   * Permission and budget enforcement, by observation.
   *
   * **This is detection, not prevention, and M1 says so plainly.** `eve` 0.63.0
   * accepts no caller-supplied tool policy: `SendTurnOptions` has no tool field
   * and dynamic resolvers are authored files that never see a caller's grants
   * (research note §6). So the adapter watches `actions.requested` and stops the
   * turn on the first ungranted tool, which means the call was already requested
   * and may already have run. The documented composition that actually prevents
   * it — a channel `AuthFn` minting per-run claims plus a per-tool `approval`
   * policy that denies — is the **M2/M5 upgrade path**, recorded in ADR-0028.
   */
  #enforce(
    event: MessageStreamEvent,
    context: ExecutionContext,
    state: RunState,
    recordPolicyFailure: (error: unknown) => void,
  ): void {
    if (event.type === "actions.requested") {
      for (const action of event.data.actions) {
        const toolId = actionRequestToolName(action);
        // Any grant satisfies a call: the harness cannot tell from an eve event
        // whether a tool wrote anything, so every call needs at least `read`
        // and a `write` grant is strictly stronger than one.
        const granted = context.permissions.some((grant) => grant.toolId === toolId);

        if (!granted) {
          recordPolicyFailure(
            new PermissionDeniedError(
              `EveAgentRuntime: the agent requested \`${toolId}\`, which this job does not grant`,
              { toolId, requested: "read" },
            ),
          );
          return;
        }
      }
    }

    const { maxModelCalls, maxToolCalls, maxCostUsd } = context.budget;

    if (maxModelCalls !== undefined && state.modelCalls > maxModelCalls) {
      recordPolicyFailure(
        new BudgetExceededError(
          `EveAgentRuntime: the run made ${state.modelCalls} model calls against a budget of ${maxModelCalls}`,
          { dimension: "maxModelCalls", limit: maxModelCalls, actual: state.modelCalls },
        ),
      );
      return;
    }

    if (maxToolCalls !== undefined && state.toolCalls > maxToolCalls) {
      recordPolicyFailure(
        new BudgetExceededError(
          `EveAgentRuntime: the run made ${state.toolCalls} tool calls against a budget of ${maxToolCalls}`,
          { dimension: "maxToolCalls", limit: maxToolCalls, actual: state.toolCalls },
        ),
      );
      return;
    }

    // Cost is enforced only when the runtime actually reported one. A mock or
    // direct-provider model reports none, and treating an absent cost as `0`
    // would turn "unknown" into "within budget".
    if (maxCostUsd !== undefined && state.costUsd !== undefined && state.costUsd > maxCostUsd) {
      recordPolicyFailure(
        new BudgetExceededError(
          `EveAgentRuntime: the run spent ${state.costUsd} USD against a budget of ${maxCostUsd}`,
          { dimension: "maxCostUsd", limit: maxCostUsd, actual: state.costUsd },
        ),
      );
    }
  }
}

/** The key a model span is stored under: eve's turn plus its step index. */
function stepKey(turnId: string, stepIndex: number): string {
  return `${turnId}:${String(stepIndex)}`;
}

/** The run's usage so far, for the event that closes the agent span. */
function accruedUsage(state: RunState): TraceEventUsage {
  return {
    modelCalls: state.modelCalls,
    toolCalls: state.toolCalls,
    ...(state.costUsd === undefined ? {} : { costUsd: state.costUsd }),
  };
}

/**
 * Close a keyed span, or record a parentless terminal event when its start was
 * never seen.
 *
 * The fallback is not defensive padding: a caller that reconnects to a running
 * session mid-turn genuinely joins after the `step.started` it would have
 * matched, and dropping the completion would lose the usage attached to it.
 */
async function endKeyedSpan(
  recorder: TraceRecorder,
  spans: Map<string, TraceSpan>,
  key: string,
  fallbackParentId: TraceEventId | null,
  input: TraceSpanEndInput,
): Promise<void> {
  const span = spans.get(key);

  if (span === undefined) {
    await recorder.record({ ...input, parentId: fallbackParentId });
    return;
  }

  spans.delete(key);
  await span.end(input);
}

/** Close the turn's agent span, or record the terminal event against the run. */
async function endAgentSpan(
  recorder: TraceRecorder,
  spans: TurnSpans,
  input: TraceSpanEndInput,
): Promise<void> {
  const span = spans.agent;

  if (span === undefined) {
    await recorder.record({ ...input, parentId: recorder.rootId });
    return;
  }

  spans.agent = undefined;
  await span.end(input);
}

/**
 * The harness error a failed or rejected tool call is recorded with.
 *
 * `rejected` is eve's word for a call a human or a policy denied at an approval
 * gate, so it never executed: that is a permission outcome, not a tool defect,
 * and the error taxonomy already draws exactly that line (ADR-0026,
 * `PermissionDeniedError` versus `ToolExecutionError`).
 */
function toolFailure(
  status: "failed" | "rejected",
  toolId: string,
  code: string | undefined,
): Error {
  if (status === "rejected") {
    return new PermissionDeniedError(
      `EveAgentRuntime: the call to \`${toolId}\` was rejected at an approval gate`,
      { toolId, requested: "read" },
    );
  }

  return new ToolExecutionError(`EveAgentRuntime: \`${toolId}\` reported ${code ?? "UNKNOWN"}`, {
    toolId,
    details: { code: code ?? "UNKNOWN" },
  });
}

function domainKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function readTurnId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const turnId: unknown = (data as { readonly turnId?: unknown }).turnId;

  return typeof turnId === "string" ? turnId : undefined;
}

/**
 * How a job, and a fallback envelope when there is one, are presented to the
 * agent.
 *
 * Harness-owned, because eve documents no context slot for either half of a
 * job. `message` is the objective, the instruction the model must act on;
 * `clientContext` is the data it acts on. `clientContext` is the right home for
 * the data because eve's shipped docs state exactly what it does: an object is
 * "JSON-serialized into one context message", "remains available to every model
 * call in the turn, then disappears before the next turn", and "isn't persisted
 * to durable session history" (`eve/docs/guides/client/messages.mdx`,
 * `eve/dist/src/protocol/message.d.ts`). That is precisely the lifetime of a
 * one-shot job, and of a one-shot escalation.
 *
 * ## The fallback envelope (M5-T6, ADR-0044)
 *
 * When `context.fallback` is set, this run is an escalation from a compiled
 * workflow and the envelope travels under the `harness.fallback` key of the
 * same object. M5-T6 requires the full-agent adapter to receive it "through its
 * documented runtime boundary", and this is eve's: the model sees it as an
 * ordinary context message on every model call of the turn, so an agent whose
 * instructions tell it to look can use what the workflow already established
 * instead of re-researching it (north-star invariant 9).
 *
 * **The key name and the envelope's shape are the harness's, not eve's.** eve
 * documents the transport and imposes no schema on what a `clientContext`
 * object contains, so `harness.fallback` is a harness contract, recorded in
 * `docs/architecture/runtime.md` and in
 * `docs/research/vercel/2026-09-20-m5-eve-client-context-for-fallback.md`.
 *
 * **Everything here reaches the model.** Neither half may carry a secret. The
 * envelope is references and flags — node ids, output references, trust bits,
 * an artifact id, the remaining budget — and carries no node output, which is
 * what keeps an escalation from smuggling unredacted tool results into a
 * prompt.
 */
function jobClientContext<TInput, TOutput>(
  job: Job<TInput, TOutput>,
  context: ExecutionContext,
): EveClientContext {
  const clientContext: Record<string, unknown> = {
    jobId: job.id,
    domain: { id: job.domain.id, version: job.domain.version },
    jobType: job.jobType,
    // A job's input was produced by the domain's Standard Schema and is JSON
    // data by contract, but `TInput` is generic so nothing here can prove it.
    // eve JSON-serializes `clientContext` regardless, so an input that is not
    // JSON data degrades the way `JSON.stringify` would rather than failing
    // this call.
    input: job.input,
  };

  if (context.fallback !== undefined) {
    // Namespaced under `harness` so a domain that puts its own data in
    // `clientContext` one day cannot collide with it, and so an agent's
    // instructions can name one stable path.
    clientContext.harness = { fallback: fallbackClientContext(context.fallback) };
  }

  return clientContext as EveClientContext;
}

/**
 * The fallback envelope as the plain JSON eve will serialize.
 *
 * Written out field by field rather than spread, for the reason
 * `fallbackContextPayload()` in `@internal/workflow` is: `FallbackContext` is
 * an interface with no index signature, so building the object explicitly makes
 * this a conversion rather than an assertion. It also means a field added to
 * the envelope does not silently start reaching a model.
 */
function fallbackClientContext(fallback: FallbackContext): Record<string, unknown> {
  return {
    reason: fallback.reason,
    detail: fallback.detail,
    nodeId: fallback.nodeId,
    workflow: {
      id: fallback.workflow.id,
      version: fallback.workflow.version,
      fingerprint: fallback.workflow.fingerprint,
    },
    completedNodes: fallback.completedNodes.map((node) => ({
      nodeId: node.nodeId,
      outputRef: node.outputRef,
      trusted: node.trusted,
      // The evidence itself, not only a pointer to it (M5-T6, ADR-0044). A
      // model cannot dereference `node:research`, so an envelope of references
      // alone would tell the agent that work had been done and leave it no way
      // to use it. `null` means the value was dropped to fit the envelope's
      // size budget, and `detail` says which.
      output: node.output,
    })),
    evidenceRefs: [...fallback.evidenceRefs],
    remainingBudget: { ...fallback.remainingBudget },
  };
}

function clientOptions(options: EveAgentRuntimeOptions): ConstructorParameters<typeof Client>[0] {
  const credentialBearing = options.auth !== undefined || options.headers !== undefined;

  return {
    // Checked by the constructor before this runs.
    host: options.host ?? "",
    ...(options.auth === undefined ? {} : { auth: options.auth }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.redirect === undefined
      ? credentialBearing
        ? { redirect: "manual" as const }
        : {}
      : { redirect: options.redirect }),
  };
}
