import type { TraceEvent, TraceWriter } from "@internal/core";

/**
 * A {@link TraceWriter} that keeps every event instead of discarding it.
 *
 * `createNoopTraceWriter()` in `@internal/core` exists so that a caller with
 * nowhere to write can still build an `ExecutionContext`; it records nothing,
 * so it cannot be asserted against. This is its counterpart, and it lives here
 * rather than in core for the reason the core module already states: a
 * recording writer is a test double, and test doubles belong in the testing
 * package.
 *
 * The real buffered, order-preserving writer is M2-T4's work and lives in
 * `packages/trace`.
 */

/** A {@link TraceWriter} that exposes what was written to it. */
export interface RecordingTraceWriter extends TraceWriter {
  /** Every appended event, in append order. */
  readonly events: readonly TraceEvent[];
  /** Every appended event's `type`, in append order. */
  types(): readonly string[];
  /** How many times {@link TraceWriter.flush} was called. */
  readonly flushCount: number;
}

/**
 * Create a {@link RecordingTraceWriter}.
 *
 * ```ts
 * const trace = createRecordingTraceWriter();
 * const harness = createHarness({ agentRuntime, trace });
 *
 * await harness.run({ domain, input });
 *
 * expect(trace.types()).toEqual(["run.started", "run.completed"]);
 * expect(trace.flushCount).toBe(1);
 * ```
 *
 * It records `flush` calls as well as events, because "the harness flushed the
 * trace before returning" is a claim a test should be able to check rather than
 * take on trust. It never throws and never drops an event, so a test that sees
 * a missing event is looking at a caller that did not emit it.
 */
export function createRecordingTraceWriter(): RecordingTraceWriter {
  const events: TraceEvent[] = [];
  let flushCount = 0;

  return {
    events,
    types(): readonly string[] {
      return events.map((event) => event.type);
    },
    get flushCount(): number {
      return flushCount;
    },
    append(event: TraceEvent): Promise<void> {
      events.push(event);
      return Promise.resolve();
    },
    flush(): Promise<void> {
      flushCount += 1;
      return Promise.resolve();
    },
  };
}
