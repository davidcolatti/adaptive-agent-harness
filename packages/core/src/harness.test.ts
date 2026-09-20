import { describe, expect, expectTypeOf, it } from "vitest";
import type { AgentExecution, AgentExecutionUsage, AgentRuntime } from "./agent-runtime.js";
import type { ExecutionContext, RuntimeInfo } from "./context.js";
import { HARNESS_RUNTIME_INFO } from "./context.js";
import { defineDomain } from "./domain.js";
import { StorageError, ValidationError } from "./errors.js";
import { type Clock, createHarness, type HarnessRunResult } from "./harness.js";
import { isEntityId, newJobId, newRunId } from "./ids.js";
import type { Job } from "./job.js";
import { parseJob } from "./job.js";
import type { Schema, SchemaResult } from "./schema.js";
import { TRACE_EVENT_VERSION, type TraceEvent, type TraceWriter } from "./trace.js";

/**
 * The test doubles below are **deliberately local to this file**, rather than
 * `createFakeAgentRuntime`, `createFakeClock` and `createRecordingTraceWriter`
 * from `@internal/testing`.
 *
 * `@internal/testing` depends on `@internal/core` for its types, so a
 * dependency in the other direction — even a `devDependencies` one used only by
 * this file — makes the workspace graph cyclic. pnpm warns about that on every
 * install, and turbo refuses the resulting `build` task cycle outright unless
 * this package overrides the root task definition. Neither cost is worth saving
 * the sixty lines below, and `@internal/testing` remains the canonical home for
 * fakes that consuming packages and applications share:
 * `apps/example-agent/src/domain/harness.test.ts` runs the same harness against
 * the real domain using exactly those helpers, which is the direction the
 * dependency rule already allows.
 *
 * They live inline rather than in a sibling module because
 * `tsconfig.build.json` excludes `src/**\/*.test.ts` and nothing else, so this
 * file is already outside the build and a new one would need a new exclusion
 * rule. Nothing here is exported from the barrel.
 */

/** One recorded `run` call. */
interface RecordedCall {
  readonly job: Job;
  readonly context: ExecutionContext;
}

/** A scripted {@link AgentRuntime} that records what it was asked to do. */
interface LocalAgentRuntime extends AgentRuntime {
  readonly calls: readonly RecordedCall[];
}

interface LocalAgentRuntimeOptions {
  /** Resolve with this execution. Mutually exclusive with `handler`. */
  readonly result?: AgentExecution;
  /** Compute the execution from the job and context. */
  readonly handler?: (job: Job, context: ExecutionContext) => AgentExecution;
  /**
   * How long the run pretends to take before the handler is consulted. This is
   * the window a cancellation can land in, which is how a test proves the
   * signal reached the runtime.
   */
  readonly delayMs?: number;
  /** What the runtime reports about itself. */
  readonly runtime?: RuntimeInfo;
}

const LOCAL_RUNTIME: RuntimeInfo = { name: "local-fake", version: "0.0.0", metadata: {} };

/**
 * Resolve `true` if `signal` aborts within `delayMs`, `false` if the delay
 * elapses first. A real timer, because a fake clock schedules nothing and the
 * run would never resume; the timer and the listener are both cleaned up on
 * whichever branch wins.
 */
