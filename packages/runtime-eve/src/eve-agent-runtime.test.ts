import {
  createExecutionContext,
  type Job,
  type JsonObject,
  type JsonValue,
  newJobId,
  newRunId,
} from "@internal/core";
import { createRecordingTraceWriter } from "@internal/testing";
import type { CancelSessionResult, MessageStreamEvent, SendTurnInput } from "eve/client";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  EveAgentRuntime,
  type EveClientLike,
  type EveTurnResponse,
  eveVersion,
} from "./eve-agent-runtime.js";

/**
 * Unit tests for the `eve` adapter: **no process, no server, no credential.**
 *
 * The adapter's only dependency is `eve/client`, so the transport is faked
 * rather than the model. A test scripts the exact event sequence a real server
 * produced in the research note's §15 spike and asserts on what the adapter
 * makes of it, which exercises usage arithmetic, permission enforcement, budget
 * enforcement, cancellation, error mapping, trace emission and the whole
 * terminal-state table with nothing running.
 *
 * The contract tests in `eve-agent-runtime.contract.test.ts` are the other
 * half: they run the same adapter against a real `eve dev` server.
 */

const DOMAIN = { id: "fixture-domain", version: "1.0.0" } as const;

const outputSchema = z.object({ verdict: z.string().min(1) });

let eventCounter = 0;

/** Stamp a bare event with the `meta` envelope eve guarantees on a read. */
function stamp(event: Omit<MessageStreamEvent, "meta">): MessageStreamEvent {
  eventCounter += 1;

  return {
    ...event,
    meta: { id: `evt_${String(eventCounter).padStart(4, "0")}`, at: "2026-09-19T12:00:00.000Z" },
  } as MessageStreamEvent;
}

const TURN = { turnId: "turn_0", sequence: 0, stepIndex: 0 } as const;

const events = {
  sessionStarted: (): MessageStreamEvent =>
    stamp({ type: "session.started", data: { sessionId: "wrun_fixture" } } as never),
  turnStarted: (): MessageStreamEvent =>
    stamp({ type: "turn.started", data: { ...TURN } } as never),
  stepStarted: (modelId = "harness-fixture"): MessageStreamEvent =>
    stamp({ type: "step.started", data: { ...TURN, modelId } } as never),
  stepCompleted: (usage?: Record<string, number>): MessageStreamEvent =>
    stamp({
      type: "step.completed",
      data: { ...TURN, finishReason: "stop", ...(usage === undefined ? {} : { usage }) },
    } as never),
  actionsRequested: (...toolNames: string[]): MessageStreamEvent =>
    stamp({
      type: "actions.requested",
      data: {
        ...TURN,
        actions: toolNames.map((toolName, index) => ({
          callId: `call_${String(index)}`,
          input: {},
          kind: "tool-call",
          toolName,
        })),
      },
    } as never),
  actionResult: (toolName: string): MessageStreamEvent =>
    stamp({
      type: "action.result",
      data: {
        ...TURN,
        status: "completed",
        result: { callId: "call_0", kind: "tool-result", output: {}, toolName },
      },
    } as never),
  resultCompleted: (result: JsonValue): MessageStreamEvent =>
    stamp({ type: "result.completed", data: { ...TURN, result } } as never),
  inputRequested: (): MessageStreamEvent =>
    stamp({
      type: "input.requested",
      data: { ...TURN, requests: [{ requestId: "req_0", kind: "question" }] },
    } as never),
  stepFailed: (code: string, message: string): MessageStreamEvent =>
    stamp({ type: "step.failed", data: { ...TURN, code, message } } as never),
  turnFailed: (code: string, message: string): MessageStreamEvent =>
    stamp({
      type: "turn.failed",
      data: { turnId: TURN.turnId, sequence: 0, code, message },
    } as never),
  turnCompleted: (): MessageStreamEvent =>
    stamp({ type: "turn.completed", data: { turnId: TURN.turnId, sequence: 0 } } as never),
  turnCancelled: (): MessageStreamEvent =>
    stamp({ type: "turn.cancelled", data: { turnId: TURN.turnId, sequence: 0 } } as never),
  sessionWaiting: (): MessageStreamEvent =>
    stamp({
      type: "session.waiting",
      data: { continuationToken: "wrun_fixture", wait: "next-user-message" },
    } as never),
} as const;

