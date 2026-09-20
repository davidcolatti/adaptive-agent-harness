import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, type RunId, type TraceEvent } from "@internal/core";
import type { TraceSink } from "./sink.js";

/**
 * The local durable trace: one canonical-JSON line per event (M2-T4).
 *
 * This is what makes M2's first acceptance criterion true before M2-T5 exists:
 * "every example execution has a durable run row and ordered trace". A JSONL
 * file is the smallest thing that is genuinely durable, genuinely ordered, and
 * readable with `jq`, `wc -l` or an editor rather than a client library, which
 * matters because the run inspector (M2-T10) does not exist yet either.
 *
 * Two deliberate choices:
 *
 * - **Canonical JSON, not `JSON.stringify`.** `canonicalJson()` (ADR-0029)
 *   sorts object keys and drops `undefined` properties, so the same event
 *   always produces the same line. That makes a trace file diffable between
 *   runs and hashable as evidence, which a property-order-dependent encoding
 *   would not be.
 * - **Append mode.** A trace is append-only; a sink that rewrote the file could
 *   lose events a previous process wrote, and reopening per batch is what lets
 *   two processes write to different files in the same directory safely.
 *
 * `node:fs/promises` and `node:path` are Node built-ins, so this package keeps
 * the zero-third-party-dependency rule `@internal/core` already follows.
 */

/** One canonical JSON line per event, with a trailing newline on each. */
function toJsonl(events: readonly TraceEvent[]): string {
  return events.map((event) => `${canonicalJson(event)}\n`).join("");
}

async function appendJsonl(file: string, events: readonly TraceEvent[]): Promise<void> {
  // Created per write rather than once at construction: a sink that made
  // directories before it had anything to write would litter empty folders for
  // runs that never produced an event.
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, toJsonl(events), "utf8");
}

/**
 * Create a {@link TraceSink} that appends every event to one JSONL file.
 *
 * ```ts
 * const sink = createJsonlFileTraceSink(".harness/traces/all.jsonl");
 * ```
 *
 * Parent directories are created on first write. The path is resolved against
 * the process's working directory, so a relative path means what a shell would
 * mean by it.
 */
export function createJsonlFileTraceSink(path: string): TraceSink {
  const file = resolve(path);

  return {
    async write(events: readonly TraceEvent[]): Promise<void> {
      if (events.length === 0) {
        return;
      }

      await appendJsonl(file, events);
    },
  };
}

/** A {@link TraceSink} that files each run's events under its own name. */
export interface JsonlDirectoryTraceSink extends TraceSink {
  /** The file a given run's events are written to. */
  pathFor(runId: RunId): string;
}

/**
 * Create a {@link TraceSink} that writes `<directory>/<runId>.jsonl`.
 *
 * This is the shape a local run actually wants, and the reason it exists
 * alongside the single-file sink: a run id is minted *inside* `harness.run()`,
 * so a caller cannot name the file before the run starts, but a sink sees the
 * `runId` on every event it is handed. One file per run also means the
 * inspector, and a human with `cat`, can find a run by name.
 *
 * A batch spanning several runs is grouped by run and written once per file,
 * in the order the runs first appear, and each file keeps its events in append
 * order.
 */
export function createJsonlDirectoryTraceSink(directory: string): JsonlDirectoryTraceSink {
  const root = resolve(directory);
  const pathFor = (runId: RunId): string => join(root, `${runId}.jsonl`);

  return {
    pathFor,
    async write(events: readonly TraceEvent[]): Promise<void> {
      const byRun = new Map<RunId, TraceEvent[]>();

      for (const event of events) {
        const existing = byRun.get(event.runId);

        if (existing === undefined) {
          byRun.set(event.runId, [event]);
        } else {
          existing.push(event);
        }
      }

      // Sequentially rather than with `Promise.all`: two batches for the same
      // file must not interleave, and a run's trace is small enough that the
      // parallelism would buy nothing.
      for (const [runId, runEvents] of byRun) {
        await appendJsonl(pathFor(runId), runEvents);
      }
    },
  };
}
