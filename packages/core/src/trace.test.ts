import { describe, expect, expectTypeOf, it } from "vitest";
import { serializeError, ToolExecutionError, ValidationError } from "./errors.js";
import { isEntityId, newRunId } from "./ids.js";
import type { JsonObject } from "./json.js";
import {
  createNoopTraceWriter,
  createTraceRecorder,
  isTraceEventType,
  parseTraceEvent,
  TRACE_EVENT_TYPES,
  TRACE_EVENT_VERSION,
  type TraceClock,
  type TraceEvent,
  type TraceEventType,
  type TraceWriter,
} from "./trace.js";

const RUN_ID = newRunId();

/** A writer that keeps what it was given, in the order it was given it. */
function createCollectingWriter(): TraceWriter & {
  readonly events: readonly TraceEvent[];
  readonly flushCount: number;
} {
  const events: TraceEvent[] = [];
  let flushCount = 0;

  return {
    events,
    get flushCount(): number {
      return flushCount;
    },
    append(event: TraceEvent): Promise<void> {
      events.push(event);
      return Promise.resolve();
    },
    flush(): Promise<void> {
      flushCount += 1;
      return Promise.resolve();
    },
  };
}

/** A clock that only moves when told to. */
function clockAt(iso: string): TraceClock & { advance(ms: number): void } {
  let now = Date.parse(iso);

  return {
    now: (): Date => new Date(now),
    advance(ms: number): void {
      now += ms;
    },
  };
}

function recorderWith(clock?: TraceClock): {
  readonly writer: ReturnType<typeof createCollectingWriter>;
  readonly recorder: ReturnType<typeof createTraceRecorder>;
} {
  const writer = createCollectingWriter();
  const recorder = createTraceRecorder({
    runId: RUN_ID,
    writer,
    ...(clock === undefined ? {} : { clock }),
  });

  return { writer, recorder };
}

describe("TRACE_EVENT_TYPES", () => {
  it("is the build plan's M2-T3 list plus run.aborted, and nothing else", () => {
    expect([...TRACE_EVENT_TYPES]).toEqual([
      "run.started",
      "run.completed",
      "run.failed",
      "run.aborted",
      "agent.started",
      "agent.completed",
      "agent.failed",
      "model.started",
      "model.completed",
      "model.failed",
      "tool.started",
      "tool.completed",
      "tool.failed",
      "decision.started",
      "decision.completed",
      "decision.failed",
      "node.started",
      "node.completed",
      "node.failed",
      "artifact.created",
      "approval.requested",
      "approval.resolved",
      "fallback.started",
      "fallback.completed",
      "eval.completed",
    ]);
  });

  it("names every member exactly once", () => {
    expect(new Set(TRACE_EVENT_TYPES).size).toBe(TRACE_EVENT_TYPES.length);
  });

  it("is the same closed set as the type", () => {
    expectTypeOf<TraceEventType>().toEqualTypeOf<(typeof TRACE_EVENT_TYPES)[number]>();
  });
});

describe("isTraceEventType", () => {
  it.each(TRACE_EVENT_TYPES)("accepts %s", (type) => {
    expect(isTraceEventType(type)).toBe(true);
  });

  it.each(["eve.step.completed", "run.cancelled", "", "RUN.STARTED", 7, null, undefined])(
    "rejects %p",
    (value) => {
      expect(isTraceEventType(value)).toBe(false);
    },
  );
});

describe("TraceWriter", () => {
  it("is the interface the build plan states for M2-T4, unchanged", () => {
    expectTypeOf<TraceWriter["append"]>().toEqualTypeOf<(event: TraceEvent) => Promise<void>>();
    expectTypeOf<TraceWriter["flush"]>().toEqualTypeOf<() => Promise<void>>();
  });
});