interface FakeClientOptions {
  /** The events the turn emits, in order. */
  readonly script: readonly MessageStreamEvent[];
  /** Emitted only after `cancel()` is called, to model a cancelled turn. */
  readonly afterCancel?: readonly MessageStreamEvent[];
  /** Reject `health()` with this. */
  readonly healthError?: unknown;
  /** Reject `sessions.create()` with this. */
  readonly createError?: unknown;
}

interface FakeClient extends EveClientLike {
  readonly created: SendTurnInput<unknown>[];
  readonly cancelCalls: () => number;
}

/**
 * A client whose stream is a script.
 *
 * `afterCancel` is how a cancellation test stays honest: the scripted events
 * stop and the iterator waits, exactly as a real in-flight turn would, until
 * the adapter calls `cancel()`.
 */
function createFakeClient(options: FakeClientOptions): FakeClient {
  const created: SendTurnInput<unknown>[] = [];
  let cancelCalls = 0;
  let cancelled: (() => void) | undefined;

  const gate = new Promise<void>((resolve) => {
    cancelled = resolve;
  });

  const response: EveTurnResponse = {
    sessionId: "wrun_fixture",
    cancel(): Promise<CancelSessionResult> {
      cancelCalls += 1;
      cancelled?.();
      return Promise.resolve({ status: "accepted", sessionId: "wrun_fixture" });
    },
    async *[Symbol.asyncIterator](): AsyncIterator<MessageStreamEvent> {
      for (const event of options.script) {
        yield event;
      }

      if (options.afterCancel !== undefined) {
        await gate;
        for (const event of options.afterCancel) {
          yield event;
        }
      }
    },
  };

  return {
    created,
    cancelCalls: () => cancelCalls,
    health() {
      return options.healthError === undefined
        ? Promise.resolve({ ok: true, status: "ready", workflowId: "w" })
        : Promise.reject(options.healthError);
    },
    sessions: {
      create<TOutput>(input: SendTurnInput<TOutput>) {
        created.push(input as SendTurnInput<unknown>);
        return options.createError === undefined
          ? Promise.resolve({ response })
          : Promise.reject(options.createError);
      },
    },
  };
}

/**
 * One id per file rather than per call, so the job a test builds and the
 * context it runs under agree, the way they do in a real run.
 */
const JOB_ID = newJobId();
const RUN_ID = newRunId();

function createJob(
  overrides: Partial<Job<JsonObject, JsonObject>> = {},
): Job<JsonObject, JsonObject> {
  return {
    id: JOB_ID,
    domain: DOMAIN,
    jobType: "fixture",
    objective: "Decide the fixture verdict.",
    input: { vendorName: "Northwind Ledger" },
    contracts: {
      inputSchema: "fixture-domain.input@1.0.0",
      outputSchema: "fixture-domain.output@1.0.0",
      sop: "fixture-sop",
    },
    budget: {},
    permissions: [{ toolId: "echo_fixture", mode: "read" }],
    metadata: {},
    ...overrides,
  };
}

function createContext(overrides: Partial<Parameters<typeof createExecutionContext>[0]> = {}) {
  return createExecutionContext({
    runId: RUN_ID,
    jobId: JOB_ID,
    domain: DOMAIN,
    permissions: [{ toolId: "echo_fixture", mode: "read" }],
    // `runtime` is deliberately left unset. `createExecutionContext` defaults it
    // to `HARNESS_RUNTIME_INFO`, because the harness does not know which adapter
    // it is about to call. The adapter names itself on the result instead, which
    // is what the `runtime` assertions below check.
    ...overrides,
  });
}

function createRuntime(client: EveClientLike): EveAgentRuntime {
  return new EveAgentRuntime({
    client,
    domains: [{ id: DOMAIN.id, version: DOMAIN.version, outputSchema }],
  });
}

const HAPPY_PATH = [
  events.sessionStarted(),
  events.turnStarted(),
  events.stepStarted(),
  events.stepCompleted({ inputTokens: 118, outputTokens: 8 }),
  events.resultCompleted({ verdict: "proceed" }),
  events.turnCompleted(),
  events.sessionWaiting(),
];

