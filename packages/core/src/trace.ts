import type { SerializedHarnessError } from "./errors.js";
import { ValidationError } from "./errors.js";
import { newTraceEventId, type RunId, type TraceEventId } from "./ids.js";
import type { JsonObject } from "./json.js";

/**
 * The trace contract (M2-T3) and the run-scoped recorder that mints its events
 * (the M2-T3/M2-T4 joint decision). **ADR-0031** records both.
 *
 * AD-010 is the reason this file is as detailed as it is: "the trace is not
 * debug logging". Every behavior-affecting event needed for replay, evaluation,
 * lineage, cost analysis or model-risk analysis has to be captured as
 * structured data from the first working run, so the shape below is a contract
 * rather than a logging convenience.
 *
 * Three rules shape it.
 *
 * 1. **The taxonomy is closed.** {@link TraceEventType} is a union, not a
 *    string, so a reader can switch on it exhaustively and M2-T5's database
 *    column has a fixed domain. An adapter that observes something with no
 *    counterpart does not widen the taxonomy; it records nothing and says so.
 * 2. **One run has one total order.** {@link TraceRecorder} is the single owner
 *    of `sequence` for a run, so harness events and adapter events interleave
 *    in one strictly increasing sequence instead of each counting from 0. That
 *    was the M1 defect this task exists to fix.
 * 3. **The payload is identity-only.** No message content, no tool arguments,
 *    no tool results, no model output. M2-T9 owns redaction and must not find
 *    content already leaking into a trace written before it existed.
 */

/**
 * The closed set of trace event types.
 *
 * These are the build plan's M2-T3 list verbatim, in its order, **plus
 * `run.aborted`**. The addition is not a liberty: `createHarness()` already
 * emits it, a run stopped by its caller's signal is neither a completion nor a
 * failure, and forcing it into `run.failed` would make "a failed run remains
 * inspectable" report cancellations as defects. ADR-0031 records the amendment.
 *
 * Exported as a runtime constant as well as a type so that a reader, a
 * validator and M2-T5's database check constraint can share one list instead of
 * three copies that drift.
 */
export const TRACE_EVENT_TYPES = [
  "run.started",
  "run.completed",
  "run.failed",
  "run.aborted",

  "agent.started",
  "agent.completed",
  "agent.failed",

  "model.started",
  "model.completed",
  "model.failed",

  "tool.started",
  "tool.completed",
  "tool.failed",

  "decision.started",
  "decision.completed",
  "decision.failed",

  "node.started",
  "node.completed",
  "node.failed",

  "artifact.created",

  "approval.requested",
  "approval.resolved",

  "fallback.started",
  "fallback.completed",

  "eval.completed",
] as const;

/** One of {@link TRACE_EVENT_TYPES}. */
export type TraceEventType = (typeof TRACE_EVENT_TYPES)[number];

const TRACE_EVENT_TYPE_SET: ReadonlySet<string> = new Set<string>(TRACE_EVENT_TYPES);

/**
 * True when `value` is a member of the closed taxonomy.
 *
 * The runtime half of {@link TraceEventType}, for the boundary where an event
 * arrives as data rather than as a literal: a database row, a JSONL line, a
 * caller that is not typed against this package.
 */
export function isTraceEventType(value: unknown): value is TraceEventType {
  return typeof value === "string" && TRACE_EVENT_TYPE_SET.has(value);
}

/**
 * The version of the event schema this module defines.
 *
 * A literal on every event, so a reader of a stored trace can tell which shape
 * it is looking at without consulting the code that wrote it. It changes only
 * when a field is added, removed or reinterpreted; a new *event type* is not a
 * schema change, because the taxonomy is data on the event rather than part of
 * its shape.
 */
export const TRACE_EVENT_VERSION = 1;

/** The type of {@link TRACE_EVENT_VERSION}. */
export type TraceEventVersion = typeof TRACE_EVENT_VERSION;

/**
 * What one event's work consumed.
 *
 * Every field is optional and **absent is not zero**: a mock model reports no
 * cost, a direct provider reports no cache tokens, and recording `0` for either
 * would turn "unknown" into a measurement. The fields are exactly the union of
 * what the harness already knows (`AgentExecutionUsage`: model calls, tool
 * calls, cost) and what `eve` reports per step
 * (`StepCompletedStreamEvent.usage`: cost and four token counts). Nothing is
 * invented ahead of a producer for it.
 *
 * Usage is per event, not cumulative: a `model.completed` carries that model
 * call's tokens, and `run.completed` carries the run's totals. Summing a run's
 * `model.*` events and reading its `run.completed` are two routes to the same
 * figure, which is what makes a stored trace auditable.
 */