function raceAbort(signal: AbortSignal, delayMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createLocalAgentRuntime(options: LocalAgentRuntimeOptions): LocalAgentRuntime {
  const calls: RecordedCall[] = [];
  const runtimeInfo = options.runtime ?? LOCAL_RUNTIME;
  const delayMs = options.delayMs ?? 0;

  const aborted: AgentExecution = {
    status: "aborted",
    usage: { modelCalls: 0, toolCalls: 0, durationMs: 0 },
    runtime: runtimeInfo,
  };

  return {
    calls,
    async run<TInput, TOutput>(
      job: Job<TInput, TOutput>,
      context: ExecutionContext,
    ): Promise<AgentExecution<TOutput>> {
      calls.push({ job, context });

      if (context.signal.aborted) {
        return aborted as AgentExecution<TOutput>;
      }

      if (delayMs > 0 && (await raceAbort(context.signal, delayMs))) {
        return aborted as AgentExecution<TOutput>;
      }

      const execution =
        options.handler === undefined
          ? (options.result as AgentExecution)
          : options.handler(job, context);

      return execution as AgentExecution<TOutput>;
    },
  };
}

/** A {@link TraceWriter} that keeps what was written to it. */
interface LocalTraceWriter extends TraceWriter {
  readonly events: readonly TraceEvent[];
  types(): readonly string[];
  readonly flushCount: number;
}

function createLocalTraceWriter(): LocalTraceWriter {
  const events: TraceEvent[] = [];
  let flushCount = 0;

  return {
    events,
    types: (): readonly string[] => events.map((event) => event.type),
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

/** A {@link Clock} that starts at `iso` and only moves when told to. */
interface LocalClock extends Clock {
  advance(ms: number): void;
}

function clockAt(iso: string): LocalClock {
  let currentMs = new Date(iso).getTime();

  return {
    now: (): Date => new Date(currentMs),
    advance(ms: number): void {
      currentMs += ms;
    },
  };
}

/**
 * Hand-written Standard Schemas. `@internal/core` has no schema library and
 * must keep none, so these are the smallest conforming objects that can accept
 * and reject. `apps/example-agent/src/domain/harness.test.ts` runs the same
 * harness against real `zod` schemas and the real vendor-triage domain.
 */
function objectSchema<T>(check: (value: unknown) => value is T, message: string): Schema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown): SchemaResult<T> =>
        check(value) ? { value } : { issues: [{ message, path: [] }] },
    },
  };
}

interface TriageInput {
  readonly vendorName: string;
}

interface TriageOutput {
  readonly category: string;
}

const inputSchema = objectSchema<TriageInput>(
  (value): value is TriageInput =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { vendorName?: unknown }).vendorName === "string",
  "expected `{ vendorName: string }`",
);

const outputSchema = objectSchema<TriageOutput>(
  (value): value is TriageOutput =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { category?: unknown }).category === "string",
  "expected `{ category: string }`",
);

const triage = defineDomain<TriageInput, TriageOutput>({
  id: "triage",
  version: "1.0.0",
  inputSchema,
  outputSchema,
  createJob(input) {
    return {
      jobType: "triage",
      objective: `Triage ${input.vendorName}.`,
      input,
      contracts: {
        inputSchema: "triage.input@1.0.0",
        outputSchema: "triage.output@1.0.0",
        sop: "triage-sop",
      },
      budget: { maxModelCalls: 4, maxToolCalls: 4 },
      permissions: [{ toolId: "lookup", mode: "read" }],
      metadata: { fixture: true },
    };
  },
});

const USAGE: AgentExecutionUsage = { modelCalls: 2, toolCalls: 1, durationMs: 7, costUsd: 0.01 };
const RUNTIME: RuntimeInfo = { name: "fake", version: "0.0.0", metadata: { scripted: true } };

function completedWith(output: unknown): AgentExecution {
  return { status: "completed", output, usage: USAGE, runtime: RUNTIME };
}

describe("createHarness", () => {
  it("rejects an agent runtime that does not implement `run`", () => {
    expect(() =>
      createHarness({
        agentRuntime: {} as unknown as Parameters<typeof createHarness>[0]["agentRuntime"],
      }),
    ).toThrow(ValidationError);
  });
});

