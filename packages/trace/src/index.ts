// The public surface of `@internal/trace`: the buffered trace writer (M2-T4)
// and the local sinks it drains into.
//
// The split this package rests on: `@internal/core` owns the event schema
// (`TraceEvent`), the sink interface a run writes through (`TraceWriter`) and
// the per-run minter that orders events (`TraceRecorder`); this package owns
// *persistence*. Core therefore stays free of `node:fs` and of any storage
// decision, and M2-T5's Supabase sink slots in here as another `TraceSink`
// rather than as a second writer. ADR-0031 records it.
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
export type { InMemoryTraceSink, TraceSink } from "./sink.js";
export { createInMemoryTraceSink } from "./sink.js";
