import type { JsonObject } from "./json.js";

/**
 * The minimal M1 trace event.
 *
 * **M2-T3 owns the full schema and will replace this shape.** The build plan
 * requires every event to additionally carry an event ID, a parent span, a
 * node reference, an event version, a behavior fingerprint, usage, latency and
 * error metadata, and to draw `type` from a closed taxonomy
 * (`run.started`, `agent.completed`, `tool.failed`, and so on). None of that
 * is defined here, because M1 has no execution to fingerprint and inventing
 * the fields now would make a guess look like a contract.
 *
 * What M1 does need is a type that `ExecutionContext.trace` can be declared
 * against so M1-T3 through M1-T6 can write and fake trace calls. These five
 * fields are the subset the build plan already fixes and that M2 will keep:
 * an event belongs to a run, has a position in that run's order, happened at a
 * known instant, has a type, and carries a payload that JSON can represent.
 */
export interface TraceEvent {
  /** The run this event belongs to. */
  readonly runId: string;
  /**
   * The event's position in the run's append order, starting at 0. Ordering is
   * carried by this field rather than by the timestamp, because a buffered
   * writer (M2-T4) must preserve order independently of clock resolution.
   */
  readonly sequence: number;
  /** The instant the event happened, as an ISO 8601 string. */
  readonly timestamp: string;
  /**
   * The event type. M2-T3 narrows this to the closed taxonomy in the build
   * plan; in M1 it is an open string so that nothing has to pretend the
   * taxonomy is settled.
   */
  readonly type: string;
  /**
   * The event body. Redaction of secrets before persistence is M2-T9's
   * responsibility, not this type's; `JsonObject` only guarantees the payload
   * is serializable.
   */
  readonly payload: JsonObject;
}

/**
 * The sink an execution appends trace events to.
 *
 * This is the interface the build plan states verbatim in M2-T4. It is
 * declared in M1 because {@link ExecutionContext} must hold a trace writer
 * before any writer implementation exists. The buffered, order-preserving
 * local implementation is M2-T4's work and lives in `packages/trace`.
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
 * yet, can build an {@link ExecutionContext} without a trace package. It is
 * not a test double: it records nothing, so it cannot be asserted against. The
 * recording counterpart is `createRecordingTraceWriter()` in
 * `@internal/testing`, added by M1-T4.
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
