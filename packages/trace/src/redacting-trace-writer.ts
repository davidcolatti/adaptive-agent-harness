import type { TraceEvent, TraceWriter } from "@internal/core";
import {
  createRedactor,
  DEFAULT_REDACTION_POLICY,
  type RedactionPolicy,
  type Redactor,
} from "./redaction.js";

/**
 * The {@link TraceWriter} decorator that makes "redact before persistence"
 * (M2-T9) structural rather than a convention. **ADR-0035** records it.
 *
 * The chain an application assembles is:
 *
 * ```text
 * TraceRecorder  ->  redacting writer  ->  buffered writer  ->  TraceSink
 * ```
 *
 * Redaction sits **above the buffer**, which is the whole point of putting it
 * in a writer rather than in a sink. An unredacted event that reached the
 * buffer would already be sitting in process memory in the clear, would be
 * retried from there after a sink failure, and would be written unredacted by
 * any sink added later that forgot to redact. Above the buffer there is exactly
 * one place to get it right, and every sink behind it inherits the guarantee.
 *
 * It sits **below the recorder** for the opposite reason: the recorder owns
 * identity and order (ADR-0031), and a redactor that ran inside it would be
 * mixing "what happened" with "what may be stored". The recorder's event is the
 * truth; this is the projection of it that is safe to keep.
 */

/** A {@link TraceWriter} that redacts every event before delegating. */
export interface RedactingTraceWriter extends TraceWriter {
  /** The redactor it applies, exposed so a caller can inspect the policy. */
  readonly redactor: Redactor;
}

/** What {@link createRedactingTraceWriter} accepts. */
export interface CreateRedactingTraceWriterOptions {
  /** The writer that receives redacted events. */
  readonly writer: TraceWriter;
  /**
   * The rules to apply. Defaults to {@link DEFAULT_REDACTION_POLICY}, so the
   * safe thing is what a caller gets for writing nothing.
   */
  readonly policy?: RedactionPolicy;
}

/**
 * Create a {@link RedactingTraceWriter}.
 *
 * ```ts
 * const harness = createHarness({
 *   agentRuntime,
 *   trace: createRedactingTraceWriter({
 *     writer: createBufferedTraceWriter({ sink: createJsonlDirectoryTraceSink(dir) }),
 *   }),
 * });
 * ```
 *
 * `append` redacts and delegates; `flush` delegates unchanged, because a
 * decorator that buffered would duplicate the guarantee underneath it. Whatever
 * the inner writer rejects with reaches the caller untouched, so a `StorageError`
 * still leaves `harness.run()` and a failed persistence still fails the run.
 *
 * @throws {ValidationError} at construction if a pattern in `policy` lacks the
 * `g` flag. Failing here rather than on the first event means a misconfigured
 * policy cannot be discovered halfway through a run.
 */
export function createRedactingTraceWriter(
  options: CreateRedactingTraceWriterOptions,
): RedactingTraceWriter {
  const { writer } = options;
  const redactor = createRedactor(options.policy ?? DEFAULT_REDACTION_POLICY);

  return {
    redactor,
    append(event: TraceEvent): Promise<void> {
      return writer.append(redactor.redactEvent(event));
    },
    flush(): Promise<void> {
      return writer.flush();
    },
  };
}