describe("EveAgentRuntime construction", () => {
  it("throws for a programmer error rather than failing a run", () => {
    expect(() => new EveAgentRuntime({})).toThrow(TypeError);
    expect(
      () => new EveAgentRuntime({ host: "http://x", client: createFakeClient({ script: [] }) }),
    ).toThrow(TypeError);
  });

  it("accepts a host, and reports the installed eve version", () => {
    expect(() => new EveAgentRuntime({ host: "http://127.0.0.1:2000" })).not.toThrow();
    expect(eveVersion()).toMatch(/^\d+\.\d+\.\d+$/u);
  });
});

describe("EveAgentRuntime.run, completed", () => {
  it("returns the structured result and the summed usage", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.stepStarted(),
        events.actionsRequested("echo_fixture"),
        events.actionResult("echo_fixture"),
        events.stepCompleted({ inputTokens: 100, outputTokens: 10, costUsd: 0.002 }),
        events.stepStarted(),
        events.stepCompleted({ inputTokens: 40, outputTokens: 5, costUsd: 0.001 }),
        events.resultCompleted({ verdict: "proceed" }),
        events.turnCompleted(),
        events.sessionWaiting(),
      ],
    });

    const execution = await createRuntime(client).run(createJob(), createContext());

    expect(execution.status).toBe("completed");
    expect(execution.status === "completed" && execution.output).toEqual({ verdict: "proceed" });
    // Two `step.completed` events and one `action.result`.
    expect(execution.usage.modelCalls).toBe(2);
    expect(execution.usage.toolCalls).toBe(1);
    expect(execution.usage.costUsd).toBeCloseTo(0.003, 10);
    expect(execution.usage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("omits costUsd entirely when no step reported one", async () => {
    const client = createFakeClient({ script: HAPPY_PATH });

    const execution = await createRuntime(client).run(createJob(), createContext());

    // Absent, not zero: reporting `0` would claim the run was free.
    expect(execution.usage).not.toHaveProperty("costUsd");
    expect(execution.usage.modelCalls).toBe(1);
  });

  it("reports the runtime as eve, carrying the session and turn ids as opaque strings", async () => {
    const client = createFakeClient({ script: HAPPY_PATH });

    const execution = await createRuntime(client).run(createJob(), createContext());

    expect(execution.runtime.name).toBe("eve");
    expect(execution.runtime.version).toBe(eveVersion());
    expect(execution.runtime.metadata).toEqual({ sessionId: "wrun_fixture", turnId: "turn_0" });
  });

  it("sends the objective as the message and the job as clientContext", async () => {
    const client = createFakeClient({ script: HAPPY_PATH });

    await createRuntime(client).run(createJob(), createContext());

    const sent = client.created[0];

    expect(sent?.message).toBe("Decide the fixture verdict.");
    expect(sent?.clientContext).toEqual({
      jobId: JOB_ID,
      domain: { id: "fixture-domain", version: "1.0.0" },
      jobType: "fixture",
      input: { vendorName: "Northwind Ledger" },
    });
  });

  it("lowers the domain schema to a plain JSON Schema object with no $schema key", async () => {
    const client = createFakeClient({ script: HAPPY_PATH });

    await createRuntime(client).run(createJob(), createContext());

    expect(client.created[0]?.outputSchema).toEqual({
      type: "object",
      properties: { verdict: { type: "string", minLength: 1 } },
      required: ["verdict"],
      additionalProperties: false,
    });
  });
});

