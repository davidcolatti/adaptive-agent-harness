import { newRunId, type TraceEvent } from "@internal/core";
import { describe, expect, it } from "vitest";
import { createRecordingTraceWriter } from "./recording-trace-writer.js";

const RUN_ID = newRunId();

function event(sequence: number, type: string): TraceEvent {
  return {
    runId: RUN_ID,
    sequence,
    timestamp: "2026-09-19T12:00:00.000Z",
    type,
    payload: {},
  };
}

describe("createRecordingTraceWriter", () => {
  it("records events in append order", async () => {
    const writer = createRecordingTraceWriter();

    await writer.append(event(0, "run.started"));
    await writer.append(event(1, "run.completed"));

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
