import { describe, expect, expectTypeOf, it } from "vitest";
import type { AgentExecution, AgentExecutionUsage, AgentRuntime } from "./agent-runtime.js";
import type { BehaviorDescriptor, BehaviorSource } from "./behavior.js";
import { createBehaviorFingerprint } from "./behavior.js";
import type { ExecutionContext, RuntimeInfo } from "./context.js";
import { HARNESS_RUNTIME_INFO } from "./context.js";
import type { DomainDefinition } from "./domain.js";
import { defineDomain } from "./domain.js";
import { StorageError, ValidationError } from "./errors.js";
import { type Clock, createHarness, type HarnessRunResult } from "./harness.js";
import { isEntityId, newJobId, newRunId } from "./ids.js";
import type { Job } from "./job.js";
import { parseJob } from "./job.js";
import type { Schema, SchemaResult } from "./schema.js";
import type {
  RunFinish,
  RunPage,
  RunRecord,
  RunStart,
  RunStatus,
  Storage,
  TracePage,
} from "./storage.js";
import { parseRunRecord } from "./storage.js";
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
    // M4 fills `node`. `behaviorFingerprint` is `null` here because `triage`
    // declares no `behavior`; a domain that declares one is covered by the
    // "behavior fingerprint" block below. Neither is ever faked.
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