export type TraceEventUsage = {
  /** Model calls attributable to this event. */
  readonly modelCalls?: number;
  /** Tool calls attributable to this event. */
  readonly toolCalls?: number;
  /** Prompt tokens sent. */
  readonly inputTokens?: number;
  /** Completion tokens received. */
  readonly outputTokens?: number;
  /** Prompt tokens served from the provider's cache. */
  readonly cacheReadTokens?: number;
  /** Prompt tokens written to the provider's cache. */
  readonly cacheWriteTokens?: number;
  /** Spend in US dollars, when the producer knows it. */
  readonly costUsd?: number;
};

/**
 * One append-only trace event.
 *
 * This is the build plan's "every event contains" list, made concrete. It is
 * declared as a type alias rather than an interface deliberately: that gives it
 * an implicit index signature, so a `TraceEvent` is assignable to
 * {@link JsonObject} and can be canonicalized, written as a JSONL line or
 * stored as JSONB with no conversion step. {@link SerializedHarnessError} is a
 * type alias for the same reason (ADR-0026).
 *
 * Nothing constructs one of these by hand. {@link TraceRecorder.record} stamps
 * the six fields a caller must not choose (`id`, `runId`, `attempt`,
 * `sequence`, `version`, `behaviorFingerprint`), which is what makes the
 * ordering and identity guarantees below true rather than hoped for.
 */
export type TraceEvent = {
  /**
   * This event's identity: a sortable UUIDv7 (ADR-0030).
   *
   * Sortable, so it doubles as a global cursor over the whole trace table
   * without a composite key, and unique, so a `parentId` can point at it.
   */
  readonly id: TraceEventId;
  /** The run this event belongs to. */
  readonly runId: RunId;
  /**
   * Which attempt of the run produced it, counting from 1.
   *
   * A **number, matching `ExecutionContext.attempt`, not an `AttemptId`.**
   * ADR-0030 defined an `AttemptId` brand; where an attempt becomes a row with
   * an id of its own is M2-T5's decision (the run ledger), and putting a
   * foreign key on this type before the table exists would be a guess. The
   * ordinal is what "retrying creates a new attempt, not duplicate events"
   * needs today.
   */
  readonly attempt: number;
  /**
   * The event's position in the run's total order, starting at 0 and strictly
   * increasing.
   *
   * **Run-scoped and single-owner.** Ordering is carried here rather than by
   * `timestamp` because a buffered writer must preserve order independently of
   * clock resolution, and because adapter events are timestamped by the
   * framework that produced them rather than by the harness clock.
   */
  readonly sequence: number;
  /** When it happened, as an ISO 8601 string. */
  readonly timestamp: string;
  /** What happened, from the closed taxonomy. */
  readonly type: TraceEventType;
  /**
   * The enclosing span, or `null` for a root.
   *
   * A span is not a separate entity: **a `*.started` event's `id` is its span
   * id**, which is why no `spanId` field exists. The rules are:
   *
   * - a `*.completed` or `*.failed` event points at its own `*.started` event;
   * - a `model.*` or `tool.*` event points at the enclosing `agent.started`;
   * - every `run.*` event is a root and has `null`, because a run is already
   *   identified by `runId` and needs no pointer to itself.
   */
  readonly parentId: TraceEventId | null;
  /**
   * The workflow node this event belongs to, or `null` when none does.
   *
   * **Always `null` until M4**, which is when workflow nodes start executing.
   * It is typed and written now so that the schema, the JSONL line and M2-T5's
   * column do not change when M4 fills it.
   */
  readonly node: string | null;
  /** The event schema version. Always {@link TRACE_EVENT_VERSION}. */
  readonly version: TraceEventVersion;
  /**
   * The `sha256:` fingerprint of the behavior that produced the run, or `null`.
   *
   * **M2-T8 fills this**, by hashing the canonicalized behavior-affecting
   * inputs (instructions, SOP, skills, tool definitions, model configuration,
   * schemas, thresholds). Until then the harness passes `null`. A fabricated
   * value would be worse than an absent one: north-star invariant 4 is that
   * every behavior-affecting version is fingerprinted, and a fingerprint that
   * does not track behavior silently breaks every comparison built on it.
   */
  readonly behaviorFingerprint: string | null;
  /**
   * The sanitized body.
   *
   * **Identity-only, by rule.** What belongs here is the shape of the run: ids,
   * names, counts, statuses, codes, model ids, tool ids. What never belongs
   * here is its content: message text, reasoning, tool arguments, tool results,
   * model output, or anything read out of a job's input. M2-T9 owns redaction
   * and its sanitizers are the safety net, not the boundary; a payload that
   * needs redacting should not have been written.
   */
  readonly payload: JsonObject;
  /** What this event's work consumed, or `null` when nothing is known. */
  readonly usage: TraceEventUsage | null;
  /**
   * How long the work this event closes took, in milliseconds, or `null`.
   *
   * Meaningful on a terminal event (`*.completed`, `*.failed`, `run.aborted`),
   * where it measures the span back to its `*.started`. A `*.started` event
   * carries `null`, because nothing has elapsed yet.
   */
  readonly latencyMs: number | null;
  /**
   * Why it failed, already in ADR-0026's trace-safe form, or `null`.
   *
   * Only a `*.failed` event carries one. It is a {@link SerializedHarnessError}
   * and never a raw `Error`: a stack leaks absolute paths and module structure
   * into everything the trace is shown to, and an arbitrary throwable does not
   * serialize predictably.
   */
  readonly error: SerializedHarnessError | null;
};