describe("harness.run: the happy path", () => {
  it("validates the input, runs the job and returns the validated output", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const harness = createHarness({ agentRuntime });

    const result = await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      expect.unreachable("expected a completed result");
    }

    expectTypeOf(result.output).toEqualTypeOf<TriageOutput>();
    expect(result.output).toEqual({ category: "bookkeeping" });
    expect(result.usage).toEqual(USAGE);
    expect(result.runtime).toEqual(RUNTIME);
    expect(result.attempt).toBe(1);
    expect(result.domain).toEqual({ id: "triage", version: "1.0.0" });
    expect(result.runId).not.toBe(result.jobId);
    // M2-T1: both ids are minted in the sortable UUIDv7 scheme, at the two real
    // call sites (`createHarness` for the run, `defineDomain` for the job).
    expect(isEntityId(result.runId)).toBe(true);
    expect(isEntityId(result.jobId)).toBe(true);
  });

  it("hands the runtime the job the domain built, and a context describing it", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "freight" }),
    });
    const harness = createHarness({ agentRuntime });

    const result = await harness.run({ domain: triage, input: { vendorName: "Cobalt" } });
    const call = agentRuntime.calls[0];

    expect(agentRuntime.calls).toHaveLength(1);
    expect(call?.job.id).toBe(result.jobId);
    expect(call?.job.jobType).toBe("triage");
    expect(call?.job.input).toEqual({ vendorName: "Cobalt" });
    expect(call?.context.runId).toBe(result.runId);
    expect(call?.context.jobId).toBe(result.jobId);
    expect(call?.context.attempt).toBe(1);
    expect(call?.context.budget).toEqual({ maxModelCalls: 4, maxToolCalls: 4 });
    expect(call?.context.permissions).toEqual([{ toolId: "lookup", mode: "read" }]);
    // The harness does not know which adapter will run the job, so the context
    // says the harness is orchestrating and the adapter names itself in the
    // execution it returns.
    expect(call?.context.runtime).toEqual(HARNESS_RUNTIME_INFO);
    expect(result.runtime).toEqual(RUNTIME);
  });
});

describe("harness.run: validation", () => {
  it("throws a ValidationError for invalid input and never reaches the runtime", async () => {
    const agentRuntime = createLocalAgentRuntime({ result: completedWith({ category: "x" }) });
    const harness = createHarness({ agentRuntime });

    await expect(
      harness.run({
        domain: triage,
        input: { vendorName: 42 } as unknown as TriageInput,
      }),
    ).rejects.toThrow(ValidationError);

    expect(agentRuntime.calls).toHaveLength(0);
  });

  it("names the domain in the input validation message", async () => {
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "x" }) }),
    });

    await expect(
      harness.run({ domain: triage, input: {} as unknown as TriageInput }),
    ).rejects.toThrow("triage job input failed validation");
  });

  it("fails closed when the runtime returns an output the schema rejects", async () => {
    const agentRuntime = createLocalAgentRuntime({ result: completedWith({ category: 1 }) });
    const trace = createLocalTraceWriter();
    const harness = createHarness({ agentRuntime, trace });

    const result = await harness.run({ domain: triage, input: { vendorName: "Tessellate" } });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      expect.unreachable("expected a failed result");
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.message).toContain("triage agent output failed validation");
    // The invalid value is not reachable: `failed` has no `output` field at all.
    expect(Object.hasOwn(result, "output")).toBe(false);
    // Usage is still reported: the attempt cost something even though it failed.
    expect(result.usage).toEqual(USAGE);
    expect(trace.types()).toEqual(["run.started", "run.failed"]);
  });
});

