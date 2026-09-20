import type { TraceEvent } from "@internal/core";

/**
 * Where a batch of trace events is actually persisted.
 *
 * The build plan states `TraceWriter` (M2-T4) and nothing below it. This
 * interface is the harness-owned split underneath: a **writer** owns buffering,
 * ordering and failure semantics, and a **sink** owns one storage medium and
 * knows nothing about buffering. That is what lets one buffered writer serve a
 * JSONL file today, M2-T5's Supabase table next, and both at once later,
 * without either of them reimplementing the ordering guarantee.
 *
 * The contract for an implementation is small and strict:
 *
 * - **Write the batch in the order given.** A sink never reorders.
 * - **Resolve only when the events are durable**, as durable as the medium
 *   gets. A sink that resolves early makes the writer's guarantee a fiction.
 * - **Reject on failure.** Never swallow: `createBufferedTraceWriter()` turns a
 *   rejection into a `StorageError` and the run reports it, which is M2's
 *   "storage failures cannot silently turn into successful runs".
 * - **Expect to be called again with the same events** after a rejection. The
 *   buffered writer keeps a failed batch and retries it on the next flush, so a
 *   sink whose partial write left events behind should tolerate the repeat.
 */
export interface TraceSink {
  /** Persist one batch, in order. */
  write(events: readonly TraceEvent[]): Promise<void>;
}

/** A {@link TraceSink} that keeps everything it was given, for tests. */
export interface InMemoryTraceSink extends TraceSink {
  /** Every event written, flattened, in write order. */
  readonly events: readonly TraceEvent[];
  /** Each `write` call's batch, so a test can assert on batching itself. */
  readonly batches: readonly (readonly TraceEvent[])[];
}

/**
 * Create an in-memory {@link TraceSink}.
 *
 * It lives in this package rather than in `@internal/testing` because it is
 * what the buffered writer's own tests need, and `@internal/testing` does not
 * depend on `@internal/trace`. It is also genuinely useful outside a test: a
 * caller that wants a run's trace in memory and nowhere else can use it
 * directly.
 */
export function createInMemoryTraceSink(): InMemoryTraceSink {
  const events: TraceEvent[] = [];
  const batches: (readonly TraceEvent[])[] = [];

  return {
    events,
    batches,
    write(batch: readonly TraceEvent[]): Promise<void> {
      batches.push([...batch]);
      events.push(...batch);
      return Promise.resolve();
    },
  };
}
