import { StorageError, type TraceEvent, type TraceWriter, ValidationError } from "@internal/core";
import type { TraceSink } from "./sink.js";

/**
 * The buffered, order-preserving local trace writer (M2-T4).
 *
 * The build plan's whole instruction is "use a buffered writer locally but
 * preserve event order". Everything below is what that sentence turns into once
 * it has to be true under concurrency and under failure; ADR-0031 records the
 * choices.
 */

/**
 * How many events accumulate before {@link createBufferedTraceWriter} flushes
 * on its own.
 *
 * Buffering exists so a run does not pay a round trip per event. An *unbounded*
 * buffer would instead hold an entire long run in memory and lose all of it if
 * the process died, which is the opposite of what a durable trace is for. 256
 * is the compromise: large enough that an ordinary run flushes once, at the
 * end, and small enough that a runaway loop's trace reaches the sink while it
 * is still running.
 */
export const DEFAULT_MAX_BUFFERED_EVENTS = 256;

/** What {@link createBufferedTraceWriter} accepts. */
export interface CreateBufferedTraceWriterOptions {
  /** Where flushed events go. */
  readonly sink: TraceSink;
  /**
   * How many buffered events trigger an automatic flush.
   *
   * `append` **does** auto-flush at this threshold, and awaits it, so the
   * caller feels the back-pressure rather than growing the buffer behind it.
   * Defaults to {@link DEFAULT_MAX_BUFFERED_EVENTS}.
   */
  readonly maxBufferedEvents?: number;
}

/** A {@link TraceWriter} that batches appends and drains them in order. */
export interface BufferedTraceWriter extends TraceWriter {
  /**
   * How many events are waiting to be written.
   *
   * Non-zero after a failed flush, because a batch the sink rejected stays
   * buffered rather than being dropped.
   */
  readonly bufferedEvents: number;
}

/**
 * Create a {@link BufferedTraceWriter} over a {@link TraceSink}.
 *
 * ```ts
 * const writer = createBufferedTraceWriter({
 *   sink: createJsonlFileTraceSink(".harness/traces/run.jsonl"),
 * });
 * const harness = createHarness({ agentRuntime, trace: writer });
 * ```
 *
 * The four guarantees, and what each one costs:
 *
 * 1. **Append order is write order.** Events are enqueued and drained
 *    first-in-first-out, and nothing sorts or regroups them. A reader of the
 *    sink sees a run's events in the order the recorder stamped them.
 * 2. **Concurrent flushes serialize.** A `flush()` issued while another is in
 *    flight waits for it and then drains whatever is left, rather than racing
 *    it and interleaving two batches into the same sink. Every caller still
 *    gets its own outcome.
 * 3. **A sink failure is a {@link StorageError}, and the events stay
 *    buffered.** The cause is preserved. Nothing is dropped, so a later flush
 *    retries the same events in the same order, and a caller that gives up
 *    still knows how many were lost from `details.bufferedEvents`. This is what
 *    makes M2's "storage failures cannot silently turn into successful runs"
 *    enforceable: `createHarness()` awaits `flush()` in its terminal step and
 *    lets the error out of `harness.run()`.
 * 4. **Events appended during a flush are not stranded.** The drain loop keeps
 *    going until the buffer is empty, so an event that arrives while the sink
 *    is mid-write is written by the same flush rather than waiting for the
 *    next one.
 *
 * @throws {ValidationError} if `maxBufferedEvents` is not an integer of at
 * least 1. A threshold of 0 would flush before anything was buffered and a
 * fractional one would never be reached exactly.
 */
export function createBufferedTraceWriter(
  options: CreateBufferedTraceWriterOptions,
): BufferedTraceWriter {
  const { sink } = options;
  const maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;

  if (!Number.isInteger(maxBufferedEvents) || maxBufferedEvents < 1) {
    throw new ValidationError(
      "createBufferedTraceWriter: `maxBufferedEvents` must be an integer >= 1",
      {
        issues: [
          {
            path: ["maxBufferedEvents"],
            message: `expected an integer >= 1, received ${String(maxBufferedEvents)}`,
          },
        ],
      },
    );
  }

  const buffer: TraceEvent[] = [];
  // The flush queue. Kept resolved after every attempt, so a rejected flush
  // does not poison the flushes that follow it.
  let tail: Promise<void> = Promise.resolve();

  async function drain(): Promise<void> {
    while (buffer.length > 0) {
      // A snapshot, not a splice: the events are removed only once the sink has
      // accepted them, so a rejection leaves the buffer exactly as it was.
      const batch = buffer.slice();

      try {
        await sink.write(batch);
      } catch (cause) {
        throw new StorageError("the trace sink rejected a batch of events", {
          cause,
          details: { batchSize: batch.length, bufferedEvents: buffer.length },
        });
      }

      // Appends only ever push, so the batch is still the head of the buffer.
      buffer.splice(0, batch.length);
    }
  }

  function flush(): Promise<void> {
    const drained = tail.then(drain, drain);

    tail = drained.then(
      () => undefined,
      () => undefined,
    );

    return drained;
  }

  return {
    get bufferedEvents(): number {
      return buffer.length;
    },
    async append(event: TraceEvent): Promise<void> {
      buffer.push(event);

      if (buffer.length >= maxBufferedEvents) {
        await flush();
      }
    },
    flush,
  };
}