describe("harness.run: behavior fingerprint", () => {
  /** The smallest complete descriptor: one value per component (M2-T8). */
  const DESCRIPTOR: BehaviorDescriptor = {
    instructions: "Triage the vendor.\n",
    sop: "1. Check the evidence.\n",
    skills: [{ id: "triage", content: "Gather, then judge.\n" }],
    tools: [{ id: "lookup", version: "1.0.0", definitionFingerprint: "sha256:aa" }],
    model: { model: "test/model", temperature: 0 },
    schemas: [{ ref: "triage.input@1.0.0", fingerprint: "sha256:bb" }],
    workflowIr: null,
    policy: { maxOpenRiskFlags: 0 },
  };

  /** `triage`, plus a behavior source. Everything else is identical. */
  function triageWithBehavior(
    behavior: BehaviorSource,
  ): DomainDefinition<TriageInput, TriageOutput> {
    return defineDomain<TriageInput, TriageOutput>({
      id: "triage",
      version: "1.0.0",
      inputSchema,
      outputSchema,
      createJob: (input) => ({
        jobType: "triage",
        objective: `Triage ${input.vendorName}.`,
        input,
        contracts: {
          inputSchema: "triage.input@1.0.0",
          outputSchema: "triage.output@1.0.0",
          sop: "triage-sop",
        },
      }),
      behavior,
    });
  }

  it("stamps the same fingerprint on every event of a run, and on the result", async () => {
    const trace = createLocalTraceWriter();
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "bookkeeping" }) }),
      trace,
    });

    const result = await harness.run({
      domain: triageWithBehavior(DESCRIPTOR),
      input: { vendorName: "Northwind" },
    });

    const expected = createBehaviorFingerprint(DESCRIPTOR);

    expect(result.behaviorFingerprint?.fingerprint).toBe(expected.fingerprint);
    expect(result.behaviorFingerprint?.components).toEqual(expected.components);
    expect(trace.events.length).toBeGreaterThan(1);
    expect(trace.events.every((event) => event.behaviorFingerprint === expected.fingerprint)).toBe(
      true,
    );
  });

  it("puts the component digests in the run.started payload, and nothing else there", async () => {
    const trace = createLocalTraceWriter();
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "bookkeeping" }) }),
      trace,
    });

    await harness.run({
      domain: triageWithBehavior(DESCRIPTOR),
      input: { vendorName: "Northwind" },
    });

    const expected = createBehaviorFingerprint(DESCRIPTOR);

    expect(trace.events[0]?.payload.behavior).toEqual({
      scheme: expected.scheme,
      algorithm: expected.algorithm,
      components: { ...expected.components },
    });
    // The payload stays identity-only (ADR-0031): digests, never the
    // instructions, the SOP or the skill text they were computed from.
    expect(JSON.stringify(trace.events[0]?.payload)).not.toContain("Triage the vendor");
  });

  it("records null, and no `behavior` payload, for a domain that declares none", async () => {
    const trace = createLocalTraceWriter();
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "bookkeeping" }) }),
      trace,
    });

    const result = await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    expect(result.behaviorFingerprint).toBeNull();
    expect(trace.events.every((event) => event.behaviorFingerprint === null)).toBe(true);
    expect(trace.events[0]?.payload.behavior).toBeUndefined();
  });

  it("resolves an async loader once, before the first event", async () => {
    const trace = createLocalTraceWriter();
    let calls = 0;
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "bookkeeping" }) }),
      trace,
    });

    const result = await harness.run({
      domain: triageWithBehavior(async () => {
        calls += 1;
        return await Promise.resolve(DESCRIPTOR);
      }),
      input: { vendorName: "Northwind" },
    });

    expect(calls).toBe(1);
    expect(trace.events[0]?.type).toBe("run.started");
    expect(trace.events[0]?.behaviorFingerprint).toBe(result.behaviorFingerprint?.fingerprint);
  });

  it("carries the fingerprint on a failed run too, so a failure stays comparable", async () => {
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({
        result: {
          status: "failed",
          error: { name: "ToolExecutionError", code: "TOOL_EXECUTION", message: "no" },
          usage: USAGE,
          runtime: RUNTIME,
        },
      }),
    });

    const result = await harness.run({
      domain: triageWithBehavior(DESCRIPTOR),
      input: { vendorName: "Northwind" },
    });

    expect(result.status).toBe("failed");
    expect(result.behaviorFingerprint?.fingerprint).toBe(
      createBehaviorFingerprint(DESCRIPTOR).fingerprint,
    );
  });

  it("changes when the instructions, the SOP or a policy threshold changes", async () => {
    // The M2 acceptance criterion, asserted through the harness rather than
    // only against `createBehaviorFingerprint`.
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "bookkeeping" }) }),
    });

    const run = async (descriptor: BehaviorDescriptor): Promise<string | undefined> => {
      const result = await harness.run({
        domain: triageWithBehavior(descriptor),
        input: { vendorName: "Northwind" },
      });
      return result.behaviorFingerprint?.fingerprint;
    };

    const baseline = await run(DESCRIPTOR);

    expect(await run({ ...DESCRIPTOR })).toBe(baseline);
    expect(await run({ ...DESCRIPTOR, instructions: "Triage the vendor!\n" })).not.toBe(baseline);
    expect(await run({ ...DESCRIPTOR, sop: "1. Check the evidence twice.\n" })).not.toBe(baseline);
    expect(await run({ ...DESCRIPTOR, policy: { maxOpenRiskFlags: 1 } })).not.toBe(baseline);
  });

  it("throws before any event when the descriptor is invalid", async () => {
    const trace = createLocalTraceWriter();
    const harness = createHarness({
      agentRuntime: createLocalAgentRuntime({ result: completedWith({ category: "bookkeeping" }) }),
      trace,
    });

    await expect(
      harness.run({
        domain: triageWithBehavior({ ...DESCRIPTOR, instructions: "" }),
        input: { vendorName: "Northwind" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // No run was recorded: a run whose behavior cannot be fingerprinted is not
    // a run anyone could later compare, so it is refused rather than written
    // with a `null` fingerprint.
    expect(trace.events).toEqual([]);
  });
});

/**
 * A {@link Storage} that records the order it was called in.
 *
 * A recorder rather than a working store, because what this block is about is
 * **ordering and failure propagation**: that the job and the ledger row exist
 * before the first trace event, that the outcome is written after the flush,
 * and that a failure at any of those points comes out of `run()` instead of
 * becoming a result. Whether a store can read back what it wrote is
 * `storage.contract.test.ts`'s question, asked of both real implementations.
 *
 * It is local to this file for the reason the note at the top of the file
 * gives: `@internal/testing` depends on `@internal/core`, so importing
 * `createInMemoryStorage()` here would make the workspace graph cyclic.
 */
interface RecordingStorage extends Storage {
  /** Every call, in order, as `"saveJob"`, `"startRun"`, and so on. */
  readonly calls: readonly string[];
  /** The `RunStart` inputs, so a test can read what was written. */
  readonly starts: readonly RunStart[];
  /** The `RunFinish` inputs. */
  readonly finishes: readonly RunFinish[];
}

interface RecordingStorageOptions {
  /** Throw from this operation. */
  readonly failOn?: string;
  /** What to throw. Defaults to a `StorageError`. */
  readonly failWith?: unknown;
}

function createRecordingStorage(options: RecordingStorageOptions = {}): RecordingStorage {
  const calls: string[] = [];
  const starts: RunStart[] = [];
  const finishes: RunFinish[] = [];

  function enter(operation: string): void {
    calls.push(operation);

    if (options.failOn === operation) {
      throw options.failWith ?? new StorageError(`storage: \`${operation}\` failed on purpose`);
    }
  }

  function record(input: RunStart, status: RunStatus): RunRecord {
    return parseRunRecord({
      runId: input.runId,
      jobId: input.jobId,
      attempt: input.attempt,
      domain: { id: input.domain.id, version: input.domain.version },
      jobType: input.jobType,
      status,
      success: status === "completed",
      qualityScore: null,
      costUsd: null,
      latencyMs: null,
      modelCalls: 0,
      toolCalls: 0,
      jevCalls: 0,
      fallbackCount: 0,
      humanReview: null,
      workflowVersionId: input.workflowVersionId,
      agentVersion: input.agentVersion,
      behaviorFingerprint: input.behaviorFingerprint,
      runtime: {
        name: input.runtime.name,
        version: input.runtime.version,
        metadata: input.runtime.metadata,
      },
      target: input.target,
      startedAt: input.startedAt,
      finishedAt: null,
      error: null,
    });
  }

  return {
    calls,
    starts,
    finishes,
    saveJob(): Promise<void> {
      enter("saveJob");
      return Promise.resolve();
    },
    startRun(input: RunStart): Promise<RunRecord> {
      enter("startRun");
      starts.push(input);
      return Promise.resolve(record(input, "running"));
    },
    finishRun(input: RunFinish): Promise<RunRecord> {
      enter("finishRun");
      finishes.push(input);

      const start = starts.at(-1);

      if (start === undefined) {
        throw new StorageError("storage: `finishRun` without a start");
      }

      return Promise.resolve(record(start, input.status));
    },
    getRun(): Promise<RunRecord | null> {
      enter("getRun");
      return Promise.resolve(null);
    },
    getJob(): Promise<Job<unknown, unknown> | null> {
      enter("getJob");
      return Promise.resolve(null);
    },
    listRuns(): Promise<RunPage> {
      enter("listRuns");
      return Promise.resolve({ runs: [], nextCursor: null });
    },
    appendTraceEvents(): Promise<void> {
      enter("appendTraceEvents");
      return Promise.resolve();
    },
    getTrace(): Promise<TracePage> {
      enter("getTrace");
      return Promise.resolve({ events: [], nextCursor: null });
    },
  };
}

describe("harness.run: storage", () => {
  it("behaves exactly as before when no storage is given", async () => {
    // North-star invariant 15: local development stays a first-class path. A
    // harness with no database still produces a complete ordered trace.
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const trace = createLocalTraceWriter();
    const harness = createHarness({ agentRuntime, trace });

    const result = await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    expect(result.status).toBe("completed");
    expect(trace.types()).toEqual(["run.started", "run.completed"]);
  });

  it("saves the job and opens the run row before the first trace event", async () => {
    const order: string[] = [];
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const storage = createRecordingStorage();
    // A writer that notes when it was first appended to, relative to storage.
    const trace: TraceWriter = {
      append(event: TraceEvent): Promise<void> {
        order.push(`append:${event.type}`);
        return Promise.resolve();
      },
      flush(): Promise<void> {
        order.push("flush");
        return Promise.resolve();
      },
    };
    const wrapped: Storage = {
      ...storage,
      saveJob(job) {
        order.push("saveJob");
        return storage.saveJob(job);
      },
      startRun(input) {
        order.push("startRun");
        return storage.startRun(input);
      },
      finishRun(input) {
        order.push("finishRun");
        return storage.finishRun(input);
      },
    };
    const harness = createHarness({ agentRuntime, trace, storage: wrapped });

    await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    // The ordering is the contract: a trace event whose run has no row would be
    // evidence of an execution the ledger denies happened, and the outcome is
    // written only once the evidence for it is durable.
    expect(order).toEqual([
      "saveJob",
      "startRun",
      "append:run.started",
      "append:run.completed",
      "flush",
      "finishRun",
    ]);
  });

  it("records the run's identity, behavior and target on the ledger row", async () => {
    const behavior: BehaviorDescriptor = {
      instructions: "Triage the vendor.\n",
      sop: "1. Check the evidence.\n",
      skills: [],
      tools: [],
      model: { model: "test/model" },
      schemas: [],
      workflowIr: null,
      policy: {},
    };
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const storage = createRecordingStorage();
    const harness = createHarness({
      agentRuntime,
      storage,
      target: "@internal/example-agent",
    });

    const result = await harness.run({
      domain: defineDomain<TriageInput, TriageOutput>({
        id: "triage",
        version: "1.0.0",
        inputSchema,
        outputSchema,
        createJob: (input) => ({
          jobType: "triage",
          objective: `Triage ${input.vendorName}.`,
          input,
          contracts: {
            inputSchema: "triage.input@1.0.0",
            outputSchema: "triage.output@1.0.0",
            sop: "triage-sop",
          },
        }),
        behavior,
      }),
      input: { vendorName: "Northwind" },
    });

    const start = storage.starts[0];

    expect(start?.runId).toBe(result.runId);
    expect(start?.jobId).toBe(result.jobId);
    expect(start?.attempt).toBe(1);
    expect(start?.jobType).toBe("triage");
    expect(start?.target).toBe("@internal/example-agent");
    expect(start?.behaviorFingerprint).toBe(createBehaviorFingerprint(behavior).fingerprint);
    // The behavior fingerprint *is* the agent version (M2-T7): a hand-written
    // version string is the one that stops tracking reality silently.
    expect(start?.agentVersion).toBe(start?.behaviorFingerprint);
    // The adapter has not spoken at `startRun` time, so the honest value is the
    // harness saying so; `finishRun` corrects it.
    expect(start?.runtime).toEqual(HARNESS_RUNTIME_INFO);
    expect(start?.workflowVersionId).toBeNull();
  });

  it("records `null` for a target nobody named", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const storage = createRecordingStorage();

    await createHarness({ agentRuntime, storage }).run({
      domain: triage,
      input: { vendorName: "Northwind" },
    });

    expect(storage.starts[0]?.target).toBeNull();
  });

  it("writes the outcome, the usage and the runtime that actually ran", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const clock = clockAt("2026-09-19T12:00:00.000Z");
    const storage = createRecordingStorage();
    const harness = createHarness({ agentRuntime, storage, clock });

    await harness.run({ domain: triage, input: { vendorName: "Northwind" } });

    const finish = storage.finishes[0];

    expect(finish?.status).toBe("completed");
    expect(finish?.success).toBe(true);
    expect(finish?.modelCalls).toBe(USAGE.modelCalls);
    expect(finish?.toolCalls).toBe(USAGE.toolCalls);
    expect(finish?.costUsd).toBe(USAGE.costUsd);
    expect(finish?.error).toBeNull();
    // Real zeros: a run today makes no Jev calls (M3) and takes no fallback (M5).
    expect(finish?.jevCalls).toBe(0);
    expect(finish?.fallbackCount).toBe(0);
    // The adapter's own identity, not the placeholder `startRun` wrote.
    expect(finish?.runtime).toEqual(RUNTIME);
  });

  it("keeps a failed run inspectable: a `failed` row carrying the error", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: {
        status: "failed",
        error: { name: "AgentExecutionError", code: "AGENT_EXECUTION", message: "nope" },
        usage: USAGE,
        runtime: RUNTIME,
      },
    });
    const storage = createRecordingStorage();

    const result = await createHarness({ agentRuntime, storage }).run({
      domain: triage,
      input: { vendorName: "Northwind" },
    });

    expect(result.status).toBe("failed");
    // The row exists, says `failed`, and carries the same error the trace's
    // `run.failed` event does.
    expect(storage.finishes[0]?.status).toBe("failed");
    expect(storage.finishes[0]?.success).toBe(false);
    expect(storage.finishes[0]?.error?.code).toBe("AGENT_EXECUTION");
  });

  it("records an aborted run as aborted with a null success", async () => {
    const controller = new AbortController();
    controller.abort();
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const storage = createRecordingStorage();

    const result = await createHarness({ agentRuntime, storage }).run({
      domain: triage,
      input: { vendorName: "Northwind" },
      signal: controller.signal,
    });

    expect(result.status).toBe("aborted");
    expect(storage.finishes[0]?.status).toBe("aborted");
    // `false` would file a cancellation as a defect (ADR-0031).
    expect(storage.finishes[0]?.success).toBeNull();
  });

  it.each(["saveJob", "startRun", "finishRun"])(
    "lets a `%s` failure out of run() instead of returning a result",
    async (failOn) => {
      // Milestone 2's "storage failures cannot silently turn into successful
      // runs", enforced rather than intended: a run whose record was not
      // written is not a run anyone can inspect, evaluate or replay.
      const agentRuntime = createLocalAgentRuntime({
        result: completedWith({ category: "bookkeeping" }),
      });
      const storage = createRecordingStorage({ failOn });

      await expect(
        createHarness({ agentRuntime, storage }).run({
          domain: triage,
          input: { vendorName: "Northwind" },
        }),
      ).rejects.toBeInstanceOf(StorageError);
    },
  );

  it("wraps a non-StorageError from an implementation, preserving the cause", async () => {
    // The port says every implementation rejects with `StorageError`. This does
    // not trust that, for the same reason a runtime adapter that throws is
    // already contained: a defect in an implementation must not become a defect
    // in the harness.
    const cause = new TypeError("a driver threw something else");
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const storage = createRecordingStorage({ failOn: "startRun", failWith: cause });

    const error = await createHarness({ agentRuntime, storage })
      .run({ domain: triage, input: { vendorName: "Northwind" } })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).cause).toBe(cause);
    expect((error as StorageError).details?.operation).toBe("startRun");
  });

  it("does not call the runtime at all when opening the run row fails", async () => {
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const storage = createRecordingStorage({ failOn: "startRun" });

    await expect(
      createHarness({ agentRuntime, storage }).run({
        domain: triage,
        input: { vendorName: "Northwind" },
      }),
    ).rejects.toBeInstanceOf(StorageError);

    // Nothing executed, so nothing was spent and there is no result to report.
    expect(agentRuntime.calls).toEqual([]);
  });

  it("still writes the run row when the runtime itself fails", async () => {
    const agentRuntime: AgentRuntime = {
      // `_TInput` is unused: this fake rejects before it looks at the job.
      run<_TInput, TOutput>(): Promise<AgentExecution<TOutput>> {
        return Promise.reject(new Error("the adapter threw"));
      },
    };
    const storage = createRecordingStorage();

    const result = await createHarness({ agentRuntime, storage }).run({
      domain: triage,
      input: { vendorName: "Northwind" },
    });

    expect(result.status).toBe("failed");
    expect(storage.calls).toEqual(["saveJob", "startRun", "finishRun"]);
    expect(storage.finishes[0]?.status).toBe("failed");
  });

  it("does not write the outcome when flushing the trace fails", async () => {
    // The ledger row is the claim and the trace is the evidence. Writing a
    // `completed` row whose trace was never persisted would leave a claim
    // nobody can check; leaving a `running` row beside a broken flush is
    // visibly incomplete instead.
    const agentRuntime = createLocalAgentRuntime({
      result: completedWith({ category: "bookkeeping" }),
    });
    const storage = createRecordingStorage();
    const trace: TraceWriter = {
      append: () => Promise.resolve(),
      flush: () => Promise.reject(new StorageError("the sink is down")),
    };

    await expect(
      createHarness({ agentRuntime, trace, storage }).run({
        domain: triage,
        input: { vendorName: "Northwind" },
      }),
    ).rejects.toBeInstanceOf(StorageError);

    expect(storage.calls).toEqual(["saveJob", "startRun"]);
    expect(storage.finishes).toEqual([]);
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
    // Every variant carries the run's behavior fingerprint (M2-T8), `null`
    // here because this block builds results by hand rather than by running a
    // domain.
    behaviorFingerprint: null,
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
