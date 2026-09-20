import {
  newRunId,
  newTraceEventId,
  type RunId,
  type Storage,
  StorageError,
  type TraceEvent,
  type TraceEventType,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { createBufferedTraceWriter } from "./buffered-trace-writer.js";
import { REDACTION_TOKEN_PREFIX } from "./redaction.js";
import { createStorageTraceSink } from "./storage-sink.js";

/**
 * `createStorageTraceSink()` (M2-T5): the sink that drains a run's trace into
 * a `Storage`.
 *
 * The storage here is a stub that records batches rather than a real
 * implementation, because what this file is about is the **sink's** behaviour:
 * that it forwards in order, that it redacts, that it skips an empty batch and
 * that a rejection comes back as a `StorageError`. Whether a real store then
 * persists correctly is `storage.contract.test.ts`'s question.
 */

interface StubStorage extends Storage {
  readonly batches: readonly (readonly TraceEvent[])[];
}

function createStubStorage(fail?: unknown): StubStorage {
  const batches: (readonly TraceEvent[])[] = [];

  const unused = (): never => {
    throw new Error("the storage sink must only call appendTraceEvents");
  };

  return {
    batches,
    appendTraceEvents(events: readonly TraceEvent[]): Promise<void> {
      if (fail !== undefined) {
        return Promise.reject(fail);
      }

      batches.push([...events]);

      return Promise.resolve();
    },
    saveJob: unused,
    startRun: unused,
    finishRun: unused,
    getRun: unused,
    getJob: unused,
    listRuns: unused,
    getTrace: unused,
  };
}

function makeEvent(
  runId: RunId,
  sequence: number,
  type: TraceEventType = "model.completed",
  payload: TraceEvent["payload"] = {},
): TraceEvent {
  return {
    id: newTraceEventId(),
    runId,
    attempt: 1,
    sequence,
    timestamp: new Date(Date.UTC(2026, 8, 19, 12, 0, sequence)).toISOString(),
    type,
    parentId: null,
    node: null,
    version: 1,
    behaviorFingerprint: null,
    payload,
    usage: null,
    latencyMs: null,
    error: null,
  };
}

describe("createStorageTraceSink", () => {
  it("forwards a batch to the storage in order", async () => {
    const storage = createStubStorage();
    const sink = createStorageTraceSink({ storage });
    const runId = newRunId();
    const events = [0, 1, 2].map((sequence) => makeEvent(runId, sequence));

    await sink.write(events);

    expect(storage.batches).toHaveLength(1);
    expect(storage.batches[0]?.map((event) => event.sequence)).toEqual([0, 1, 2]);
  });

  it("does not call the storage for an empty batch", async () => {
    const storage = createStubStorage();

    await createStorageTraceSink({ storage }).write([]);

    expect(storage.batches).toEqual([]);
  });

  it("redacts on the way in, so an unredacted payload cannot reach the store", async () => {
    // Belt and braces (ADR-0035): the writer chain redacts above the buffer,
    // and this is the last code before durability. A caller who assembles the
    // chain without the redacting writer still gets a redacted trace.
    const storage = createStubStorage();
    const runId = newRunId();
    const seeded = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");

    await createStorageTraceSink({ storage }).write([
      makeEvent(runId, 0, "tool.completed", { echoed: seeded }),
    ]);

    const written = JSON.stringify(storage.batches[0]);

    expect(written).not.toContain(seeded);
    expect(written).toContain(REDACTION_TOKEN_PREFIX);
  });

  it("redacting twice changes nothing, which is what makes the second pass free", async () => {
    const storage = createStubStorage();
    const runId = newRunId();
    const seeded = ["AKIA", "IOSFODNN7", "EXAMPLE"].join("");
    const sink = createStorageTraceSink({ storage });
    const event = makeEvent(runId, 0, "tool.completed", { echoed: seeded });

    await sink.write([event]);

    const once = storage.batches[0]?.[0];

    expect(once).toBeDefined();

    await sink.write([once as TraceEvent]);

    expect(JSON.stringify(storage.batches[1])).toBe(JSON.stringify(storage.batches[0]));
  });

  it("leaves the batch alone when redaction is turned off deliberately", async () => {
    const storage = createStubStorage();
    const runId = newRunId();
    const event = makeEvent(runId, 0);

    await createStorageTraceSink({ storage, redact: false }).write([event]);

    expect(storage.batches[0]?.[0]).toBe(event);
  });

  it("reports a storage failure as a StorageError with the cause preserved", async () => {
    const cause = new TypeError("the driver exploded");
    const sink = createStorageTraceSink({ storage: createStubStorage(cause) });

    const error = await sink.write([makeEvent(newRunId(), 0)]).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).cause).toBe(cause);
    // Identity only: the failure is diagnosable without the batch's contents
    // reaching an error message.
    expect((error as StorageError).details?.events).toBe(1);
    expect((error as StorageError).details?.firstSequence).toBe(0);
  });

  it("passes an existing StorageError through unchanged", async () => {
    const cause = new StorageError("the store said no");
    const sink = createStorageTraceSink({ storage: createStubStorage(cause) });

    await expect(sink.write([makeEvent(newRunId(), 0)])).rejects.toBe(cause);
  });

  it("works under the buffered writer, which keeps a failed batch and retries it", async () => {
    // The whole point of being a sink rather than a second writer: everything
    // the buffered writer guarantees keeps applying with no reimplementation.
    let attempts = 0;
    const batches: (readonly TraceEvent[])[] = [];
    const unused = (): never => {
      throw new Error("unused");
    };
    const storage: Storage = {
      appendTraceEvents(events: readonly TraceEvent[]): Promise<void> {
        attempts += 1;

        if (attempts === 1) {
          return Promise.reject(new StorageError("transient"));
        }

        batches.push([...events]);

        return Promise.resolve();
      },
      saveJob: unused,
      startRun: unused,
      finishRun: unused,
      getRun: unused,
      getJob: unused,
      listRuns: unused,
      getTrace: unused,
    };

    const writer = createBufferedTraceWriter({ sink: createStorageTraceSink({ storage }) });
    const runId = newRunId();

    await writer.append(makeEvent(runId, 0, "run.started"));
    await writer.append(makeEvent(runId, 1, "run.completed"));

    await expect(writer.flush()).rejects.toBeInstanceOf(StorageError);

    // The events stayed buffered, so the retry sends them again, in order.
    await writer.flush();

    expect(attempts).toBe(2);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((event) => event.sequence)).toEqual([0, 1]);
  });
});
