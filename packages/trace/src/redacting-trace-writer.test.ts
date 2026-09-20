import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentExecution,
  type AgentExecutionUsage,
  type AgentRuntime,
  createHarness,
  createNoopTraceWriter,
  createTraceRecorder,
  defineDomain,
  type ExecutionContext,
  type Job,
  newRunId,
  type RuntimeInfo,
  type Schema,
  type SchemaResult,
  StorageError,
  serializeError,
  ToolExecutionError,
  type TraceEvent,
  type TraceWriter,
  ValidationError,
} from "@internal/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBufferedTraceWriter } from "./buffered-trace-writer.js";
import { createJsonlFileTraceSink } from "./jsonl-sink.js";
import { createRedactingTraceWriter } from "./redacting-trace-writer.js";
import { createRedactionPolicy, redactionToken } from "./redaction.js";
import { createInMemoryTraceSink } from "./sink.js";

/**
 * The M2 acceptance criterion this file exists for: **seeded secrets never
 * appear in stored trace payloads.**
 *
 * The test doubles are local to this file rather than `@internal/testing`'s
 * `createFakeAgentRuntime` and `createRecordingTraceWriter`, for the reason
 * `packages/core/src/harness.test.ts` already records at length in its own
 * header: adding the dependency buys sixty lines and costs a workspace-graph
 * edge. Here the edge would not be a cycle — `@internal/testing` does not
 * depend on `@internal/trace` — but it would be a lockfile change to a package
 * manifest while another task is installing into the same lockfile, and it
 * would make a package whose whole claim is "no dependency but `@internal/core`"
 * depend on a second one. The doubles below are the smallest honest
 * `AgentRuntime` and `TraceWriter` this suite needs.
 *
 * Every fake credential is assembled at runtime from fragments so that no
 * string in this file looks like a credential to `secretlint`, which the
 * pre-commit hook runs over staged files. See `redaction.test.ts`.
 */
function seed(...parts: readonly string[]): string {
  return parts.join("");
}

const FAKE = {
  awsAccessKeyId: seed("AK", "IA", "FAKEFAKEFAKEFAK0"),
  openaiKey: seed("sk", "-", "fakefakefakefakefake00"),
  githubToken: seed("gh", "p", "_", "B".repeat(36)),
  supabaseSecretKey: seed("sb", "_", "secret", "_", "fake0000fake0000"),
  vercelGatewayKey: seed("vck", "_", "fake0000fake0000fake"),
  bearerCredential: seed("fake-bearer-token-value-0000"),
} as const;

/** Every seeded value that must not survive into a stored trace. */
const SEEDS: readonly string[] = Object.values(FAKE);

/** Assert that no seeded secret appears anywhere in `subject`. */
function expectNoSeeds(subject: string): void {
  for (const value of SEEDS) {
    expect(subject).not.toContain(value);
  }
}

/** A fresh temporary directory per test, for the JSONL round trip. */
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "harness-redaction-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const recorder = createTraceRecorder({ runId: newRunId(), writer: createNoopTraceWriter() });

/** A {@link TraceWriter} that keeps what it was handed, and can be made to fail. */
interface LocalTraceWriter extends TraceWriter {
  readonly events: readonly TraceEvent[];
  readonly flushCount: number;
  fail(error: Error): void;
}

function createLocalTraceWriter(): LocalTraceWriter {
  const events: TraceEvent[] = [];
  let flushCount = 0;
  let failure: Error | undefined;

  return {
    events,
    get flushCount(): number {
      return flushCount;
    },
    fail(error: Error): void {
      failure = error;
    },
    append(event: TraceEvent): Promise<void> {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }

      events.push(event);
      return Promise.resolve();
    },
    flush(): Promise<void> {
      flushCount += 1;
      return Promise.resolve();
    },
  };
}