describe("EveAgentRuntime.run, failure mapping", () => {
  it("fails with a ValidationError when a completed turn produced no data", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.stepCompleted(),
        events.turnCompleted(),
        events.sessionWaiting(),
      ],
    });

    const execution = await createRuntime(client).run(createJob(), createContext());

    expect(execution.status).toBe("failed");
    expect(execution.status === "failed" && execution.error.code).toBe("VALIDATION");
    // The usage is still reported: the attempt cost a model call.
    expect(execution.usage.modelCalls).toBe(1);
  });

  it("maps a turn failure to AgentExecutionError carrying eve's code", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.stepCompleted(),
        events.stepFailed("OUTPUT_SCHEMA_NOT_FULFILLED", "The agent could not produce a result."),
        events.turnFailed("OUTPUT_SCHEMA_NOT_FULFILLED", "The agent could not produce a result."),
        events.sessionWaiting(),
      ],
    });

    const execution = await createRuntime(client).run(createJob(), createContext());

    expect(execution.status).toBe("failed");
    expect(execution.status === "failed" && execution.error.code).toBe("AGENT_EXECUTION");
    expect(execution.status === "failed" && execution.error.details).toMatchObject({
      code: "OUTPUT_SCHEMA_NOT_FULFILLED",
      event: "step.failed",
    });
  });

  it("does not branch on a session status: a turn.completed with data is a success", async () => {
    // The spike observed `MessageResult.status: "waiting"` for a success, a
    // failure and a cancellation alike. Every script here ends in
    // `session.waiting`, so a `status`-based adapter would get all of them wrong.
    const client = createFakeClient({ script: HAPPY_PATH });

    expect((await createRuntime(client).run(createJob(), createContext())).status).toBe(
      "completed",
    );
  });

  it("fails when the agent asks for human input", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.inputRequested(),
        events.sessionWaiting(),
      ],
    });

    const execution = await createRuntime(client).run(createJob(), createContext());

    expect(execution.status).toBe("failed");
    expect(execution.status === "failed" && execution.error.code).toBe("AGENT_EXECUTION");
    expect(execution.status === "failed" && execution.error.message).toContain("human input");
    expect(client.cancelCalls()).toBe(1);
  });

  it("fails when the stream ends with no terminal boundary", async () => {
    const client = createFakeClient({ script: [events.sessionStarted(), events.turnStarted()] });

    const execution = await createRuntime(client).run(createJob(), createContext());

    expect(execution.status).toBe("failed");
    expect(execution.status === "failed" && execution.error.message).toContain("terminal boundary");
  });

  it("fails, rather than throws, when the server is unreachable", async () => {
    const client = createFakeClient({ script: [], healthError: new Error("ECONNREFUSED") });

    const execution = await createRuntime(client).run(createJob(), createContext());

    expect(execution.status).toBe("failed");
    expect(execution.status === "failed" && execution.error.code).toBe("AGENT_EXECUTION");
    expect(execution.status === "failed" && execution.error.cause?.message).toBe("ECONNREFUSED");
  });

  it("fails when no output schema is registered for the job's domain", async () => {
    const runtime = new EveAgentRuntime({ client: createFakeClient({ script: HAPPY_PATH }) });

    const execution = await runtime.run(createJob(), createContext());

    expect(execution.status).toBe("failed");
    expect(execution.status === "failed" && execution.error.message).toContain(
      "fixture-domain@1.0.0",
    );
  });

  it("fails when the domain schema cannot emit JSON Schema", async () => {
    const runtime = new EveAgentRuntime({
      client: createFakeClient({ script: HAPPY_PATH }),
      domains: [
        {
          ...DOMAIN,
          // A Standard Schema with no `jsonSchema` converter: valid per
          // ADR-0027, and not something eve's `outputSchema` can accept.
          outputSchema: {
            "~standard": { version: 1, vendor: "handwritten", validate: (value) => ({ value }) },
          },
        },
      ],
    });

    const execution = await runtime.run(createJob(), createContext());

    expect(execution.status).toBe("failed");
    expect(execution.status === "failed" && execution.error.message).toContain(
      "Standard JSON Schema converter",
    );
  });
});

