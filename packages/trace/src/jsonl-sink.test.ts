import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  createNoopTraceWriter,
  createTraceRecorder,
  newRunId,
  type RunId,
  type TraceEvent,
  type TraceEventType,
} from "@internal/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBufferedTraceWriter } from "./buffered-trace-writer.js";
import { createJsonlDirectoryTraceSink, createJsonlFileTraceSink } from "./jsonl-sink.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "harness-trace-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function recorderFor(runId: RunId): ReturnType<typeof createTraceRecorder> {
  return createTraceRecorder({ runId, writer: createNoopTraceWriter() });
}

async function events(
  runId: RunId,
  ...types: readonly TraceEventType[]
): Promise<readonly TraceEvent[]> {
  const recorder = recorderFor(runId);
  const recorded: TraceEvent[] = [];

  for (const type of types) {
    recorded.push(await recorder.record({ type }));
  }

  return recorded;
}

async function readLines(file: string): Promise<readonly string[]> {
  const contents = await readFile(file, "utf8");

  return contents.split("\n").filter((line) => line !== "");
}

describe("createJsonlFileTraceSink", () => {
  it("writes one canonical JSON line per event, in order", async () => {
    const runId = newRunId();
    const file = join(directory, "trace.jsonl");
    const written = await events(runId, "run.started", "agent.started", "run.completed");

    await createJsonlFileTraceSink(file).write(written);

    const lines = await readLines(file);

    expect(lines).toEqual(written.map((event) => canonicalJson(event)));
    expect(lines.map((line) => (JSON.parse(line) as TraceEvent).type)).toEqual([
      "run.started",
      "agent.started",
      "run.completed",
    ]);
  });

  it("round-trips every field of an event through the line", async () => {
    const runId = newRunId();
    const file = join(directory, "trace.jsonl");
    const recorder = recorderFor(runId);
    const recorded = await recorder.record({
      type: "model.completed",
      payload: { modelId: "harness-fixture" },
      usage: { modelCalls: 1, inputTokens: 7 },
      latencyMs: 12,
    });

    await createJsonlFileTraceSink(file).write([recorded]);
    const [line] = await readLines(file);

    expect(JSON.parse(line ?? "null")).toEqual({
      id: recorded.id,
      runId,
      attempt: 1,
      sequence: 0,
      timestamp: recorded.timestamp,
      type: "model.completed",
      parentId: null,
      node: null,
      version: 1,
      behaviorFingerprint: null,
      payload: { modelId: "harness-fixture" },
      usage: { modelCalls: 1, inputTokens: 7 },
      latencyMs: 12,
      error: null,
    });
  });

  it("sorts keys, so the same event always produces the same line", async () => {
    const runId = newRunId();
    const file = join(directory, "trace.jsonl");
    const [recorded] = await events(runId, "run.started");

    await createJsonlFileTraceSink(file).write(recorded === undefined ? [] : [recorded]);
    const [line] = await readLines(file);

    expect(line?.startsWith('{"attempt":1,"behaviorFingerprint":null,')).toBe(true);
  });

  it("creates parent directories that do not exist yet", async () => {
    const runId = newRunId();
    const file = join(directory, "nested", "deeper", "trace.jsonl");

    await createJsonlFileTraceSink(file).write(await events(runId, "run.started"));

    expect(await readLines(file)).toHaveLength(1);
  });

  it("appends rather than truncating", async () => {
    const runId = newRunId();
    const file = join(directory, "trace.jsonl");
    const sink = createJsonlFileTraceSink(file);

    await sink.write(await events(runId, "run.started"));
    await sink.write(await events(runId, "run.completed"));

    expect(await readLines(file)).toHaveLength(2);
  });

  it("touches nothing for an empty batch", async () => {
    const file = join(directory, "trace.jsonl");

    await createJsonlFileTraceSink(file).write([]);

    await expect(readFile(file, "utf8")).rejects.toThrow();
  });
});

describe("createJsonlDirectoryTraceSink", () => {
  it("files each run's events under its own run id", async () => {
    const first = newRunId();
    const second = newRunId();
    const sink = createJsonlDirectoryTraceSink(directory);

    await sink.write([
      ...(await events(first, "run.started")),
      ...(await events(second, "run.started")),
      ...(await events(first, "run.completed")),
    ]);

    expect(sink.pathFor(first)).toBe(join(directory, `${first}.jsonl`));
    expect(await readLines(sink.pathFor(first))).toHaveLength(2);
    expect(await readLines(sink.pathFor(second))).toHaveLength(1);
  });

  it("keeps one run's events in append order across batches", async () => {
    const runId = newRunId();
    const sink = createJsonlDirectoryTraceSink(directory);
    const writer = createBufferedTraceWriter({ sink, maxBufferedEvents: 2 });
    const recorded = await events(
      runId,
      "run.started",
      "agent.started",
      "agent.completed",
      "run.completed",
    );

    for (const event of recorded) {
      await writer.append(event);
    }
    await writer.flush();

    const lines = await readLines(sink.pathFor(runId));

    expect(lines.map((line) => (JSON.parse(line) as TraceEvent).sequence)).toEqual([0, 1, 2, 3]);
    expect(lines.map((line) => (JSON.parse(line) as TraceEvent).type)).toEqual([
      "run.started",
      "agent.started",
      "agent.completed",
      "run.completed",
    ]);
  });
});