describe("createNoopTraceWriter", () => {
  it("accepts an event and resolves", async () => {
    const { recorder } = recorderWith();
    const event = await recorder.record({ type: "run.started" });

    await expect(createNoopTraceWriter().append(event)).resolves.toBeUndefined();
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

describe("createTraceRecorder: stamping", () => {
  it("fills every field the build plan requires on an event", async () => {
    const { recorder } = recorderWith(clockAt("2026-09-19T12:00:00.000Z"));

    const event = await recorder.record({
      type: "run.started",
      payload: { jobId: "job" },
    });

    expect(isEntityId(event.id)).toBe(true);
    expect(event.runId).toBe(RUN_ID);
    expect(event.attempt).toBe(1);
    expect(event.sequence).toBe(0);
    expect(event.timestamp).toBe("2026-09-19T12:00:00.000Z");
    expect(event.type).toBe("run.started");
    expect(event.parentId).toBeNull();
    expect(event.node).toBeNull();
    expect(event.version).toBe(TRACE_EVENT_VERSION);
    expect(event.behaviorFingerprint).toBeNull();
    expect(event.payload).toEqual({ jobId: "job" });
    expect(event.usage).toBeNull();
    expect(event.latencyMs).toBeNull();
    expect(event.error).toBeNull();
  });

  it("is assignable to JsonObject, so it stores and serializes with no conversion", async () => {
    const { recorder } = recorderWith();
    const event = await recorder.record({ type: "run.started" });
    const asJson: JsonObject = event;

    expect(JSON.parse(JSON.stringify(asJson))).toMatchObject({ type: "run.started" });
  });

  it("stamps the attempt and the behavior fingerprint it was constructed with", async () => {
    const writer = createCollectingWriter();
    const recorder = createTraceRecorder({
      runId: RUN_ID,
      writer,
      attempt: 3,
      behaviorFingerprint: "sha256:abc",
    });

    const event = await recorder.record({ type: "run.started" });

    expect(event.attempt).toBe(3);
    expect(event.behaviorFingerprint).toBe("sha256:abc");
  });

  it("mints a distinct, sortable id per event", async () => {
    const { recorder } = recorderWith();

    const first = await recorder.record({ type: "run.started" });
    const second = await recorder.record({ type: "run.completed" });

    expect(first.id).not.toBe(second.id);
    expect(first.id < second.id).toBe(true);
  });

  it("prefers a supplied timestamp over its clock, the way an adapter needs", async () => {
    const { recorder } = recorderWith(clockAt("2026-09-19T12:00:00.000Z"));

    const event = await recorder.record({
      type: "model.started",
      timestamp: "2026-09-19T11:59:59.250Z",
    });

    expect(event.timestamp).toBe("2026-09-19T11:59:59.250Z");
  });

  it("carries usage, latency and a trace-safe error when they are given", async () => {
    const { recorder } = recorderWith();
    const error = serializeError(new ToolExecutionError("nope", { toolId: "lookup" }));

    const event = await recorder.record({
      type: "tool.failed",
      usage: { toolCalls: 1 },
      latencyMs: 12,
      error,
    });

    expect(event.usage).toEqual({ toolCalls: 1 });
    expect(event.latencyMs).toBe(12);
    expect(event.error?.code).toBe("TOOL_EXECUTION");
    expect(event.error?.stack).toBeUndefined();
  });

  it("freezes what it wrote, because a trace is append-only", async () => {
    const { recorder } = recorderWith();
    const event = await recorder.record({ type: "run.started" });

    expect(Object.isFrozen(event)).toBe(true);
  });
});

describe("createTraceRecorder: ordering", () => {
  it("numbers a run's events from 0, strictly increasing, whoever records them", async () => {
    const { writer, recorder } = recorderWith();

    // The harness records the run boundary; the "adapter" records what happened
    // inside it. In M1 these were two counters and both started at 0.
    await recorder.record({ type: "run.started" });
    const agent = await recorder.span({ type: "agent.started", parentId: recorder.rootId });
    await recorder.record({ type: "model.started", parentId: agent.id });
    await recorder.record({ type: "model.completed", parentId: agent.id });
    await agent.end({ type: "agent.completed" });
    await recorder.record({ type: "run.completed" });

    expect(writer.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(writer.events.map((event) => event.type)).toEqual([
      "run.started",
      "agent.started",
      "model.started",
      "model.completed",
      "agent.completed",
      "run.completed",
    ]);
  });

  it("reaches the writer in sequence order even when callers record concurrently", async () => {
    const writer = createCollectingWriter();
    let delay = 40;
    const slowFirst: TraceWriter = {
      append(event: TraceEvent): Promise<void> {
        const wait = delay;
        delay = 0;
        return new Promise((resolve) => {
          setTimeout(() => {
            void writer.append(event).then(resolve);
          }, wait);
        });
      },
      flush: () => Promise.resolve(),
    };
    const recorder = createTraceRecorder({ runId: RUN_ID, writer: slowFirst });

    await Promise.all([
      recorder.record({ type: "run.started" }),
      recorder.record({ type: "model.started" }),
      recorder.record({ type: "model.completed" }),
    ]);

    expect(writer.events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(writer.events.map((event) => event.type)).toEqual([
      "run.started",
      "model.started",
      "model.completed",
    ]);
  });

  it("keeps counting after a writer rejects, rather than poisoning the run", async () => {
    const events: TraceEvent[] = [];
    let failNext = true;
    const flaky: TraceWriter = {
      append(event: TraceEvent): Promise<void> {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error("disk full"));
        }
        events.push(event);
        return Promise.resolve();
      },
      flush: () => Promise.resolve(),
    };
    const recorder = createTraceRecorder({ runId: RUN_ID, writer: flaky });

    await expect(recorder.record({ type: "run.started" })).rejects.toThrow("disk full");
    const second = await recorder.record({ type: "run.completed" });

    expect(second.sequence).toBe(1);
    expect(events).toHaveLength(1);
  });

  it("reports the run's root and its last event", async () => {
    const { recorder } = recorderWith();

    expect(recorder.rootId).toBeNull();
    expect(recorder.lastEventId).toBeNull();
    expect(recorder.recorded).toBe(0);

    const started = await recorder.record({ type: "run.started" });
    const model = await recorder.record({ type: "model.started" });

    expect(recorder.rootId).toBe(started.id);
    expect(recorder.lastEventId).toBe(model.id);
    expect(recorder.recorded).toBe(2);
  });

  it("keeps the first run.started as the root", async () => {
    const { recorder } = recorderWith();

    const first = await recorder.record({ type: "run.started" });
    await recorder.record({ type: "run.started" });

    expect(recorder.rootId).toBe(first.id);
  });
});

describe("createTraceRecorder: spans", () => {
  it("closes a span against its start event and measures the elapsed time", async () => {
    const clock = clockAt("2026-09-19T12:00:00.000Z");
    const { recorder } = recorderWith(clock);

    const span = await recorder.span({ type: "tool.started", payload: { tool: "lookup" } });
    clock.advance(250);
    const ended = await span.end({ type: "tool.completed" });

    expect(span.event.latencyMs).toBeNull();
    expect(ended.parentId).toBe(span.id);
    expect(ended.latencyMs).toBe(250);
  });

  it("measures from the timestamps an adapter supplies, not from the clock", async () => {
    const { recorder } = recorderWith(clockAt("2026-09-19T12:00:00.000Z"));

    const span = await recorder.span({
      type: "model.started",
      timestamp: "2026-09-19T11:00:00.000Z",
    });
    const ended = await span.end({
      type: "model.completed",
      timestamp: "2026-09-19T11:00:01.500Z",
    });

    expect(ended.latencyMs).toBe(1_500);
  });

  it("prefers an explicitly supplied latency", async () => {
    const clock = clockAt("2026-09-19T12:00:00.000Z");
    const { recorder } = recorderWith(clock);

    const span = await recorder.span({ type: "model.started" });
    clock.advance(1_000);

    expect((await span.end({ type: "model.completed", latencyMs: 7 })).latencyMs).toBe(7);
  });

  it("reports no latency rather than a negative one when time ran backwards", async () => {
    const { recorder } = recorderWith();

    const span = await recorder.span({
      type: "model.started",
      timestamp: "2026-09-19T12:00:05.000Z",
    });
    const ended = await span.end({
      type: "model.failed",
      timestamp: "2026-09-19T12:00:00.000Z",
    });

    expect(ended.latencyMs).toBeNull();
  });

  it("nests: a model span inside an agent span inside the run", async () => {
    const { recorder } = recorderWith();

    await recorder.record({ type: "run.started" });
    const agent = await recorder.span({ type: "agent.started", parentId: recorder.rootId });
    const model = await recorder.span({ type: "model.started", parentId: agent.id });
    const modelEnd = await model.end({ type: "model.completed" });
    const agentEnd = await agent.end({ type: "agent.completed" });

    expect(agent.event.parentId).toBe(recorder.rootId);
    expect(model.event.parentId).toBe(agent.id);
    expect(modelEnd.parentId).toBe(model.id);
    expect(agentEnd.parentId).toBe(agent.id);
  });
});

describe("createTraceRecorder: rejections", () => {
  it("rejects an event type outside the closed taxonomy", async () => {
    const { recorder } = recorderWith();

    await expect(
      recorder.record({ type: "eve.step.completed" as TraceEventType }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects attempt %p at construction", (attempt) => {
    expect(() =>
      createTraceRecorder({ runId: RUN_ID, writer: createNoopTraceWriter(), attempt }),
    ).toThrow(ValidationError);
  });
});

describe("createTraceRecorder: flush", () => {
  it("forwards to the writer", async () => {
    const { writer, recorder } = recorderWith();

    await recorder.flush();
    await recorder.flush();

    expect(writer.flushCount).toBe(2);
  });

  it("propagates a writer's flush failure rather than swallowing it", async () => {
    const recorder = createTraceRecorder({
      runId: RUN_ID,
      writer: {
        append: () => Promise.resolve(),
        flush: () => Promise.reject(new Error("the sink is gone")),
      },
    });

    await expect(recorder.flush()).rejects.toThrow("the sink is gone");
  });
});

describe("parseTraceEvent", () => {
  /** A real recorded event, so the round trip starts from what the harness writes. */
  async function recordOne(
    input: Parameters<ReturnType<typeof createTraceRecorder>["record"]>[0] = {
      type: "run.started",
      payload: { jobId: "j" },
    },
  ): Promise<TraceEvent> {
    const recorder = createTraceRecorder({
      runId: RUN_ID,
      writer: createNoopTraceWriter(),
      behaviorFingerprint: "sha256:abc",
    });

    return await recorder.record(input);
  }

  it("round-trips a recorded event through JSON unchanged", async () => {
    const recorded = await recordOne();

    const parsed = parseTraceEvent(JSON.parse(JSON.stringify(recorded)));

    expect(parsed).toEqual(recorded);
  });

  it("round-trips an event carrying usage, latency and an error", async () => {
    const recorder = createTraceRecorder({ runId: RUN_ID, writer: createNoopTraceWriter() });
    const started = await recorder.span({ type: "model.started" });
    const recorded = await started.end({
      type: "model.failed",
      payload: { modelId: "harness-fixture" },
      usage: { modelCalls: 1, inputTokens: 12, outputTokens: 3, costUsd: 0.0004 },
      latencyMs: 41,
      error: serializeError(new ToolExecutionError("nope", { toolId: "echo" })),
    });

    const parsed = parseTraceEvent(JSON.parse(JSON.stringify(recorded)));

    expect(parsed).toEqual(recorded);
    expect(parsed.usage).toEqual({
      modelCalls: 1,
      inputTokens: 12,
      outputTokens: 3,
      costUsd: 0.0004,
    });
    expect(parsed.error?.code).toBe("TOOL_EXECUTION");
  });

  it("returns a deep-frozen event", async () => {
    const parsed = parseTraceEvent(JSON.parse(JSON.stringify(await recordOne())));

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.payload)).toBe(true);
  });

  it("rejects a type outside the closed taxonomy", async () => {
    const event = { ...JSON.parse(JSON.stringify(await recordOne())), type: "eve.turn.started" };

    expect(() => parseTraceEvent(event)).toThrow(ValidationError);
    expect(() => parseTraceEvent(event)).toThrow(/is not a trace event/);
  });

  it.each([-1, 1.5, "0", null])("rejects sequence %p", async (sequence) => {
    const event = { ...JSON.parse(JSON.stringify(await recordOne())), sequence };

    expect(() => parseTraceEvent(event)).toThrow(ValidationError);
  });

  it("rejects an unknown field rather than dropping it", async () => {
    const event = { ...JSON.parse(JSON.stringify(await recordOne())), spanId: "sp_1" };

    try {
      parseTraceEvent(event);
      expect.unreachable("expected parseTraceEvent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues).toContainEqual({
        path: ["spanId"],
        message: "unknown field",
      });
    }
  });

  it("reports every failing field at once, each with its path", async () => {
    const event = {
      ...JSON.parse(JSON.stringify(await recordOne())),
      type: "not.a.type",
      sequence: -3,
      payload: "text",
    };

    try {
      parseTraceEvent(event);
      expect.unreachable("expected parseTraceEvent to throw");
    } catch (error) {
      const paths = (error as ValidationError).issues.map((issue) => issue.path.join("."));

      expect(paths).toEqual(expect.arrayContaining(["type", "sequence", "payload"]));
    }
  });

  it("rejects a value that is not an object at all", () => {
    expect(() => parseTraceEvent("run.started")).toThrow(ValidationError);
    expect(() => parseTraceEvent(null)).toThrow(ValidationError);
  });

  it("prefixes issue paths with the caller's path", async () => {
    const event = { ...JSON.parse(JSON.stringify(await recordOne())), sequence: -1 };

    try {
      parseTraceEvent(event, ["events", 3]);
      expect.unreachable("expected parseTraceEvent to throw");
    } catch (error) {
      expect((error as ValidationError).issues).toContainEqual({
        path: ["events", 3, "sequence"],
        message: "expected an integer >= 0",
      });
    }
  });

  it("reads a version it does not know rather than asserting the current one", async () => {
    const event = { ...JSON.parse(JSON.stringify(await recordOne())), version: 2 };

    expect(parseTraceEvent(event).version).toBe(2);
    expect(TRACE_EVENT_VERSION).toBe(1);
  });

  it("rejects a usage object with an unknown key or a non-numeric value", async () => {
    const base = JSON.parse(JSON.stringify(await recordOne())) as JsonObject;

    expect(() => parseTraceEvent({ ...base, usage: { totalTokens: 4 } })).toThrow(ValidationError);
    expect(() => parseTraceEvent({ ...base, usage: { inputTokens: "4" } })).toThrow(
      ValidationError,
    );
  });

  it("accepts a null parentId, node, usage, latency and error", async () => {
    const parsed = parseTraceEvent(JSON.parse(JSON.stringify(await recordOne())));

    expect(parsed.parentId).toBeNull();
    expect(parsed.node).toBeNull();
    expect(parsed.usage).toBeNull();
    expect(parsed.latencyMs).toBeNull();
    expect(parsed.error).toBeNull();
  });
});
