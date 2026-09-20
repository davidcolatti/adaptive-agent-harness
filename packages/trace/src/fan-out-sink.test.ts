import { newRunId, type RunId, StorageError, type TraceEvent } from "@internal/core";
import { describe, expect, it } from "vitest";
import { createBufferedTraceWriter } from "./buffered-trace-writer.js";
import { createFanOutTraceSink } from "./fan-out-sink.js";
import { createInMemoryTraceSink, type TraceSink } from "./sink.js";

/**
 * `createFanOutTraceSink()` (M2-T5): one buffered writer, several destinations.
 *
 * What matters is that the destinations stay in step and that a broken one is
 * neither hidden nor allowed to strand the run. Everything below is one of
 * those two.
 */

function makeEvent(runId: RunId, sequence: number): TraceEvent {
  return {
    id: `01a0bcd0-0000-7000-8000-${String(sequence).padStart(12, "0")}` as TraceEvent["id"],
    runId,
    attempt: 1,
    sequence,
    timestamp: new Date(Date.UTC(2026, 8, 19, 12, 0, sequence)).toISOString(),
    type: sequence === 0 ? "run.started" : "run.completed",
    parentId: null,
    node: null,
    version: 1,
    behaviorFingerprint: null,
    payload: {},
    usage: null,
    latencyMs: null,
    error: null,
  };
}

/** A sink that always rejects, and counts how often it was asked. */
function failingSink(reason: unknown): TraceSink & { readonly calls: () => number } {
  let calls = 0;

  return {
    calls: (): number => calls,
    write(): Promise<void> {
      calls += 1;
      return Promise.reject(reason);
    },
  };
}

describe("createFanOutTraceSink", () => {
  it("writes the same events, in the same order, to every sink", async () => {
    const first = createInMemoryTraceSink();
    const second = createInMemoryTraceSink();
    const runId = newRunId();
    const events = [makeEvent(runId, 0), makeEvent(runId, 1)];

    await createFanOutTraceSink([first, second]).write(events);

    expect(first.events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(second.events.map((event) => event.sequence)).toEqual([0, 1]);
    // Not merely equal: the same events, because the fan-out never copies or
    // transforms. A destination that saw a different value would be a second
    // trace of the same run.
    expect(first.events[0]).toBe(events[0]);
    expect(second.events[0]).toBe(events[0]);
  });

  it("does nothing for an empty batch or an empty sink list", async () => {
    const sink = createInMemoryTraceSink();

    await createFanOutTraceSink([sink]).write([]);
    await createFanOutTraceSink([]).write([makeEvent(newRunId(), 0)]);

    expect(sink.batches).toEqual([]);
  });

  it("still writes to the healthy sinks when one fails", async () => {
    // A broken destination must not cost the others their copy of the trace:
    // that is the whole reason the failure is collected rather than thrown at
    // the first rejection.
    const healthy = createInMemoryTraceSink();
    const broken = failingSink(new StorageError("the database is down"));
    const runId = newRunId();

    await expect(
      createFanOutTraceSink([broken, healthy]).write([makeEvent(runId, 0)]),
    ).rejects.toBeInstanceOf(StorageError);

    expect(healthy.events).toHaveLength(1);
  });

  it("reports the single failure unchanged when only one sink failed", async () => {
    const cause = new StorageError("the database is down");

    await expect(
      createFanOutTraceSink([createInMemoryTraceSink(), failingSink(cause)]).write([
        makeEvent(newRunId(), 0),
      ]),
    ).rejects.toBe(cause);
  });

  it("summarizes several failures, keeping the first as the cause", async () => {
    const first = new StorageError("sink one is down");
    const runId = newRunId();

    const error = await createFanOutTraceSink([failingSink(first), failingSink(new Error("two"))])
      .write([makeEvent(runId, 0), makeEvent(runId, 1)])
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).cause).toBe(first);
    // Identity only: the run and the range, never the batch's contents.
    expect((error as StorageError).details?.failed).toBe(2);
    expect((error as StorageError).details?.sinks).toBe(2);
    expect((error as StorageError).details?.runId).toBe(runId);
    expect((error as StorageError).details?.firstSequence).toBe(0);
    expect((error as StorageError).details?.lastSequence).toBe(1);
  });

  it("wraps a non-StorageError failure, so the writer above it sees the contract", async () => {
    const cause = new TypeError("a sink threw something else");

    const error = await createFanOutTraceSink([failingSink(cause)])
      .write([makeEvent(newRunId(), 0)])
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).cause).toBe(cause);
  });

  it("keeps the buffered writer's retry, which re-sends the batch to every sink", async () => {
    // The documented consequence of failing the write when any sink failed: a
    // retry re-sends to the sinks that already took it. That is why the
    // `TraceSink` contract requires tolerating a repeat.
    let attempts = 0;
    const healthy = createInMemoryTraceSink();
    const flaky: TraceSink = {
      write(): Promise<void> {
        attempts += 1;

        return attempts === 1
          ? Promise.reject(new StorageError("transient"))
          : Promise.resolve(undefined);
      },
    };

    const writer = createBufferedTraceWriter({
      sink: createFanOutTraceSink([healthy, flaky]),
    });
    const runId = newRunId();

    await writer.append(makeEvent(runId, 0));
    await writer.append(makeEvent(runId, 1));

    await expect(writer.flush()).rejects.toBeInstanceOf(StorageError);
    await writer.flush();

    expect(attempts).toBe(2);
    // The healthy sink saw the batch twice, in order both times. A durable sink
    // is idempotent on `(runId, sequence)`; the JSONL file is not, which is the
    // recorded trade.
    expect(healthy.batches).toHaveLength(2);
    expect(healthy.batches[0]?.map((event) => event.sequence)).toEqual([0, 1]);
    expect(healthy.batches[1]?.map((event) => event.sequence)).toEqual([0, 1]);
  });
});
