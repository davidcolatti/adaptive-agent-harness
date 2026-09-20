import { describe, expect, expectTypeOf, it } from "vitest";
import { newRunId } from "./ids.js";
import { createNoopTraceWriter, type TraceEvent, type TraceWriter } from "./trace.js";

const EVENT: TraceEvent = {
  runId: newRunId(),
  sequence: 0,
  timestamp: "2026-01-02T03:04:05.000Z",
  type: "run.started",
  payload: { domain: "vendor-triage" },
};

describe("TraceWriter", () => {
  it("is the interface the build plan states for M2-T4", () => {
    expectTypeOf<TraceWriter["append"]>().toEqualTypeOf<(event: TraceEvent) => Promise<void>>();
    expectTypeOf<TraceWriter["flush"]>().toEqualTypeOf<() => Promise<void>>();
  });
});

describe("createNoopTraceWriter", () => {
  it("accepts an event and resolves", async () => {
    const writer = createNoopTraceWriter();

    await expect(writer.append(EVENT)).resolves.toBeUndefined();
  });

  it("flushes repeatedly without complaint", async () => {
    const writer = createNoopTraceWriter();

    await expect(writer.flush()).resolves.toBeUndefined();
    await expect(writer.flush()).resolves.toBeUndefined();
  });

  it("returns an independent writer each call", () => {
    expect(createNoopTraceWriter()).not.toBe(createNoopTraceWriter());
  });
});
