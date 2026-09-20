import type { JsonValue } from "@internal/core";
import type { CallGroup, InspectedError, RunInspection, TimelineEntry } from "./inspect-run.js";

/**
 * Turning a {@link RunInspection} into text a person reads (M2-T10).
 *
 * The sections are the build plan's display list, in its order: job, route,
 * timeline, tool/model/Jev calls, errors, result, cost, fingerprints. Nothing
 * is computed here. The renderer is a pure function of the inspection, which is
 * what makes `--json` and the human form two views of one value rather than two
 * implementations that drift.
 *
 * **No ANSI by default.** Colour is opt-in through `{ color: true }`, because
 * the first thing anyone does with this output is pipe it into `grep`, a file
 * or an issue, and escape codes survive all three. Nothing decides on its own
 * whether the terminal is a TTY; the CLI decides and says so.
 */

/** What {@link renderRunInspection} accepts. */
export interface RenderRunInspectionOptions {
  /** Emit ANSI colour. Defaults to `false`. */
  readonly color?: boolean;
  /**
   * How wide the timeline's summary column may be before it is truncated.
   * Defaults to 56. The untruncated text is always in the inspection itself.
   */
  readonly summaryWidth?: number;
}

const DEFAULT_SUMMARY_WIDTH = 56;

/** The four ANSI codes used, and their no-colour equivalents. */
interface Palette {
  readonly heading: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly bad: (text: string) => string;
  readonly good: (text: string) => string;
}

const PLAIN: Palette = {
  heading: (text) => text,
  dim: (text) => text,
  bad: (text) => text,
  good: (text) => text,
};

const COLOURED: Palette = {
  heading: (text) => `\u001B[1m${text}\u001B[0m`,
  dim: (text) => `\u001B[2m${text}\u001B[0m`,
  bad: (text) => `\u001B[31m${text}\u001B[0m`,
  good: (text) => `\u001B[32m${text}\u001B[0m`,
};

/** `null` reads as a measurement nobody made, which is what it means everywhere here. */
function show(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? "(none)" : String(value);
}

