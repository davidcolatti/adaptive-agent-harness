import { describe, expect, it } from "vitest";
import { recordFixtureRun } from "./fixtures.js";
import { inspectRun } from "./inspect-run.js";
import { renderRunInspection } from "./render.js";

/**
 * `renderRunInspection()` (M2-T10).
 *
 * The renderer is a pure function of an inspection, so every case here renders
 * a real one. What is asserted is the contract a reader depends on: the build
 * plan's eight sections are present, in its order; the numbers that matter are
 * in the text; and nothing emits an escape code unless colour was asked for.
 */

/** The build plan's M2-T10 display list, as section headings, in its order. */
const SECTIONS = ["Job", "Route", "Timeline", "Calls", "Errors", "Result", "Cost", "Fingerprints"];

describe("renderRunInspection", () => {
  it("prints the build plan's eight sections in its order", async () => {
    const { storage, result } = await recordFixtureRun();

    const text = renderRunInspection(await inspectRun(storage, result.runId));
    const positions = SECTIONS.map((heading) => text.indexOf(`\n${heading}\n`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].toSorted((a, b) => a - b));
  });

  it("names the run, the source, the job and the route", async () => {
    const { storage, result } = await recordFixtureRun();

    const text = renderRunInspection(await inspectRun(storage, result.runId));

    expect(text).toContain(`run ${result.runId}`);
    expect(text).toContain("read from the Storage port");
    expect(text).toContain(result.jobId);
    expect(text).toContain("vendor-triage-fixture@1.0.0");
    expect(text).toContain("full-agent");
    expect(text).toContain("@internal/observability-fixture");
  });

  it("prints the timeline as fixed-width columns, one row per event", async () => {
    const { storage, result } = await recordFixtureRun();
    const inspection = await inspectRun(storage, result.runId);

    const text = renderRunInspection(inspection);
    const rows = text.split("\n").filter((line) => /^\s+\d+\s+\d+\s+\w+\.\w+/.test(line));

    expect(rows).toHaveLength(inspection.timeline.length);
    expect(text).toContain("seq");
    expect(text).toContain("latency");
    expect(text).toContain("model.completed");
  });

  it("prints the model and tool calls with their identities", async () => {
    const { storage, result } = await recordFixtureRun();

    const text = renderRunInspection(await inspectRun(storage, result.runId));

    expect(text).toMatch(/model:\s+1 call/);
    expect(text).toMatch(/tool:\s+1 call/);
    expect(text).toMatch(/jev:\s+0/);
    expect(text).toContain("fixture-model");
    expect(text).toContain("lookup");
  });

  it("prints the cost, the token totals and the component digests", async () => {
    const { storage, result } = await recordFixtureRun();
    const inspection = await inspectRun(storage, result.runId);

    const text = renderRunInspection(inspection);

    expect(text).toContain("$0.002");
    expect(text).toContain("160");
    expect(text).toContain("instructions");
    expect(text).toContain(inspection.fingerprints.run ?? "");
    expect(text).toContain("every event carries the run's fingerprint");
  });

  it("says the output is not persisted rather than printing nothing", async () => {
    const { storage, result } = await recordFixtureRun();

    const text = renderRunInspection(await inspectRun(storage, result.runId));

    expect(text).toContain("not persisted in Milestone 2");
  });

  it("prints a failed run's error, code and message", async () => {
    const { storage, result } = await recordFixtureRun({ outcome: "failed" });

    const text = renderRunInspection(await inspectRun(storage, result.runId));

    expect(text).toContain("AGENT_EXECUTION");
    expect(text).toContain("the fixture model refused");
    expect(text).toContain("ledger row");
    expect(text).toMatch(/status:\s+failed/);
  });

  it("emits no ANSI by default and some when colour is asked for", async () => {
    const { storage, result } = await recordFixtureRun();
    const inspection = await inspectRun(storage, result.runId);

    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point.
    const ansi = /\u001B\[/;

    expect(ansi.test(renderRunInspection(inspection))).toBe(false);
    expect(ansi.test(renderRunInspection(inspection, { color: true }))).toBe(true);
  });

  it("says what is missing when the source is trace-only", async () => {
    const { storage, result } = await recordFixtureRun();
    const events = storage.events.filter((event) => event.runId === result.runId);
    const inspection = await inspectRun(
      {
        kind: "trace",
        description: "the JSONL trace /tmp/x.jsonl",
        readTrace: () => Promise.resolve(events),
      },
      result.runId,
    );

    const text = renderRunInspection(inspection);

    expect(text).toContain("note: job and ledger row unavailable (trace-only source)");
    expect(text).toContain("read from the JSONL trace /tmp/x.jsonl");
    expect(text).toContain("(unavailable)");
  });

  it("truncates a long summary to the timeline's column width", async () => {
    const { storage, result } = await recordFixtureRun();
    const inspection = await inspectRun(storage, result.runId);

    const text = renderRunInspection(inspection, { summaryWidth: 6 });

    expect(text).toContain("model…");
    // The untruncated text is still in the inspection itself.
    expect(inspection.timeline.some((entry) => entry.summary === "modelId=fixture-model")).toBe(
      true,
    );
  });

  it("ends in exactly one newline, so a caller writes it as-is", async () => {
    const { storage, result } = await recordFixtureRun();

    const text = renderRunInspection(await inspectRun(storage, result.runId));

    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("renderRunInspection: the job's input", () => {
  it("abbreviates a long input and says where the whole one is", async () => {
    const { storage, result } = await recordFixtureRun();
    const inspection = await inspectRun(storage, result.runId);
    const long = {
      ...inspection,
      job: inspection.job === null ? null : { ...inspection.job, input: { sop: "x".repeat(500) } },
    };

    const text = renderRunInspection(long);

    expect(text).toContain("…");
    expect(text).not.toContain("x".repeat(200));
    // The inspection itself is untouched; only this view is short.
    expect((long.job?.input as { sop: string } | undefined)?.sop).toHaveLength(500);
  });

  it("prints a short input in full", async () => {
    const { storage, result } = await recordFixtureRun();

    const text = renderRunInspection(await inspectRun(storage, result.runId));

    expect(text).toContain('"vendorName": "Northwind"');
    expect(text).not.toContain("more lines");
  });
});
