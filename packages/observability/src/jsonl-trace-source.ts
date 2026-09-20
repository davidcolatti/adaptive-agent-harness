import { resolve } from "node:path";
import type { RunId, TraceEvent } from "@internal/core";
import { readJsonlTraceEvents } from "@internal/trace";
import type { TraceOnlySource } from "./inspect-run.js";

/**
 * A {@link TraceOnlySource} over a `.jsonl` trace file (M2-T10).
 *
 * The credential-free half of the inspector. `apps/example-agent` writes
 * `<app root>/.harness/traces/<runId>.jsonl` on every run whether or not
 * Supabase is configured, so this makes a run inspectable with no database, no
 * key and no Docker — north-star invariant 15 — and, more usefully, makes a run
 * inspectable when writing it to the database is the thing that failed.
 *
 * The file format is owned by `@internal/trace` (`readJsonlTraceEvents`, the
 * inverse of its JSONL sinks), so this module holds only the run filter and the
 * description the inspection prints. A file written by the directory sink holds
 * one run; a file written by the single-file sink can hold several, which is
 * why the filter exists at all.
 */

/**
 * Create a trace source that reads one JSONL file.
 *
 * ```ts
 * const source = createJsonlTraceSource(".harness/traces/01a0….jsonl");
 * const inspection = await inspectRun(source, runId);
 * ```
 *
 * The file is read on each `readTrace` call rather than cached, because a trace
 * being appended to while it is inspected is the normal case for a long run.
 * Reading a file that does not exist rejects with a `StorageError`, and a line
 * that is not a trace event rejects with a `ValidationError` naming the line;
 * both come from `readJsonlTraceEvents`.
 */
export function createJsonlTraceSource(path: string): TraceOnlySource {
  const file = resolve(path);

  return {
    kind: "trace",
    description: `the JSONL trace ${file}`,
    async readTrace(runId: RunId): Promise<readonly TraceEvent[]> {
      const events = await readJsonlTraceEvents(file);

      return events.filter((event) => event.runId === runId);
    },
  };
}