function ms(value: number | null): string {
  return value === null ? "(none)" : `${value} ms`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padStart(text: string, width: number): string {
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function section(palette: Palette, title: string): string {
  return palette.heading(`${title}\n${"─".repeat(title.length)}`);
}

/** A `key: value` block, aligned on the colon. */
function fields(rows: readonly (readonly [string, string])[]): string {
  const width = Math.max(0, ...rows.map(([label]) => label.length));

  return rows.map(([label, value]) => `  ${pad(`${label}:`, width + 1)} ${value}`).join("\n");
}

function renderTimeline(
  palette: Palette,
  timeline: readonly TimelineEntry[],
  summaryWidth: number,
): string {
  if (timeline.length === 0) {
    return "  (no events)";
  }

  const header = [
    padStart("seq", 4),
    padStart("+ms", 8),
    pad("type", 18),
    padStart("latency", 9),
    "detail",
  ].join("  ");

  const rows = timeline.map((entry) =>
    [
      padStart(String(entry.sequence), 4),
      padStart(entry.offsetMs === null ? "?" : String(entry.offsetMs), 8),
      pad(entry.type, 18),
      padStart(entry.latencyMs === null ? "-" : String(entry.latencyMs), 9),
      truncate(entry.summary, summaryWidth),
    ]
      .join("  ")
      .trimEnd(),
  );

  return [`  ${palette.dim(header)}`, ...rows.map((row) => `  ${row}`)].join("\n");
}

function renderCallGroup(palette: Palette, label: string, group: CallGroup): string {
  if (group.count === 0) {
    return `  ${pad(`${label}:`, 8)} 0`;
  }

  const head = `  ${pad(`${label}:`, 8)} ${group.count} call${group.count === 1 ? "" : "s"}, ${ms(
    group.totalLatencyMs,
  )} total`;

  const rows = group.calls.map((call) => {
    const status =
      call.status === "failed"
        ? palette.bad("failed")
        : call.status === "open"
          ? palette.bad("open")
          : palette.good("completed");
    const parts = [
      `    seq ${padStart(String(call.sequence), 3)}`,
      pad(show(call.id), 28),
      pad(status, 9),
      padStart(call.latencyMs === null ? "-" : `${call.latencyMs} ms`, 9),
    ];

    if (call.errorCode !== null) {
      parts.push(call.errorCode);
    }

    return parts.join("  ").trimEnd();
  });

  return [head, ...rows].join("\n");
}

function renderErrors(palette: Palette, errors: readonly InspectedError[]): string {
  if (errors.length === 0) {
    return `  ${palette.good("none")}`;
  }

  return errors
    .map((entry) => {
      const where =
        entry.source === "ledger" ? "ledger row" : `seq ${entry.sequence} (${entry.type})`;
      const lines = [
        `  ${palette.bad(entry.error.code)} at ${where}`,
        `    ${entry.error.message}`,
      ];

      if (entry.error.details !== undefined && entry.error.details !== null) {
        lines.push(`    details: ${JSON.stringify(entry.error.details)}`);
      }

      return lines.join("\n");
    })
    .join("\n");
}

/** How much of a job's `input` the text form prints before it abbreviates. */
const INPUT_MAX_LINES = 20;
const INPUT_MAX_LINE_WIDTH = 100;

/**
 * Pretty JSON for a job's `input`, indented into the section and abbreviated.
 *
 * A real job's input can be a whole SOP: the vendor-triage example's is a
 * thousand characters of Markdown in one string, which would push every section
 * below it off the screen. So the text form prints the shape and says how much
 * it left out, and `--json` prints the whole thing. Abbreviating in the
 * renderer rather than in `inspectRun` is deliberate — the inspection itself
 * stays complete, and only this view is short.
 */
function indentJson(value: JsonValue | undefined, indent: string): string {
  const lines = JSON.stringify(value ?? null, null, 2).split("\n");
  const shown = lines
    .slice(0, INPUT_MAX_LINES)
    .map((line) => `${indent}${truncate(line, INPUT_MAX_LINE_WIDTH)}`);

  if (lines.length > INPUT_MAX_LINES) {
    shown.push(
      `${indent}… ${lines.length - INPUT_MAX_LINES} more lines; use --json for the whole job`,
    );
  }

  return shown.join("\n");
}

/**
 * Render a {@link RunInspection} as readable plain text.
 *
 * ```ts
 * process.stdout.write(renderRunInspection(inspection));
 * ```
 *
 * The returned string ends in a newline, so a caller writes it as-is.
 */
export function renderRunInspection(
  inspection: RunInspection,
  options: RenderRunInspectionOptions = {},
): string {
  const palette = options.color === true ? COLOURED : PLAIN;
  const summaryWidth = options.summaryWidth ?? DEFAULT_SUMMARY_WIDTH;
  const { job, run, route, calls, result, cost, fingerprints } = inspection;
  const blocks: string[] = [];

  blocks.push(
    [
      palette.heading(`run ${inspection.runId}`),
      palette.dim(`read from ${inspection.sourceDescription}`),
      ...inspection.notes.map((note) => palette.dim(`note: ${note}`)),
    ].join("\n"),
  );

  blocks.push(
    [
      section(palette, "Job"),
      job === null
        ? "  (unavailable)"
        : [
            fields([
              ["id", job.id],
              ["domain", `${job.domain.id}@${job.domain.version}`],
              ["type", job.jobType],
              ["objective", job.objective],
              ["input schema", job.contracts.inputSchema],
              ["output schema", job.contracts.outputSchema],
              ["sop", job.contracts.sop],
              ["budget", JSON.stringify(job.budget)],
              [
                "permissions",
                job.permissions.length === 0
                  ? "(none)"
                  : job.permissions.map((grant) => `${grant.toolId}:${grant.mode}`).join(", "),
              ],
            ]),
            "  input:",
            indentJson(job.input as JsonValue, "    "),
          ].join("\n"),
    ].join("\n"),
  );

  blocks.push(
    [
      section(palette, "Route"),
      fields([
        ["route", route.route],
        ["domain", route.domain === null ? "(none)" : `${route.domain.id}@${route.domain.version}`],
        ["job type", show(route.jobType)],
        ["target", show(route.target)],
        [
          "runtime",
          route.runtime === null ? "(none)" : `${route.runtime.name}@${route.runtime.version}`,
        ],
        ["attempt", show(run?.attempt)],
        ["fallbacks", `${route.fallbackCount} (from the ${route.fallbackSource})`],
      ]),
    ].join("\n"),
  );

  blocks.push(
    [section(palette, "Timeline"), renderTimeline(palette, inspection.timeline, summaryWidth)].join(
      "\n",
    ),
  );

  blocks.push(
    [
      section(palette, "Calls"),
      renderCallGroup(palette, "model", calls.model),
      renderCallGroup(palette, "tool", calls.tool),
      renderCallGroup(palette, "jev", calls.jev),
      // Absent when the run made Jev calls: there is no zero to explain.
      ...(calls.jevNote === null ? [] : [`  ${palette.dim(`jev: ${calls.jevNote}`)}`]),
    ].join("\n"),
  );

  blocks.push([section(palette, "Errors"), renderErrors(palette, inspection.errors)].join("\n"));

  blocks.push(
    [
      section(palette, "Result"),
      fields([
        [
          "status",
          result.status === null
            ? "(unknown)"
            : `${result.status === "failed" ? palette.bad(result.status) : result.status}${
                result.statusSource === null ? "" : ` (from the ${result.statusSource})`
              }`,
        ],
        ["success", show(result.success)],
        ["started", show(result.startedAt)],
        ["finished", show(result.finishedAt)],
        ["latency", ms(result.latencyMs)],
        ["output", `(none) ${palette.dim(result.outputNote)}`],
      ]),
    ].join("\n"),
  );

  blocks.push(
    [
      section(palette, "Cost"),
      fields([
        ["cost (ledger)", cost.costUsd === null ? "(none)" : `$${cost.costUsd}`],
        ["cost (trace)", cost.tracedCostUsd === null ? "(none)" : `$${cost.tracedCostUsd}`],
        ["model calls", show(cost.modelCalls)],
        ["tool calls", show(cost.toolCalls)],
        ["jev calls", show(cost.jevCalls)],
        ["input tokens", show(cost.tokens.inputTokens)],
        ["output tokens", show(cost.tokens.outputTokens)],
        ["cache read", show(cost.tokens.cacheReadTokens)],
        ["cache write", show(cost.tokens.cacheWriteTokens)],
        ["total tokens", show(cost.tokens.totalTokens)],
      ]),
    ].join("\n"),
  );

  const componentRows: (readonly [string, string])[] =
    fingerprints.components === null
      ? []
      : Object.entries(fingerprints.components).map(
          ([name, digest]) => [`  ${name}`, digest] as const,
        );

  blocks.push(
    [
      section(palette, "Fingerprints"),
      fields([
        ["run (ledger)", show(fingerprints.run)],
        ["agent version", show(fingerprints.agentVersion)],
        ["trace", show(fingerprints.trace)],
        [
          "consistent",
          fingerprints.consistent
            ? palette.good("yes, every event carries the run's fingerprint")
            : palette.bad(
                `no, sequences ${fingerprints.inconsistentSequences.join(", ")} disagree`,
              ),
        ],
        ["scheme", show(fingerprints.scheme)],
        ["algorithm", show(fingerprints.algorithm)],
        ...(componentRows.length === 0
          ? ([["components", "(none in the run.started payload)"]] as const)
          : ([["components", ""], ...componentRows] as const)),
      ]),
    ].join("\n"),
  );

  return `${blocks.join("\n\n")}\n`;
}
