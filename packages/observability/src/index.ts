// The public surface of `@internal/observability`: the local run inspector
// (M2-T10) and the plain-text renderer that fronts it.
//
// The build plan's section 4 layout names `packages/observability/`; this is
// it, opened by the first thing that needs it. What it holds is the read side
// of everything Milestone 2 built: a run's job, route, timeline, calls, errors,
// result, cost and fingerprints, gathered from the `Storage` port or from a
// JSONL trace file and nothing else. ADR-0037 records the design.
//
// **This surface knows nothing about Supabase.** `inspectRun()` takes the
// `Storage` port, so the in-memory implementation in `@internal/testing` and
// the Supabase one are equally valid sources, and a trace-only JSONL file is a
// third. The one module that turns environment variables into a concrete store
// is `src/cli.ts`, which only `src/bin/harness.ts` imports, so the database
// stays behind the declared adapter (AGENTS.md, "No direct database access
// outside `packages/storage-supabase`") and importing this package never drags
// a database client in.
//
// The CLI is deliberately absent from this list. It is a binary, reached
// through the package's `bin` field and the root `pnpm harness` script, not a
// library anyone links against.
//
// Re-exports are listed by name rather than starred, so a symbol becomes public
// deliberately.

export type {
  CallGroup,
  CallRow,
  CallsInspection,
  CostInspection,
  FingerprintInspection,
  InspectedError,
  InspectRunOptions,
  ResultInspection,
  RouteInspection,
  RunAvailability,
  RunInspection,
  RunInspectionSource,
  RunInspectionSourceKind,
  TimelineEntry,
  TokenTotals,
  TraceOnlySource,
} from "./inspect-run.js";
export { inspectRun } from "./inspect-run.js";
// The credential-free source: a `.harness/traces/<runId>.jsonl` file, so a run
// is inspectable with no database at all (north-star invariant 15).
export { createJsonlTraceSource } from "./jsonl-trace-source.js";
export type { RenderRunInspectionOptions } from "./render.js";
export { renderRunInspection } from "./render.js";