/**
 * The sink an execution appends trace events to.
 *
 * This is the interface the build plan states verbatim in M2-T4, unchanged. A
 * writer is a sink for **complete** events: it never mints an id, never
 * assigns a sequence and never reorders. The buffered, order-preserving local
 * implementation is `createBufferedTraceWriter()` in `@internal/trace`.
 */
export interface TraceWriter {
  /** Append one event. Implementations must preserve append order. */
  append(event: TraceEvent): Promise<void>;
  /** Flush anything buffered. Safe to call more than once. */
  flush(): Promise<void>;
}

/**
 * A {@link TraceWriter} that discards every event.
 *
 * It exists so a unit test, or a caller that genuinely has nowhere to write
 * yet, can build an `ExecutionContext` without a trace package. It is not a
 * test double: it records nothing, so it cannot be asserted against. The
 * recording counterpart is `createRecordingTraceWriter()` in
 * `@internal/testing`; the real one is `createBufferedTraceWriter()` in
 * `@internal/trace`.
 */
export function createNoopTraceWriter(): TraceWriter {
  return {
    append(): Promise<void> {
      return Promise.resolve();
    },
    flush(): Promise<void> {
      return Promise.resolve();
    },
  };
}

/**
 * A source of the current time.
 *
 * The one method a recorder needs, declared here rather than imported from
 * `harness.ts` so that the trace module stands on its own and so that
 * `createFakeClock()` in `@internal/testing` satisfies it structurally with no
 * adapter. `Clock` in `harness.ts` and `EveClock` in `@internal/runtime-eve`
 * are the same shape for the same reason.
 */
export interface TraceClock {
  /** The current instant. */
  now(): Date;
}

const SYSTEM_CLOCK: TraceClock = {
  now(): Date {
    return new Date();
  },
};

/**
 * What a caller supplies to {@link TraceRecorder.record}: the event minus
 * everything the recorder owns.
 *
 * The six fields that are absent here — `id`, `runId`, `attempt`, `sequence`,
 * `version` and `behaviorFingerprint` — are absent on purpose. They are the
 * run's identity and its order, and a caller that could set them could break
 * both.
 */