describe("EveAgentRuntime.run, permissions", () => {
  it("cancels and fails on a tool the job does not grant", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.stepStarted(),
        events.actionsRequested("forbidden_tool"),
      ],
      afterCancel: [events.turnCancelled(), events.sessionWaiting()],
    });

    const execution = await createRuntime(client).run(createJob(), createContext());

    expect(execution.status).toBe("failed");
    expect(execution.status === "failed" && execution.error.code).toBe("PERMISSION_DENIED");
    expect(execution.status === "failed" && execution.error.details).toMatchObject({
      toolId: "forbidden_tool",
      requested: "read",
    });
    expect(client.cancelCalls()).toBe(1);
  });

  it("allows a granted tool, whatever the grant's mode", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.actionsRequested("echo_fixture"),
        events.actionResult("echo_fixture"),
        events.stepCompleted(),
        events.resultCompleted({ verdict: "proceed" }),
        events.turnCompleted(),
        events.sessionWaiting(),
      ],
    });

    const context = createContext({ permissions: [{ toolId: "echo_fixture", mode: "write" }] });
    const execution = await createRuntime(client).run(createJob(), context);

    expect(execution.status).toBe("completed");
    expect(client.cancelCalls()).toBe(0);
  });

  it("denies every tool when the job grants none, which is the default", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.actionsRequested("echo_fixture"),
      ],
      afterCancel: [events.turnCancelled(), events.sessionWaiting()],
    });

    const execution = await createRuntime(client).run(
      createJob(),
      createContext({ permissions: [] }),
    );

    expect(execution.status === "failed" && execution.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("EveAgentRuntime.run, budget", () => {
  it("cancels and fails when the model-call budget is exceeded", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.stepCompleted(),
        events.stepCompleted(),
      ],
      afterCancel: [events.turnCancelled(), events.sessionWaiting()],
    });

    const context = createContext({ budget: { maxModelCalls: 1 } });
    const execution = await createRuntime(client).run(createJob(), context);

    expect(execution.status === "failed" && execution.error.code).toBe("BUDGET_EXCEEDED");
    expect(execution.status === "failed" && execution.error.details).toMatchObject({
      dimension: "maxModelCalls",
      limit: 1,
      actual: 2,
    });
    expect(client.cancelCalls()).toBe(1);
  });

  it("cancels and fails when the tool-call budget is exceeded", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.actionsRequested("echo_fixture"),
        events.actionResult("echo_fixture"),
        events.actionResult("echo_fixture"),
      ],
      afterCancel: [events.turnCancelled(), events.sessionWaiting()],
    });

    const context = createContext({ budget: { maxToolCalls: 1 } });
    const execution = await createRuntime(client).run(createJob(), context);

    expect(execution.status === "failed" && execution.error.details).toMatchObject({
      dimension: "maxToolCalls",
      limit: 1,
      actual: 2,
    });
  });

  it("cancels and fails when the cost budget is exceeded", async () => {
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.stepCompleted({ costUsd: 0.5 }),
        events.stepCompleted({ costUsd: 0.75 }),
      ],
      afterCancel: [events.turnCancelled(), events.sessionWaiting()],
    });

    const context = createContext({ budget: { maxCostUsd: 1 } });
    const execution = await createRuntime(client).run(createJob(), context);

    expect(execution.status === "failed" && execution.error.details).toMatchObject({
      dimension: "maxCostUsd",
      limit: 1,
    });
  });

  it("does not treat an unreported cost as within budget", async () => {
    // Every step reports tokens and no cost, which is what a mock or a
    // direct-provider model does. A `costUsd` of `0` would be a claim.
    const client = createFakeClient({
      script: [
        ...HAPPY_PATH.slice(0, 4),
        events.resultCompleted({ verdict: "proceed" }),
        events.turnCompleted(),
        events.sessionWaiting(),
      ],
    });

    const context = createContext({ budget: { maxCostUsd: 0 } });
    const execution = await createRuntime(client).run(createJob(), context);

    expect(execution.status).toBe("completed");
  });

  it("cancels and fails when the duration budget elapses with no events", async () => {
    const client = createFakeClient({
      script: [events.sessionStarted(), events.turnStarted()],
      afterCancel: [events.turnCancelled(), events.sessionWaiting()],
    });

    const context = createContext({ budget: { maxDurationMs: 10 } });
    const execution = await createRuntime(client).run(createJob(), context);

    expect(execution.status === "failed" && execution.error.details).toMatchObject({
      dimension: "maxDurationMs",
      limit: 10,
    });
    expect(client.cancelCalls()).toBe(1);
  });
});