describe("createRedactingTraceWriter", () => {
  it("redacts each event before the inner writer ever sees it", async () => {
    const inner = createLocalTraceWriter();
    const writer = createRedactingTraceWriter({ writer: inner });

    await writer.append(
      await recorder.record({
        type: "agent.completed",
        payload: { apiKey: FAKE.openaiKey, note: `gateway ${FAKE.vercelGatewayKey}` },
      }),
    );

    expect(inner.events[0]?.payload).toEqual({
      apiKey: redactionToken("api-key"),
      note: `gateway ${redactionToken("vercel-ai-gateway-key")}`,
    });
  });

  it("delegates `flush` without buffering anything of its own", async () => {
    const inner = createLocalTraceWriter();
    const writer = createRedactingTraceWriter({ writer: inner });

    await writer.flush();
    await writer.flush();

    expect(inner.flushCount).toBe(2);
  });

  it("lets the inner writer's failure through untouched", async () => {
    const inner = createLocalTraceWriter();
    const writer = createRedactingTraceWriter({ writer: inner });

    inner.fail(new StorageError("the sink is gone"));

    await expect(writer.append(await recorder.record({ type: "run.started" }))).rejects.toThrow(
      StorageError,
    );
  });

  it("applies a policy it is given instead of the default", async () => {
    const writer = createRedactingTraceWriter({
      writer: createLocalTraceWriter(),
      policy: createRedactionPolicy({ fieldPaths: [{ name: "vendor", path: "payload.vendor" }] }),
    });

    expect(writer.redactor.policy.fieldPaths.at(-1)).toEqual({
      name: "vendor",
      path: "payload.vendor",
    });
  });

  it("rejects a non-global pattern at construction, not mid-run", () => {
    expect(() =>
      createRedactingTraceWriter({
        writer: createLocalTraceWriter(),
        policy: {
          fieldPaths: [],
          patterns: [{ name: "once", pattern: /x/ }],
          headers: [],
          toolSanitizers: [],
        },
      }),
    ).toThrow(ValidationError);
  });
});

/**
 * A domain whose input carries credentials, which is the situation the
 * criterion is about: a job's `input` is domain-authored and the harness cannot
 * stop a domain putting a key in it.
 */
interface LeakyInput {
  readonly vendorName: string;
  readonly apiKey: string;
  readonly note: string;
}

interface LeakyOutput {
  readonly category: string;
}

function schemaFor<T>(check: (value: unknown) => value is T, message: string): Schema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown): SchemaResult<T> =>
        check(value) ? { value } : { issues: [{ message, path: [] }] },
    },
  };
}

const leaky = defineDomain<LeakyInput, LeakyOutput>({
  id: "leaky-triage",
  version: "1.0.0",
  inputSchema: schemaFor<LeakyInput>(
    (value): value is LeakyInput =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { vendorName?: unknown }).vendorName === "string",
    "expected `{ vendorName, apiKey, note }`",
  ),
  outputSchema: schemaFor<LeakyOutput>(
    (value): value is LeakyOutput =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { category?: unknown }).category === "string",
    "expected `{ category: string }`",
  ),
  createJob(input) {
    return {
      jobType: "leaky-triage",
      objective: `Triage ${input.vendorName}.`,
      input,
      contracts: {
        inputSchema: "leaky-triage.input@1.0.0",
        outputSchema: "leaky-triage.output@1.0.0",
        sop: "leaky-sop",
      },
      budget: { maxModelCalls: 2, maxToolCalls: 2 },
      permissions: [{ toolId: "lookup_vendor_evidence", mode: "read" }],
      metadata: { fixture: true },
    };
  },
});

const INPUT: LeakyInput = {
  vendorName: "Northwind Ledger",
  apiKey: FAKE.openaiKey,
  note: `pulled with ${FAKE.githubToken} via ${FAKE.supabaseSecretKey}`,
};

const USAGE: AgentExecutionUsage = { modelCalls: 1, toolCalls: 1, durationMs: 3 };
const RUNTIME: RuntimeInfo = { name: "leaky-fake", version: "0.0.0", metadata: {} };

/**
 * An {@link AgentRuntime} that does the worst honest thing an adapter could do:
 * it echoes the job's input straight into the trace, both as a `tool.completed`
 * payload and inside a failure's `details`.
 *
 * That is deliberately against the identity-only payload rule (ADR-0031). The
 * rule is the boundary; this task is the safety net, and a safety net is only
 * proven by something falling into it.
 */
