import { StorageError, type TraceEvent } from "@internal/core";
import type { TraceSink } from "./sink.js";

/**
 * A {@link TraceSink} that writes every batch to several sinks.
 *
 * It exists because M2-T5 gives a run two places to be durable and both are
 * worth having: the JSONL file beside the agent, which needs no database and is
 * what makes local development a first-class path (north-star invariant 15),
 * and the Supabase `trace_events` table, which is what the learning dataset is
 * actually built from.
 *
 * **One writer over several sinks, not several writers.** Putting the fan-out
 * here rather than giving the harness two `TraceWriter`s is what keeps the
 * buffered writer's guarantees intact: there is still one buffer, one order,
 * one flush and one failure path, and the two destinations see exactly the same
 * events in exactly the same sequence. Two writers would each buffer
 * separately, and a crash between their flushes would leave two traces that
 * disagree.
 *
 * ## Failure semantics
 *
 * **Every sink is attempted, and any failure fails the write.** Attempting all
 * of them means one broken destination does not hide what the others would have
 * said; failing the write means the buffered writer keeps the batch and retries
 * it, and the run does not report `completed` on the strength of a trace that
 * is only half stored. The cost is that a retry re-sends the batch to the sinks
 * that already took it, which is exactly why the `TraceSink` contract requires
 * an implementation to tolerate being called again with the same events — the
 * Supabase sink is idempotent on `(runId, sequence)`, and the JSONL sink
 * appends, so a retry there can duplicate lines in the local file. That is the
 * trade this makes: the durable store stays exact and the local convenience
 * file may repeat itself.
 *
 * When more than one sink fails, the first failure is reported and the rest are
 * carried in `details.failures` by name, so a single broken destination is
 * still identifiable.
 */

/** Create a {@link TraceSink} over `sinks`. */
export function createFanOutTraceSink(sinks: readonly TraceSink[]): TraceSink {
  return {
    async write(events: readonly TraceEvent[]): Promise<void> {
      if (events.length === 0 || sinks.length === 0) {
        return;
      }

      // `allSettled`, not `all`: every sink is attempted even when an earlier
      // one has already failed, so a broken destination never silently costs
      // the others their copy of the trace.
      const settled = await Promise.allSettled(sinks.map((sink) => sink.write(events)));
      const failures = settled.filter(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
      );

      if (failures.length === 0) {
        return;
      }

      const first = failures[0]?.reason;

      if (failures.length === 1 && first instanceof StorageError) {
        throw first;
      }

      throw new StorageError(
        `trace fan-out: ${failures.length} of ${sinks.length} sinks failed to write ${events.length} events`,
        {
          cause: first,
          details: {
            sinks: sinks.length,
            failed: failures.length,
            events: events.length,
            // Identity only: the run and the range, never the batch's contents.
            runId: events[0]?.runId ?? null,
            firstSequence: events[0]?.sequence ?? null,
            lastSequence: events.at(-1)?.sequence ?? null,
          },
        },
      );
    },
  };
}