export type TraceEventInput = {
  /** What happened. */
  readonly type: TraceEventType;
  /** The identity-only body. Defaults to `{}`. */
  readonly payload?: JsonObject;
  /** The enclosing span. Defaults to `null`, a root. */
  readonly parentId?: TraceEventId | null;
  /** The workflow node. Defaults to `null`; M4 is what fills it. */
  readonly node?: string | null;
  /**
   * When it happened, as an ISO 8601 string. Defaults to the recorder's clock.
   *
   * Supplied by an adapter that has a better answer than the harness clock:
   * `EveAgentRuntime` passes `event.meta.at`, the instant eve stamped on the
   * stream event, so the trace reports when the framework saw something rather
   * than when the adapter got round to reading it.
   */
  readonly timestamp?: string;
  /** What this event's work consumed. Defaults to `null`. */
  readonly usage?: TraceEventUsage | null;
  /** How long it took. Defaults to `null`. */
  readonly latencyMs?: number | null;
  /** Why it failed. Defaults to `null`. Only a `*.failed` event carries one. */
  readonly error?: SerializedHarnessError | null;
};

/** What {@link TraceSpan.end} accepts: a {@link TraceEventInput} whose parent is fixed. */
export type TraceSpanEndInput = Omit<TraceEventInput, "parentId">;

/**
 * An open span: a `*.started` event that something later closes.
 *
 * The span *is* its start event, so there is no separate span id to manage and
 * nothing to leak if a caller forgets to close one. What this adds over calling
 * {@link TraceRecorder.record} twice is that {@link TraceSpan.end} sets
 * `parentId` and measures `latencyMs` for you, which is exactly the bookkeeping
 * an adapter would otherwise repeat at every call site and occasionally get
 * wrong.
 */
export interface TraceSpan {
  /** The span's id: its `*.started` event's id, and the `parentId` of its children. */
  readonly id: TraceEventId;
  /** The `*.started` event itself. */
  readonly event: TraceEvent;
  /**
   * Record this span's terminal event.
   *
   * `parentId` is this span. `latencyMs` is measured from the span's
   * `timestamp` to the terminal event's, unless the caller supplies one; a
   * timestamp that cannot be parsed, or that runs backwards, yields `null`
   * rather than a negative or `NaN` duration.
   */
  end(input: TraceSpanEndInput): Promise<TraceEvent>;
}

/**
 * The run-scoped minter of trace events: **the single owner of `sequence`**.
 *
 * This type is the answer to the M1 defect the M2 status file names first: the
 * harness numbered its `run.*` events from 0 and the eve adapter numbered its
 * events from 0 again, so a run's events collided and no total order existed.
 * A recorder is created once per run, handed to the harness and to the adapter
 * through `ExecutionContext.trace`, and every event either of them records goes
 * through it. There is exactly one counter, so there is exactly one order.
 *
 * It is not a {@link TraceWriter} and does not replace one: a recorder stamps
 * events and a writer persists them. The recorder holds a writer and forwards
 * {@link TraceRecorder.flush} to it.
 */
export interface TraceRecorder {
  /** The run every event is stamped with. */
  readonly runId: RunId;
  /** The attempt every event is stamped with. */
  readonly attempt: number;
  /** The behavior fingerprint every event is stamped with. `null` until M2-T8. */
  readonly behaviorFingerprint: string | null;
  /**
   * The id of this run's `run.started` event, or `null` before one is recorded.
   *
   * The run's root span, captured automatically. An adapter sets it as the
   * `parentId` of its `agent.started` without having to be told what the
   * harness emitted.
   */
  readonly rootId: TraceEventId | null;
  /** The id of the most recently recorded event, or `null` before the first. */
  readonly lastEventId: TraceEventId | null;
  /** How many events have been recorded, which is also the next `sequence`. */
  readonly recorded: number;
  /**
   * Stamp and append one event, and return what was written.
   *
   * `sequence` is assigned synchronously, before anything is awaited, and
   * appends are chained so the writer sees events in sequence order even when
   * two callers record concurrently.
   *
   * @throws {ValidationError} if `type` is not a member of the closed taxonomy.
   * Rejects with whatever the writer rejected with, so a storage failure
   * reaches the caller rather than being swallowed.
   */
  record(input: TraceEventInput): Promise<TraceEvent>;
  /** Record a `*.started` event and return the {@link TraceSpan} that closes it. */
  span(input: TraceEventInput): Promise<TraceSpan>;
  /** Flush the underlying writer. */
  flush(): Promise<void>;
}

/** What {@link createTraceRecorder} accepts. */
export interface CreateTraceRecorderOptions {
  /** The run every event belongs to. */
  readonly runId: RunId;
  /** Where stamped events go. */
  readonly writer: TraceWriter;
  /** Which attempt this is, counting from 1. Defaults to `1`. */
  readonly attempt?: number;
  /** The time source for events that do not supply their own. Defaults to the system clock. */
  readonly clock?: TraceClock;
  /** The run's behavior fingerprint. Defaults to `null`; M2-T8 supplies one. */
  readonly behaviorFingerprint?: string | null;
}

