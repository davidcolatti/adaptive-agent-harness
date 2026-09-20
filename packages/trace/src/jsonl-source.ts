import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseTraceEvent, StorageError, type TraceEvent, ValidationError } from "@internal/core";

/**
 * Reading a JSONL trace file back: the exact inverse of `jsonl-sink.ts`
 * (M2-T10).
 *
 * It lives in this package, and in the module next to the sink, for one reason:
 * **the line format has exactly one owner.** `createJsonlFileTraceSink()` and
 * `createJsonlDirectoryTraceSink()` define a trace file as one canonical-JSON
 * event per line with a trailing newline, and a reader that restated that
 * elsewhere would be a second copy of the format, free to drift the first time
 * either side changed. The run inspector (`@internal/observability`) consumes
 * this rather than opening the file itself.
 *
 * What it deliberately does not own is *checking*: every line goes through
 * `parseTraceEvent()` from `@internal/core`, the same boundary the Supabase
 * adapter reads a row through, so a hand-edited file and a hand-edited row fail
 * identically. A JSONL trace is untrusted input: it is a plain text file on a
 * developer's disk that anything can write to.
 */

/**
 * Read every {@link TraceEvent} in a JSONL trace file, in `sequence` order.
 *
 * ```ts
 * const events = await readJsonlTraceEvents(".harness/traces/01a0….jsonl");
 * ```
 *
 * Blank lines are skipped, so a file ending in a newline (which every file this
 * sink writes does) reads cleanly. Events are sorted by `sequence` rather than
 * trusted to be in file order: append order and sequence order agree for
 * everything the buffered writer produces, but a trace read back is evidence
 * and sorting it costs nothing, while a silently misordered timeline would be
 * wrong in the one way an inspector must never be.
 *
 * The single-file sink writes every run to one file, so a file may hold more
 * than one run. Filtering by `runId` is the caller's job; nothing is dropped
 * here.
 *
 * @throws {StorageError} when the file cannot be read, with the cause
 * preserved. A missing file says so by name rather than by `ENOENT`.
 * @throws {ValidationError} when a line is not JSON, or is JSON that is not a
 * trace event. The message names the file and the 1-based line number, and the
 * issues carry the failing field paths.
 */
export async function readJsonlTraceEvents(path: string): Promise<readonly TraceEvent[]> {
  const file = resolve(path);
  let contents: string;

  try {
    contents = await readFile(file, "utf8");
  } catch (cause) {
    throw new StorageError(`jsonl trace: cannot read \`${file}\``, { cause });
  }

  const events: TraceEvent[] = [];
  const lines = contents.split("\n");

  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") {
      continue;
    }

    events.push(readLine(file, index + 1, line));
  }

  return events.toSorted((left, right) => left.sequence - right.sequence);
}

/**
 * Parse one line, or throw naming where it is.
 *
 * A `ValidationError` from `parseTraceEvent` is re-thrown with the file and
 * line in its message and its issues intact, because "field `sequence` is not
 * an integer" is only actionable once you know which of two hundred lines it
 * came from.
 */
function readLine(file: string, lineNumber: number, line: string): TraceEvent {
  let value: unknown;

  try {
    value = JSON.parse(line);
  } catch (cause) {
    throw new ValidationError(`jsonl trace: ${file}:${lineNumber} is not JSON`, {
      issues: [{ path: [lineNumber], message: "expected one JSON object per line" }],
      cause,
    });
  }

  try {
    return parseTraceEvent(value);
  } catch (cause) {
    if (!(cause instanceof ValidationError)) {
      throw cause;
    }

    throw new ValidationError(
      `jsonl trace: ${file}:${lineNumber} is not a trace event: ${cause.message}`,
      { issues: cause.issues, cause },
    );
  }
}