describe("harness.run: failure and abort", () => {
  it("passes a runtime-reported failure through", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: {
        status: "failed",
        error: { name: "ToolExecutionError", code: "TOOL_EXECUTION", message: "the tool failed" },
        usage: USAGE,
        runtime: RUNTIME,
      },
    });
    const harness = createHarness({ agentRuntime });

    const result = await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      expect.unreachable("expected a failed result");
    }
    expect(result.error.code).toBe("TOOL_EXECUTION");
  });

  it("contains a runtime that throws, reporting it as an agent execution failure", async () => {
    const agentRuntime = createLocalAgentRuntime({
      handler: () => {
        throw new TypeError("the adapter is broken");
      },
    });
    const trace = createLocalTraceWriter();
    const harness = createHarness({ agentRuntime, trace, clock: clockAt("2026-09-19T12:00:00Z") });

    const result = await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      expect.unreachable("expected a failed result");
    }

    expect(result.error.code).toBe("AGENT_EXECUTION");
    expect(result.error.cause?.name).toBe("TypeError");
    expect(result.error.cause?.message).toBe("the adapter is broken");
    expect(result.usage).toEqual({ modelCalls: 0, toolCalls: 0, durationMs: 0 });
    expect(trace.types()).toEqual(["run.started", "run.failed"]);
  });

  it("reports `aborted` when the signal fires during the run, and the runtime saw that signal", async () => {
    const controller = new AbortController();
    const agentRuntime = createLocalAgentRuntime({
      delayMs: 50,
      result: completedWith({ category: "never reached" }),
    });
    const harness = createHarness({ agentRuntime });

    const pending = harness.run({
      domain: triage,
      input: { vendorName: "Northwind" },
      signal: controller.signal,
    });

    // Wait until the runtime has actually been entered before aborting. The
    // harness validates the input first, and that `await` alone is enough for
    // a synchronous `abort()` here to land in the pre-run short-circuit
    // instead, which is a different code path (covered by the next test).
    while (agentRuntime.calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    controller.abort();
    const result = await pending;

    expect(result.status).toBe("aborted");
    expect(agentRuntime.calls).toHaveLength(1);
    expect(agentRuntime.calls[0]?.context.signal).toBe(controller.signal);
    expect(agentRuntime.calls[0]?.context.signal.aborted).toBe(true);
  });

  it("short-circuits an already-aborted signal without calling the runtime", async () => {
    const agentRuntime = createLocalAgentRuntime({ result: completedWith({ category: "x" }) });
    const trace = createLocalTraceWriter();
    const harness = createHarness({ agentRuntime, trace });

    const result = await harness.run({
      domain: triage,
      input: { vendorName: "Northwind" },
      signal: AbortSignal.abort(),
    });

    expect(result.status).toBe("aborted");
    expect(agentRuntime.calls).toHaveLength(0);
    expect(result.usage).toEqual({ modelCalls: 0, toolCalls: 0, durationMs: 0 });
    expect(result.runtime).toEqual(HARNESS_RUNTIME_INFO);
    expect(trace.types()).toEqual(["run.started", "run.aborted"]);
  });
});

