import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  createNoopTraceWriter,
  createTraceRecorder,
  newRunId,
  type RunId,
  StorageError,
  type TraceEvent,
  ValidationError,
} from "@internal/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBufferedTraceWriter } from "./buffered-trace-writer.js";
import { createJsonlDirectoryTraceSink, createJsonlFileTraceSink } from "./jsonl-sink.js";
import { readJsonlTraceEvents } from "./jsonl-source.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "harness-trace-source-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** Record a small, realistic run through the real writer chain into a directory sink. */
async function writeRun(runId: RunId): Promise<readonly TraceEvent[]> {
  const sink = createJsonlDirectoryTraceSink(directory);
  const writer = createBufferedTraceWriter({ sink });
  const recorder = createTraceRecorder({ runId, writer, behaviorFingerprint: "sha256:abc" });
  const recorded: TraceEvent[] = [];

  recorded.push(await recorder.record({ type: "run.started", payload: { jobType: "triage" } }));

  const agent = await recorder.span({ type: "agent.started", parentId: recorder.rootId });

  recorded.push(agent.event);

  const model = await recorder.span({
    type: "model.started",
    parentId: agent.id,
    payload: { modelId: "harness-fixture" },
  });

  recorded.push(model.event);
  recorded.push(
    await model.end({
      type: "model.completed",
      payload: { finishReason: "stop" },
      usage: { modelCalls: 1, inputTokens: 9, outputTokens: 4 },
    }),
  );
  recorded.push(await agent.end({ type: "agent.completed" }));
  recorded.push(await recorder.record({ type: "run.completed", latencyMs: 12 }));

  await recorder.flush();

  return recorded;
}

describe("readJsonlTraceEvents", () => {
  it("reads back exactly what the directory sink wrote", async () => {
    const runId = newRunId();
    const recorded = await writeRun(runId);

    const read = await readJsonlTraceEvents(join(directory, `${runId}.jsonl`));

    expect(read).toEqual(recorded);
  });

  it("reads back exactly what the single-file sink wrote", async () => {
    const file = join(directory, "all.jsonl");
    const recorder = createTraceRecorder({
      runId: newRunId(),
      writer: createBufferedTraceWriter({ sink: createJsonlFileTraceSink(file) }),
    });

    const started = await recorder.record({ type: "run.started" });
    const completed = await recorder.record({ type: "run.completed" });

    await recorder.flush();

    expect(await readJsonlTraceEvents(file)).toEqual([started, completed]);
  });

  it("returns events in sequence order even when the file is not", async () => {
    const recorder = createTraceRecorder({ runId: newRunId(), writer: createNoopTraceWriter() });
    const first = await recorder.record({ type: "run.started" });
    const second = await recorder.record({ type: "run.completed" });
    const file = join(directory, "shuffled.jsonl");

    await writeFile(file, `${canonicalJson(second)}\n${canonicalJson(first)}\n`, "utf8");

    expect((await readJsonlTraceEvents(file)).map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("keeps every run in a file that holds more than one", async () => {
    const recorderA = createTraceRecorder({ runId: newRunId(), writer: createNoopTraceWriter() });
    const recorderB = createTraceRecorder({ runId: newRunId(), writer: createNoopTraceWriter() });
    const file = join(directory, "two-runs.jsonl");
    const a = await recorderA.record({ type: "run.started" });
    const b = await recorderB.record({ type: "run.started" });

    await writeFile(file, `${canonicalJson(a)}\n${canonicalJson(b)}\n`, "utf8");

    expect(new Set((await readJsonlTraceEvents(file)).map((event) => event.runId)).size).toBe(2);
  });

  it("skips blank lines", async () => {
    const recorder = createTraceRecorder({ runId: newRunId(), writer: createNoopTraceWriter() });
    const event = await recorder.record({ type: "run.started" });
    const file = join(directory, "blank.jsonl");

    await writeFile(file, `\n${canonicalJson(event)}\n\n`, "utf8");

    expect(await readJsonlTraceEvents(file)).toEqual([event]);
  });

  it("throws a StorageError naming the file when it does not exist", async () => {
    const file = join(directory, "absent.jsonl");

    await expect(readJsonlTraceEvents(file)).rejects.toThrow(StorageError);
    await expect(readJsonlTraceEvents(file)).rejects.toThrow(file);
  });

  it("throws a ValidationError naming the line that is not JSON", async () => {
    const file = join(directory, "broken.jsonl");

    await writeFile(file, '{"id":"x"\n', "utf8");

    await expect(readJsonlTraceEvents(file)).rejects.toThrow(ValidationError);
    await expect(readJsonlTraceEvents(file)).rejects.toThrow(`${file}:1 is not JSON`);
  });

  it("throws a ValidationError naming the line that is not a trace event", async () => {
    const recorder = createTraceRecorder({ runId: newRunId(), writer: createNoopTraceWriter() });
    const event = await recorder.record({ type: "run.started" });
    const file = join(directory, "not-an-event.jsonl");

    await writeFile(
      file,
      `${canonicalJson(event)}\n${JSON.stringify({ ...event, type: "eve.turn" })}\n`,
      "utf8",
    );

    await expect(readJsonlTraceEvents(file)).rejects.toThrow(`${file}:2 is not a trace event`);
  });
});