function createLeakyRuntime(outcome: "completed" | "failed"): AgentRuntime {
  return {
    async run<TInput, TOutput>(
      job: Job<TInput, TOutput>,
      context: ExecutionContext,
    ): Promise<AgentExecution<TOutput>> {
      const input = job.input as LeakyInput;

      await context.trace.record({
        type: "tool.completed",
        parentId: context.trace.rootId,
        payload: {
          tool: "lookup_vendor_evidence",
          headers: { authorization: `Bearer ${FAKE.bearerCredential}` },
          echoedInput: { ...input },
          transcript: `called with ${FAKE.awsAccessKeyId}`,
        },
        usage: { toolCalls: 1 },
      });

      if (outcome === "failed") {
        const failure = new ToolExecutionError(`lookup failed for ${FAKE.awsAccessKeyId}`, {
          toolId: "lookup_vendor_evidence",
          cause: new Error(`gateway rejected ${FAKE.vercelGatewayKey}`),
          details: { echoedInput: { ...input } },
        });
        const error = serializeError(failure);

        await context.trace.record({ type: "agent.failed", parentId: context.trace.rootId, error });

        return {
          status: "failed",
          error,
          usage: USAGE,
          runtime: RUNTIME,
        } as AgentExecution<TOutput>;
      }

      await context.trace.record({
        type: "agent.completed",
        parentId: context.trace.rootId,
        payload: { echoedInput: { ...input } },
      });

      return {
        status: "completed",
        output: { category: "bookkeeping" },
        usage: USAGE,
        runtime: RUNTIME,
      } as AgentExecution<TOutput>;
    },
  };
}

/** The chain an application assembles: recorder -> redacting -> buffered -> sink. */
function harnessWritingTo(
  sink: ReturnType<typeof createInMemoryTraceSink>,
): ReturnType<typeof createHarness> {
  return createHarness({
    agentRuntime: createLeakyRuntime("completed"),
    trace: createRedactingTraceWriter({ writer: createBufferedTraceWriter({ sink }) }),
  });
}

describe("end to end: seeded secrets never reach the sink", () => {
  it("removes every seeded secret from a completed run's stored trace", async () => {
    const sink = createInMemoryTraceSink();
    const result = await harnessWritingTo(sink).run({ domain: leaky, input: INPUT });

    expect(result.status).toBe("completed");
    expect(sink.events.length).toBeGreaterThan(0);
    expectNoSeeds(JSON.stringify(sink.events));
  });

  it("removes every seeded secret from a failed run's stored trace, including error `details`", async () => {
    const sink = createInMemoryTraceSink();
    const harness = createHarness({
      agentRuntime: createLeakyRuntime("failed"),
      trace: createRedactingTraceWriter({ writer: createBufferedTraceWriter({ sink }) }),
    });

    const result = await harness.run({ domain: leaky, input: INPUT });

    expect(result.status).toBe("failed");
    expect(sink.events.some((event) => event.type === "run.failed")).toBe(true);
    expectNoSeeds(JSON.stringify(sink.events));
  });

  it("still records the shape of the run: order, types and identity survive", async () => {
    const sink = createInMemoryTraceSink();
    await harnessWritingTo(sink).run({ domain: leaky, input: INPUT });

    expect(sink.events.map((event) => event.type)).toEqual([
      "run.started",
      "tool.completed",
      "agent.completed",
      "run.completed",
    ]);
    expect(sink.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    // The identity-only parts of the leaked payload are kept; only the
    // credentials are gone, and each token names the rule that removed it.
    const tool = sink.events[1];
    expect(tool?.payload.tool).toBe("lookup_vendor_evidence");
    expect(tool?.payload.headers).toEqual({ authorization: redactionToken("header") });
    expect(tool?.payload.transcript).toBe(`called with ${redactionToken("aws-access-key-id")}`);
  });

  it("writes no seeded secret to a JSONL file on disk", async () => {
    const file = join(directory, "run.jsonl");
    const harness = createHarness({
      agentRuntime: createLeakyRuntime("completed"),
      trace: createRedactingTraceWriter({
        writer: createBufferedTraceWriter({ sink: createJsonlFileTraceSink(file) }),
      }),
    });

    await harness.run({ domain: leaky, input: INPUT });

    const written = await readFile(file, "utf8");

    expect(written.split("\n").filter((line) => line !== "")).toHaveLength(4);
    expectNoSeeds(written);
    expect(written).toContain("[REDACTED:");
  });
});