describe("harness.run: tracing", () => {
  it("emits run.started then exactly one terminal event, numbered from 0, and flushes", async () => {
    const trace = createLocalTraceWriter();
    const clock = clockAt("2026-09-19T12:00:00.000Z");
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "bookkeeping" }) }),
      trace,
      clock,
    });

    const result = await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    expect(trace.types()).toEqual(["run.started", "run.completed"]);
    expect(trace.events.map((event) => event.sequence)).toEqual([0, 1]);
    expect(trace.events.every((event) => event.runId === result.runId)).toBe(true);
    expect(trace.events.map((event) => event.timestamp)).toEqual([
      "2026-09-19T12:00:00.000Z",
      "2026-09-19T12:00:00.000Z",
    ]);
    expect(trace.events[0]?.payload).toEqual({
      jobId: result.jobId,
      domain: "triage",
      domainVersion: "1.0.0",
      jobType: "triage",
      attempt: 1,
    });
    expect(trace.flushCount).toBe(1);
  });

  it("fills the M2-T3 fields on every run event", async () => {
    const trace = createLocalTraceWriter();
    const clock = clockAt("2026-09-19T12:00:00.000Z");
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({
        handler: () => {
          clock.advance(400);
          return completedWith({ category: "bookkeeping" });
        },
      }),
      trace,
      clock,
    });

    const result = await harness.run({ domain: triage, input: { vendorName: "Northwind" } });
    const [started, completed] = trace.events;

    // Every `run.*` event is a root: the run is identified by `runId`, so it
    // needs no pointer to itself (ADR-0031).
    expect(trace.events.every((event) => event.parentId === null)).toBe(true);
    expect(trace.events.every((event) => event.version === TRACE_EVENT_VERSION)).toBe(true);
    // M4 fills `node`; M2-T8 fills `behaviorFingerprint`. Neither is faked.
    expect(trace.events.every((event) => event.node === null)).toBe(true);
    expect(trace.events.every((event) => event.behaviorFingerprint === null)).toBe(true);
    expect(trace.events.every((event) => event.attempt === result.attempt)).toBe(true);
    expect(trace.events.every((event) => isEntityId(event.id))).toBe(true);
    expect(new Set(trace.events.map((event) => event.id)).size).toBe(trace.events.length);

    // A start event has measured nothing yet; the terminal event carries the
    // run's usage and the harness-measured latency.
    expect(started?.usage).toBeNull();
    expect(started?.latencyMs).toBeNull();
    expect(started?.error).toBeNull();
    expect(completed?.usage).toEqual({ modelCalls: 2, toolCalls: 1, costUsd: 0.01 });
    expect(completed?.latencyMs).toBe(400);
    expect(completed?.error).toBeNull();
    expect(completed?.payload).toEqual({ jobId: result.jobId });
  });

  it("carries a failure in the event's error field, in its trace-safe form", async () => {
    const trace = createLocalTraceWriter();
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({
        result: {
          status: "failed",
          error: { name: "ToolExecutionError", code: "TOOL_EXECUTION", message: "the tool failed" },
          usage: USAGE,
          runtime: RUNTIME,
        },
      }),
      trace,
    });

    await harness.run({ domain: triage, input: { vendorName: "Northwind" } });
    const failed = trace.events[1];

    expect(failed?.type).toBe("run.failed");
    expect(failed?.error).toEqual({
      name: "ToolExecutionError",
      code: "TOOL_EXECUTION",
      message: "the tool failed",
    });
    expect(failed?.payload).toMatchObject({ errorCode: "TOOL_EXECUTION" });
    expect(failed?.error?.stack).toBeUndefined();
  });

  it("lets a flush failure out of `run`, so storage failure cannot look like success", async () => {
    // M2's acceptance criterion: "Storage failures cannot silently turn into
    // successful runs." A run whose trace never reached its sink is not a run
    // anyone can inspect, evaluate or replay.
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "bookkeeping" }) }),
      trace: {
        append: () => Promise.resolve(),
        flush: () => Promise.reject(new StorageError("the trace sink rejected the batch")),
      },
    });

    await expect(
      harness.run({ domain: triage, input: { vendorName: "Northwind" } }),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("timestamps events from the supplied clock", async () => {
    const trace = createLocalTraceWriter();
    const clock = clockAt("2026-09-19T12:00:00.000Z");
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({
        handler: () => {
          clock.advance(1_500);
          return completedWith({ category: "bookkeeping" });
        },
      }),
      trace,
      clock,
    });

    await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    expect(trace.events.map((event) => event.timestamp)).toEqual([
      "2026-09-19T12:00:00.000Z",
      "2026-09-19T12:00:01.500Z",
    ]);
  });
});

