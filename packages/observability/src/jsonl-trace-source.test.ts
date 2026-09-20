import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newRunId, StorageError } from "@internal/core";
import { createJsonlDirectoryTraceSink } from "@internal/trace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordFixtureRun } from "./fixtures.js";
import { inspectRun } from "./inspect-run.js";
import { createJsonlTraceSource } from "./jsonl-trace-source.js";

/**
 * `createJsonlTraceSource()` (M2-T10): a run inspected with no database.
 *
 * The file under test is written by the real JSONL directory sink during a real
 * harness run, because "the inspector can read what the sink writes" is exactly
 * the claim, and a hand-written fixture file would not test it.
 */

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "harness-inspector-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("createJsonlTraceSource", () => {
  it("inspects a run from the file the directory sink wrote, with no storage", async () => {
    const sink = createJsonlDirectoryTraceSink(directory);
    const { storage, result } = await recordFixtureRun({ sinks: [sink] });

    const fromFile = await inspectRun(
      createJsonlTraceSource(sink.pathFor(result.runId)),
      result.runId,
    );
    const fromStorage = await inspectRun(storage, result.runId);

    expect(fromFile.found).toBe(true);
    expect(fromFile.source).toBe("trace");
    expect(fromFile.timeline).toEqual(fromStorage.timeline);
    expect(fromFile.calls.model).toEqual(fromStorage.calls.model);
    expect(fromFile.calls.tool).toEqual(fromStorage.calls.tool);
    expect(fromFile.result.status).toBe("completed");
    expect(fromFile.fingerprints.components).toEqual(fromStorage.fingerprints.components);
  });

  it("describes itself by the absolute path it read", async () => {
    const sink = createJsonlDirectoryTraceSink(directory);
    const { result } = await recordFixtureRun({ sinks: [sink] });

    const inspection = await inspectRun(
      createJsonlTraceSource(sink.pathFor(result.runId)),
      result.runId,
    );

    expect(inspection.sourceDescription).toBe(`the JSONL trace ${sink.pathFor(result.runId)}`);
  });

  it("returns nothing for a run the file does not contain", async () => {
    const sink = createJsonlDirectoryTraceSink(directory);
    const { result } = await recordFixtureRun({ sinks: [sink] });

    const inspection = await inspectRun(
      createJsonlTraceSource(sink.pathFor(result.runId)),
      newRunId(),
    );

    expect(inspection.found).toBe(false);
    expect(inspection.timeline).toEqual([]);
  });

  it("rejects with a StorageError when the file does not exist", async () => {
    const source = createJsonlTraceSource(join(directory, "absent.jsonl"));

    await expect(inspectRun(source, newRunId())).rejects.toThrow(StorageError);
  });
});