/**
 * Create a {@link TraceRecorder} for one run.
 *
 * ```ts
 * const recorder = createTraceRecorder({ runId, writer });
 * const run = await recorder.record({ type: "run.started", payload: { jobId } });
 * const agent = await recorder.span({ type: "agent.started", parentId: recorder.rootId });
 * await agent.end({ type: "agent.completed", usage: { modelCalls: 2 } });
 * ```
 *
 * @throws {ValidationError} if `attempt` is not an integer of at least 1.
 */
export function createTraceRecorder(options: CreateTraceRecorderOptions): TraceRecorder {
  const { runId, writer } = options;
  const attempt = options.attempt ?? 1;
  const clock = options.clock ?? SYSTEM_CLOCK;
  const behaviorFingerprint = options.behaviorFingerprint ?? null;

  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new ValidationError("createTraceRecorder: `attempt` must be an integer >= 1", {
      issues: [
        { path: ["attempt"], message: `expected an integer >= 1, received ${String(attempt)}` },
      ],
    });
  }

  let sequence = 0;
  let rootId: TraceEventId | null = null;
  let lastEventId: TraceEventId | null = null;
  // Appends are chained rather than raced, so two concurrent `record()` calls
  // still reach the writer in sequence order. The tail is kept resolved: a
  // writer that rejected must not poison every later append.
  let tail: Promise<void> = Promise.resolve();

  function record(input: TraceEventInput): Promise<TraceEvent> {
    if (!isTraceEventType(input.type)) {
      return Promise.reject(
        new ValidationError(
          `createTraceRecorder: \`${String(input.type)}\` is not a trace event type`,
          {
            issues: [
              {
                path: ["type"],
                message: `expected one of ${TRACE_EVENT_TYPES.join(", ")}`,
              },
            ],
          },
        ),
      );
    }

    const event: TraceEvent = Object.freeze({
      id: newTraceEventId(),
      runId,
      attempt,
      sequence: sequence++,
      timestamp: input.timestamp ?? clock.now().toISOString(),
      type: input.type,
      parentId: input.parentId ?? null,
      node: input.node ?? null,
      version: TRACE_EVENT_VERSION,
      behaviorFingerprint,
      payload: input.payload ?? {},
      usage: input.usage ?? null,
      latencyMs: input.latencyMs ?? null,
      error: input.error ?? null,
    });

    if (event.type === "run.started" && rootId === null) {
      rootId = event.id;
    }

    lastEventId = event.id;

    const append = (): Promise<void> => writer.append(event);
    const appended = tail.then(append, append);
    tail = appended.then(
      () => undefined,
      () => undefined,
    );

    return appended.then(() => event);
  }

  async function span(input: TraceEventInput): Promise<TraceSpan> {
    const started = await record(input);
    const startedAt = Date.parse(started.timestamp);

    return {
      id: started.id,
      event: started,
      async end(endInput: TraceSpanEndInput): Promise<TraceEvent> {
        const timestamp = endInput.timestamp ?? clock.now().toISOString();

        return await record({
          ...endInput,
          timestamp,
          parentId: started.id,
          latencyMs: endInput.latencyMs ?? elapsed(startedAt, timestamp),
        });
      },
    };
  }

  return {
    runId,
    attempt,
    behaviorFingerprint,
    get rootId(): TraceEventId | null {
      return rootId;
    },
    get lastEventId(): TraceEventId | null {
      return lastEventId;
    },
    get recorded(): number {
      return sequence;
    },
    record,
    span,
    flush(): Promise<void> {
      return writer.flush();
    },
  };
}

/**
 * Milliseconds between two instants, or `null` when that is not a fact.
 *
 * An unparseable timestamp and a clock that ran backwards both yield `null`
 * rather than `NaN` or a negative number: "not known" is a true statement about
 * a duration and the other two are not.
 */
function elapsed(startedAt: number, endTimestamp: string): number | null {
  const endedAt = Date.parse(endTimestamp);

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) {
    return null;
  }

  return endedAt - startedAt;
}