describe("EveAgentRuntime.run, cancellation", () => {
  it("resolves aborted without starting a turn when the signal already fired", async () => {
    const client = createFakeClient({ script: HAPPY_PATH });
    const controller = new AbortController();
    controller.abort();

    const execution = await createRuntime(client).run(
      createJob(),
      createContext({ signal: controller.signal }),
    );

    expect(execution.status).toBe("aborted");
    expect(client.created).toHaveLength(0);
  });

  it("cancels the eve turn when the signal fires mid-run, and resolves aborted", async () => {
    const client = createFakeClient({
      script: [events.sessionStarted(), events.turnStarted(), events.stepStarted()],
      afterCancel: [events.turnCancelled(), events.sessionWaiting()],
    });
    const controller = new AbortController();

    const pending = createRuntime(client).run(
      createJob(),
      createContext({ signal: controller.signal }),
    );

    // Let the adapter reach the stream before aborting, the way the streaming
    // guide requires: cancellation waits for the stream to identify the turn.
    await vi.waitFor(() => {
      expect(client.created).toHaveLength(1);
    });
    controller.abort();

    const execution = await pending;

    expect(execution.status).toBe("aborted");
    expect(client.cancelCalls()).toBe(1);
    // Usage accrued before the abort is still reported.
    expect(execution.usage.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes the signal to the client call as well as cancelling the turn", async () => {
    const client = createFakeClient({ script: HAPPY_PATH });
    const controller = new AbortController();

    await createRuntime(client).run(createJob(), createContext({ signal: controller.signal }));

    expect(client.created[0]?.signal).toBe(controller.signal);
  });
});

describe("EveAgentRuntime.run, trace", () => {
  it("emits one namespaced event per stream event, in increasing sequence", async () => {
    const trace = createRecordingTraceWriter();
    const client = createFakeClient({
      script: [
        events.sessionStarted(),
        events.turnStarted(),
        events.stepStarted("harness-fixture"),
        events.actionsRequested("echo_fixture"),
        events.actionResult("echo_fixture"),
        events.stepCompleted({ inputTokens: 7, outputTokens: 3 }),
        events.resultCompleted({ verdict: "proceed" }),
        events.turnCompleted(),
        events.sessionWaiting(),
      ],
    });

    await createRuntime(client).run(createJob(), createContext({ trace }));

    expect(trace.events).toHaveLength(9);
    expect(trace.events.map((event) => event.type)).toEqual([
      "eve.session.started",
      "eve.turn.started",
      "eve.step.started",
      "eve.actions.requested",
      "eve.action.result",
      "eve.step.completed",
      "eve.result.completed",
      "eve.turn.completed",
      "eve.session.waiting",
    ]);
    expect(trace.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(trace.events.every((event) => event.runId === RUN_ID)).toBe(true);
    expect(trace.events[0]?.timestamp).toBe("2026-09-19T12:00:00.000Z");
  });

  it("projects the shape of the run and none of its content", async () => {
    const trace = createRecordingTraceWriter();
    const client = createFakeClient({
      script: [
        events.stepStarted("harness-fixture"),
        events.actionsRequested("echo_fixture", "lookup_vendor_evidence"),
        events.actionResult("echo_fixture"),
        events.stepCompleted({ inputTokens: 7, outputTokens: 3, costUsd: 0.01 }),
        events.resultCompleted({ verdict: "a secret the trace must not carry" }),
        events.turnCompleted(),
      ],
    });

    const context = createContext({
      trace,
      permissions: [
        { toolId: "echo_fixture", mode: "read" },
        { toolId: "lookup_vendor_evidence", mode: "read" },
      ],
    });
    await createRuntime(client).run(createJob(), context);

    const byType = new Map(trace.events.map((event) => [event.type, event.payload]));

    expect(byType.get("eve.step.started")).toMatchObject({ modelId: "harness-fixture" });
    expect(byType.get("eve.actions.requested")).toMatchObject({
      tools: ["echo_fixture", "lookup_vendor_evidence"],
      actionCount: 2,
    });
    expect(byType.get("eve.action.result")).toMatchObject({
      status: "completed",
      tool: "echo_fixture",
    });
    expect(byType.get("eve.step.completed")).toMatchObject({
      finishReason: "stop",
      usage: { inputTokens: 7, outputTokens: 3, costUsd: 0.01 },
    });

    // Every event carries its durable identity, and the structured result's
    // content appears in no payload. M2-T9 owns redaction; M1 carries nothing
    // that would need it.
    expect(trace.events.every((event) => typeof event.payload.eventId === "string")).toBe(true);
    expect(JSON.stringify(trace.events)).not.toContain("a secret the trace must not carry");
  });

  it("reports a failure code on a failure event without its message", async () => {
    const trace = createRecordingTraceWriter();
    const client = createFakeClient({
      script: [
        events.turnFailed("MODEL_CALL_FAILED", "upstream provider said no"),
        events.sessionWaiting(),
      ],
    });

    await createRuntime(client).run(createJob(), createContext({ trace }));

    expect(trace.events[0]?.payload).toMatchObject({ code: "MODEL_CALL_FAILED" });
    expect(JSON.stringify(trace.events)).not.toContain("upstream provider said no");
  });
});
