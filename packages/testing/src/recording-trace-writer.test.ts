import {
  createNoopTraceWriter,
  createTraceRecorder,
  newRunId,
  type TraceEvent,
  type TraceEventType,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { createRecordingTraceWriter } from "./recording-trace-writer.js";

const RUN_ID = newRunId();

/**
 * Build a real event the way the harness does, through a recorder.
 *
 * Constructing a `TraceEvent` literal here would let this fixture drift from
 * the contract, and the fields a recorder owns (`id`, `sequence`, `version`)
 * are exactly the ones a hand-written literal gets wrong.
 */
const recorder = createTraceRecorder({ runId: RUN_ID, writer: createNoopTraceWriter() });

async function event(type: TraceEventType): Promise<TraceEvent> {
  return await recorder.record({ type });
}

describe("createRecordingTraceWriter", () => {
  it("records events in append order", async () => {
    const writer = createRecordingTraceWriter();

    await writer.append(await event("run.started"));
    await writer.append(await event("run.completed"));

    expect(writer.types()).toEqual(["run.started", "run.completed"]);
    expect(writer.events.map((appended) => appended.sequence)).toEqual([0, 1]);
  });

  it("counts flushes, so `the caller flushed` is checkable rather than assumed", async () => {
    const writer = createRecordingTraceWriter();

    expect(writer.flushCount).toBe(0);
    await writer.flush();
    await writer.flush();
    expect(writer.flushCount).toBe(2);
  });

  it("starts empty", () => {
    const writer = createRecordingTraceWriter();

    expect(writer.events).toEqual([]);
    expect(writer.types()).toEqual([]);
  });
});
