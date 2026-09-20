import { type Storage, StorageError, type TraceEvent } from "@internal/core";
import { createRedactor, DEFAULT_REDACTION_POLICY, type RedactionPolicy } from "./redaction.js";
import type { TraceSink } from "./sink.js";

/**
 * A {@link TraceSink} that drains a run's events into a {@link Storage}
 * (M2-T5).
 *
 * This is the one piece that joins the two halves of Milestone 2: the trace
 * writer chain, which owns ordering, buffering and retry, and the storage port,
 * which owns durability. It is a **sink** rather than a second writer on
 * purpose, so that the chain an application assembles stays
 *
 *     TraceRecorder -> redacting writer -> buffered writer -> storage sink
 *
 * and everything the buffered writer already guarantees — append order is write
 * order, a failed batch stays buffered and is retried in the same order, a sink
 * failure becomes a `StorageError` the run reports rather than swallows — keeps
 * applying with no second implementation of any of it.
 *
 * It lives in `@internal/trace` rather than in `@internal/storage-supabase`
 * because it is about the *port*, not about Supabase: any `Storage` works, and
 * the in-memory one in `@internal/testing` is what the unit tests use. The
 * package depends on `@internal/core` and Node built-ins only, which is still
 * true: `Storage` is a core type.
 *
 * ## Redaction here is belt and braces
 *
 * ADR-0035 places redaction above the buffer, so a properly assembled chain has
 * already redacted everything that reaches this sink. It redacts again anyway,
 * for the reason that ADR gives for the policy existing at all: this is the
 * last code that runs before a trace event becomes durable, and "redact before
 * persistence" is worth more as a structural property than as a fact about how
 * a caller happened to build their chain. Redaction is idempotent — a
 * `[REDACTED:…]` token matches no secret pattern and a field-path rule replaces
 * it with the identical token — so the second pass changes nothing when the
 * first one ran, and is the only pass when it did not.
 */

/** What {@link createStorageTraceSink} accepts. */
export interface CreateStorageTraceSinkOptions {
  /** Where events are persisted. */
  readonly storage: Storage;
  /**
   * The redaction policy applied on the way in. Defaults to
   * {@link DEFAULT_REDACTION_POLICY}.
   *
   * Pass the **same** policy the chain's redacting writer uses. Two different
   * policies would not be unsafe, since applying both is strictly more
   * redaction than either, but a token naming a rule the reader cannot find in
   * the policy they know about is a confusing thing to meet in stored evidence.
   */
  readonly policy?: RedactionPolicy;
  /**
   * Redact here as well as in the writer chain. Defaults to `true`.
   *
   * Set it to `false` only when the events reaching this sink are known to be
   * redacted already **and** the double pass has been measured to matter. It
   * exists so that turning the second pass off is a deliberate, visible act
   * rather than something achieved by assembling the chain differently.
   */
  readonly redact?: boolean;
}

/**
 * Create a {@link TraceSink} over a {@link Storage}.
 *
 * ```ts
 * const harness = createHarness({
 *   agentRuntime,
 *   storage,
 *   trace: createRedactingTraceWriter({
 *     writer: createBufferedTraceWriter({
 *       sink: createStorageTraceSink({ storage }),
 *     }),
 *   }),
 * });
 * ```
 *
 * The same `Storage` instance is normally passed to both `createHarness` and
 * this sink: the ledger row and the trace belong to one run and there is no
 * reason for them to be in different places.
 *
 * An empty batch resolves without touching storage, because a write of nothing
 * is not a write and a round trip for it is waste the buffered writer should
 * not be charged for.
 */
export function createStorageTraceSink(options: CreateStorageTraceSinkOptions): TraceSink {
  const { storage } = options;
  const policy = options.policy ?? DEFAULT_REDACTION_POLICY;
  const redactor = createRedactor(policy);
  const redact = options.redact ?? true;

  return {
    async write(events: readonly TraceEvent[]): Promise<void> {
      if (events.length === 0) {
        return;
      }

      const batch = redact ? redactor.redactEvents(events) : events;

      try {
        await storage.appendTraceEvents(batch);
      } catch (cause) {
        // The port already promises a `StorageError`, and the buffered writer
        // already wraps a rejection in one. Wrapping here too costs nothing and
        // means the sink keeps its own side of the `TraceSink` contract ("reject
        // on failure, never swallow") whoever is holding it, including a caller
        // that uses this sink without a buffered writer above it.
        if (cause instanceof StorageError) {
          throw cause;
        }

        throw new StorageError("storage trace sink: appending the batch failed", {
          cause,
          details: {
            events: batch.length,
            // Identity only, so the failure is diagnosable without the batch's
            // contents reaching an error message.
            runId: batch[0]?.runId ?? null,
            firstSequence: batch[0]?.sequence ?? null,
            lastSequence: batch.at(-1)?.sequence ?? null,
          },
        });
      }
    },
  };
}