describe("harness.run: per-run overrides", () => {
  it("merges budget shallowly, replaces permissions and merges metadata", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const harness = createHarness({ agentRuntime });

    await harness.run({
      domain: triage,
      input: { vendorName: "Northwind" },
      budget: { maxModelCalls: 1, maxCostUsd: 0.5 },
      permissions: [{ toolId: "other", mode: "write" }],
      metadata: { caller: "test" },
    });

    const call = agentRuntime.calls[0];

    // `maxToolCalls` survives from the domain; `maxModelCalls` is replaced and
    // `maxCostUsd` is added.
    expect(call?.job.budget).toEqual({ maxModelCalls: 1, maxToolCalls: 4, maxCostUsd: 0.5 });
    expect(call?.context.budget).toEqual({ maxModelCalls: 1, maxToolCalls: 4, maxCostUsd: 0.5 });
    // Permissions are replaced, not widened: a caller states the whole list.
    expect(call?.job.permissions).toEqual([{ toolId: "other", mode: "write" }]);
    expect(call?.context.permissions).toEqual([{ toolId: "other", mode: "write" }]);
    expect(call?.job.metadata).toEqual({ fixture: true, caller: "test" });
  });

  it("leaves the domain's own values alone when nothing is overridden", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const harness = createHarness({ agentRuntime });

    await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    expect(agentRuntime.calls[0]?.job.budget).toEqual({ maxModelCalls: 4, maxToolCalls: 4 });
    expect(agentRuntime.calls[0]?.job.metadata).toEqual({ fixture: true });
  });

  it("hands the runtime one deeply immutable effective job", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const harness = createHarness({ agentRuntime });

    const result = await harness.run({
      domain: triage,
      input: { vendorName: "Northwind" },
      budget: { maxCostUsd: 0.5 },
      permissions: [{ toolId: "other", mode: "write" }],
      metadata: { caller: "test" },
    });

    const job = agentRuntime.calls[0]?.job as Job;

    // **The effective job is the job** (M2-T2, ADR-0032): the overrides are
    // applied while it is built, before anything executes, and the value the
    // runtime receives is the one the result, the trace and persistence all
    // name. Its id is the id the domain minted; nothing amended a second job
    // into existence.
    expect(job.id).toBe(result.jobId);

    // Immutable all the way down, not just at the top level.
    expect(Object.isFrozen(job)).toBe(true);
    expect(() => {
      (job.budget as { maxCostUsd?: number }).maxCostUsd = 1e9;
    }).toThrow(TypeError);
    expect(() => {
      (job.permissions[0] as { mode: string }).mode = "read";
    }).toThrow(TypeError);
    expect(() => {
      (job.metadata as { caller?: string }).caller = "someone else";
    }).toThrow(TypeError);
  });

  it("hands the runtime a job the boundary validator accepts", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const harness = createHarness({ agentRuntime });

    await harness.run({
      domain: triage,
      input: { vendorName: "Northwind" },
      budget: { maxCostUsd: 0.5 },
    });

    const job = agentRuntime.calls[0]?.job as Job;

    // What the producer builds and what `parseJob` accepts are the same shape,
    // which is what makes a stored job readable again (M2-T5, M2-T10, M6).
    expect(parseJob(JSON.parse(JSON.stringify(job)))).toEqual(job);
  });
});

describe("HarnessRunResult", () => {
  const base = {
    runId: newRunId(),
    jobId: newJobId(),
    domain: { id: "triage", version: "1.0.0" },
    attempt: 1,
    usage: USAGE,
    runtime: RUNTIME,
  } as const;

  it("carries usage and runtime on every variant", () => {
    const variants: readonly HarnessRunResult<TriageOutput>[] = [
      { ...base, status: "completed", output: { category: "bookkeeping" } },
      {
        ...base,
        status: "failed",
        error: { name: "ValidationError", code: "VALIDATION", message: "no" },
      },
      { ...base, status: "aborted" },
    ];

    for (const variant of variants) {
      expect(variant.usage).toBe(USAGE);
      expect(variant.runtime).toBe(RUNTIME);
    }
  });

  it("narrows on `status`, and only the completed variant has an output", () => {
    const variant: HarnessRunResult<TriageOutput> = {
      ...base,
      status: "completed",
      output: { category: "bookkeeping" },
    };

    if (variant.status === "completed") {
      expectTypeOf(variant.output).toEqualTypeOf<TriageOutput>();
    } else {
      expect.unreachable("expected the completed variant");
    }
  });
});
