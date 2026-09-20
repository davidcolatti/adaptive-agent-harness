// The public surface of `@internal/trace`: the buffered trace writer (M2-T4),
// the redaction layer that sits above it (M2-T9), and the local sinks both
// drain into.
//
// The split this package rests on: `@internal/core` owns the event schema
// (`TraceEvent`), the sink interface a run writes through (`TraceWriter`) and
// the per-run minter that orders events (`TraceRecorder`); this package owns
// *persistence*, and everything that has to happen on the way to it. Core
// therefore stays free of `node:fs` and of any storage decision, and M2-T5's
// Supabase sink slots in here as another `TraceSink` rather than as a second
// writer. ADR-0031 records the writer, ADR-0035 the redaction layer.
//
// The writer chain an application assembles, outermost first:
//
//     TraceRecorder -> redacting writer -> buffered writer -> TraceSink
//
// The package declares no third-party dependency and uses Node built-ins only,
// the same rule `@internal/core` follows. `tests/architecture/boundaries.ts`
// enforces it.
//
// Re-exports are listed by name rather than starred, so a symbol becomes public
// deliberately.

export type {
  BufferedTraceWriter,
  CreateBufferedTraceWriterOptions,
} from "./buffered-trace-writer.js";
export {
  createBufferedTraceWriter,
  DEFAULT_MAX_BUFFERED_EVENTS,
} from "./buffered-trace-writer.js";
export type { JsonlDirectoryTraceSink } from "./jsonl-sink.js";
export { createJsonlDirectoryTraceSink, createJsonlFileTraceSink } from "./jsonl-sink.js";
export type {
  CreateRedactingTraceWriterOptions,
  RedactingTraceWriter,
} from "./redacting-trace-writer.js";
export { createRedactingTraceWriter } from "./redacting-trace-writer.js";
// Secret and sensitive-data redaction (M2-T9; ADR-0035).
export type {
  FieldPathRule,
  RedactionPath,
  RedactionPolicy,
  RedactionPolicyOverrides,
  Redactor,
  ToolSanitizer,
} from "./redaction.js";
export {
  createRedactionPolicy,
  createRedactor,
  DEFAULT_FIELD_PATH_RULES,
  DEFAULT_REDACTED_HEADERS,
  DEFAULT_REDACTION_POLICY,
  HEADER_RULE_NAME,
  REDACTED_VALUE_KEY,
  REDACTION_TOKEN_PREFIX,
  REDACTION_TOKEN_SUFFIX,
  redactEvents,
  redactionToken,
} from "./redaction.js";
export type { SecretPatternRule } from "./secret-patterns.js";
export { DEFAULT_SECRET_PATTERN_RULES } from "./secret-patterns.js";
export type { InMemoryTraceSink, TraceSink } from "./sink.js";
export { createInMemoryTraceSink } from "./sink.js";
