import {
  createNoopTraceWriter,
  createTraceRecorder,
  newRunId,
  StorageError,
  type TraceEvent,
  type TraceEventType,
  ValidationError,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { createBufferedTraceWriter, DEFAULT_MAX_BUFFERED_EVENTS } from "./buffered-trace-writer.js";
import { createInMemoryTraceSink, type TraceSink } from "./sink.js";

const recorder = createTraceRecorder({ runId: newRunId(), writer: createNoopTraceWriter() });

/** A real event, stamped the way a run stamps one. */
async function event(type: TraceEventType = "run.started"): Promise<TraceEvent> {
  return await recorder.record({ type });
}

/** A sink that rejects until it is told to stop. */
function createFlakySink(): TraceSink & {
  readonly written: readonly TraceEvent[];
  fail(reason: string): void;
  recover(): void;
} {
  const written: TraceEvent[] = [];
  let failure: string | undefined;

  return {
    written,
    fail(reason: string): void {
      failure = reason;
    },
    recover(): void {
      failure = undefined;
    },
    write(events: readonly TraceEvent[]): Promise<void> {
      if (failure !== undefined) {
        return Promise.reject(new Error(failure));
      }

      written.push(...events);
      return Promise.resolve();
    },
  };
}

describe("createBufferedTraceWriter: buffering", () => {
  it("buffers appends and writes nothing until it is flushed", async () => {
    const sink = createInMemoryTraceSink();
    const writer = createBufferedTraceWriter({ sink });

    await writer.append(await event("run.started"));
    await writer.append(await event("agent.started"));

    expect(sink.events).toEqual([]);
    expect(writer.bufferedEvents).toBe(2);

    await writer.flush();

    expect(sink.events.map((written) => written.type)).toEqual(["run.started", "agent.started"]);
    expect(writer.bufferedEvents).toBe(0);
  });

  it("drains one batch per flush, preserving append order", async () => {
    const sink = createInMemoryTraceSink();
    const writer = createBufferedTraceWriter({ sink });

    await writer.append(await event("run.started"));
    await writer.append(await event("model.started"));
    await writer.flush();
    await writer.append(await event("model.completed"));
    await writer.flush();

    expect(sink.batches.map((batch) => batch.map((written) => written.type))).toEqual([
      ["run.started", "model.started"],
      ["model.completed"],
    ]);
  });

  it("does not call the sink when there is nothing buffered", async () => {
    const sink = createInMemoryTraceSink();
    const writer = createBufferedTraceWriter({ sink });

    await writer.flush();
    await writer.flush();

    expect(sink.batches).toEqual([]);
  });

  it("auto-flushes once the buffer reaches maxBufferedEvents", async () => {
    const sink = createInMemoryTraceSink();
    const writer = createBufferedTraceWriter({ sink, maxBufferedEvents: 2 });

    await writer.append(await event("run.started"));
    expect(sink.events).toHaveLength(0);

    await writer.append(await event("agent.started"));

    expect(sink.events).toHaveLength(2);
    expect(writer.bufferedEvents).toBe(0);
  });

  it("buffers a whole ordinary run by default", () => {
    // The default exists so a short run flushes exactly once, at the end.
    expect(DEFAULT_MAX_BUFFERED_EVENTS).toBe(256);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects maxBufferedEvents %p", (maxBufferedEvents) => {
    expect(() =>
      createBufferedTraceWriter({ sink: createInMemoryTraceSink(), maxBufferedEvents }),
    ).toThrow(ValidationError);
  });
});

describe("createBufferedTraceWriter: ordering under concurrency", () => {
  it("serializes concurrent flushes instead of interleaving them", async () => {
    const sink = createInMemoryTraceSink();
    let inFlight = 0;
    let overlapped = false;
    const slow: TraceSink = {
      async write(events: readonly TraceEvent[]): Promise<void> {
        inFlight += 1;
        overlapped ||= inFlight > 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        await sink.write(events);
        inFlight -= 1;
      },
    };
    const writer = createBufferedTraceWriter({ sink: slow });

    await writer.append(await event("run.started"));
    const first = writer.flush();
    await writer.append(await event("model.started"));
    const second = writer.flush();

    await Promise.all([first, second]);

    expect(overlapped).toBe(false);
    expect(sink.events.map((written) => written.type)).toEqual(["run.started", "model.started"]);
    expect(writer.bufferedEvents).toBe(0);
  });

  it("writes events appended while a flush is in flight, in the same flush", async () => {
    const sink = createInMemoryTraceSink();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstWrite = true;
    const gated: TraceSink = {
      async write(events: readonly TraceEvent[]): Promise<void> {
        if (firstWrite) {
          firstWrite = false;
          await gate;
        }
        await sink.write(events);
      },
    };
    const writer = createBufferedTraceWriter({ sink: gated });

    await writer.append(await event("run.started"));
    const flushing = writer.flush();
    await writer.append(await event("agent.started"));
    release?.();
    await flushing;

    expect(sink.events.map((written) => written.type)).toEqual(["run.started", "agent.started"]);
    expect(writer.bufferedEvents).toBe(0);
  });
});

describe("createBufferedTraceWriter: failure", () => {
  it("reports a sink failure as a StorageError that keeps its cause", async () => {
    const sink = createFlakySink();
    sink.fail("the disk is full");
    const writer = createBufferedTraceWriter({ sink });

    await writer.append(await event("run.started"));

    await expect(writer.flush()).rejects.toBeInstanceOf(StorageError);

    try {
      await writer.flush();
      expect.unreachable("flush should have rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe("STORAGE");
      expect((error as StorageError).cause).toBeInstanceOf(Error);
      expect((error as StorageError).details).toMatchObject({ bufferedEvents: 1 });
    }
  });

  it("keeps the events buffered, so a later flush writes them in the same order", async () => {
    const sink = createFlakySink();
    sink.fail("the sink is offline");
    const writer = createBufferedTraceWriter({ sink });

    await writer.append(await event("run.started"));
    await writer.append(await event("agent.started"));
    await expect(writer.flush()).rejects.toBeInstanceOf(StorageError);

    // Nothing was dropped and nothing was written.
    expect(writer.bufferedEvents).toBe(2);
    expect(sink.written).toEqual([]);

    await writer.append(await event("run.completed"));
    sink.recover();
    await writer.flush();

    expect(sink.written.map((written) => written.type)).toEqual([
      "run.started",
      "agent.started",
      "run.completed",
    ]);
    expect(writer.bufferedEvents).toBe(0);
  });

  it("does not poison later flushes after one rejects", async () => {
    const sink = createFlakySink();
    const writer = createBufferedTraceWriter({ sink });

    await writer.append(await event("run.started"));
    sink.fail("transient");
    await expect(writer.flush()).rejects.toBeInstanceOf(StorageError);

    sink.recover();

    await expect(writer.flush()).resolves.toBeUndefined();
    expect(sink.written).toHaveLength(1);
  });

  it("propagates the failure out of an auto-flushing append", async () => {
    const sink = createFlakySink();
    sink.fail("the disk is full");
    const writer = createBufferedTraceWriter({ sink, maxBufferedEvents: 1 });

    await expect(writer.append(await event("run.started"))).rejects.toBeInstanceOf(StorageError);
  });
});
