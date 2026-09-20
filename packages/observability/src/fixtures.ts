import {
  type AgentExecution,
  AgentExecutionError,
  type BehaviorDescriptor,
  createHarness,
  type DomainDefinition,
  defineDomain,
  type ExecutionContext,
  type HarnessRunResult,
  type Job,
  type RuntimeInfo,
  type Schema,
  type SchemaResult,
  type Storage,
  serializeError,
} from "@internal/core";
import {
  createFakeAgentRuntime,
  createInMemoryStorage,
  type InMemoryStorage,
} from "@internal/testing";
import {
  createBufferedTraceWriter,
  createFanOutTraceSink,
  createStorageTraceSink,
  type TraceSink,
} from "@internal/trace";

/**
 * The shared fixture the inspector's tests inspect: a **real** harness run,
 * recorded into a real `Storage` through the real writer chain.
 *
 * Fabricating a `RunRecord` and a list of `TraceEvent`s by hand would test the
 * inspector against a shape someone imagined rather than against what
 * `createHarness()` actually writes, which is the one thing the inspector has
 * to be right about. So this builds the genuine article with only the agent
 * runtime faked, exactly as `apps/example-agent/src/domain/harness.test.ts`
 * does, and the tests read the result back through the port.
 *
 * It is excluded from `tsconfig.build.json`, so it is not part of the published
 * package; it exists only for the co-located tests.
 */

function objectSchema<T>(check: (value: unknown) => value is T, message: string): Schema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "observability-fixture",
      validate: (value: unknown): SchemaResult<T> =>
        check(value) ? { value } : { issues: [{ message, path: [] }] },
    },
  };
}

/** The fixture domain's input. */
export interface FixtureInput {
  readonly vendorName: string;
}

/** The fixture domain's output. */
export interface FixtureOutput {
  readonly category: string;
}

const inputSchema = objectSchema<FixtureInput>(
  (value): value is FixtureInput =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { vendorName?: unknown }).vendorName === "string",
  "expected `{ vendorName: string }`",
);

const outputSchema = objectSchema<FixtureOutput>(
  (value): value is FixtureOutput =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { category?: unknown }).category === "string",
  "expected `{ category: string }`",
);

/** A closed behavior descriptor, so the run carries real component digests. */
const BEHAVIOR: BehaviorDescriptor = {
  instructions: "Triage the vendor against the SOP.",
  sop: "1. Read the evidence. 2. Decide.",
  skills: [{ id: "triage-skill", content: "How to triage." }],
  tools: [{ id: "lookup", version: "1.0.0", definitionFingerprint: "sha256:tool" }],
  model: { model: "fixture-model", temperature: 0 },
  schemas: [{ ref: "fixture.input@1.0.0", fingerprint: "sha256:schema" }],
  workflowIr: null,
  policy: { riskThreshold: 0.5 },
};

/** The fixture domain. One job type, one tool grant, a real behavior descriptor. */
export const fixtureDomain: DomainDefinition<FixtureInput, FixtureOutput> = defineDomain<
  FixtureInput,
  FixtureOutput
>({
  id: "vendor-triage-fixture",
  version: "1.0.0",
  inputSchema,
  outputSchema,
  behavior: BEHAVIOR,
  createJob(input) {
    return {
      jobType: "triage",
      objective: `Triage ${input.vendorName}.`,
      input,
      contracts: {
        inputSchema: "fixture.input@1.0.0",
        outputSchema: "fixture.output@1.0.0",
        sop: "fixture-sop",
      },
      budget: { maxModelCalls: 4, maxToolCalls: 4 },
      permissions: [{ toolId: "lookup", mode: "read" }],
      metadata: { fixture: true },
    };
  },
});

const RUNTIME: RuntimeInfo = { name: "fake-eve", version: "0.0.0", metadata: { scripted: true } };

/** Which of the three terminal states the fixture run reaches. */
export type FixtureOutcome = "completed" | "failed" | "aborted";

/** What {@link recordFixtureRun} accepts. */
export interface RecordFixtureRunOptions<TStorage extends Storage = InMemoryStorage> {
  /** How the run ends. Defaults to `completed`. */
  readonly outcome?: FixtureOutcome;
  /**
   * Where the run is recorded. Defaults to a fresh in-memory store.
   *
   * Generic over the implementation so the integration suite can hand in the
   * real Supabase adapter and still get its own type back, while the unit
   * suites keep `InMemoryStorage`'s assertion helpers.
   */
  readonly storage?: TStorage;
  /** Extra sinks the trace is also written to, e.g. a JSONL file. */
  readonly sinks?: readonly TraceSink[];
}

/** What a fixture run leaves behind. */
export interface RecordedFixtureRun<TStorage extends Storage = InMemoryStorage> {
  /** The store the run was recorded in. */
  readonly storage: TStorage;
  /** The harness result, so a test can compare the ledger against it. */
  readonly result: HarnessRunResult<unknown>;
}

/**
 * Emit a realistic agent span tree, then end the way the outcome says.
 *
 * One `agent` span with a `model` call and a `tool` call under it, which is the
 * smallest trace that exercises every branch of the inspector's call pairing:
 * two kinds, a parent that is not the run root, and (for a failed run) a span
 * whose terminal event carries an error.
 */
function fixtureHandler(outcome: FixtureOutcome) {
  return async (_job: Job, context: ExecutionContext): Promise<AgentExecution> => {
    const agent = await context.trace.span({
      type: "agent.started",
      parentId: context.trace.rootId,
    });
    const model = await context.trace.span({
      type: "model.started",
      parentId: agent.id,
      payload: { modelId: "fixture-model" },
    });

    if (outcome === "failed") {
      const error = serializeError(
        new AgentExecutionError("the fixture model refused", { details: { attempt: 1 } }),
      );

      await model.end({
        type: "model.failed",
        payload: { modelId: "fixture-model", code: "MODEL_CALL_FAILED" },
        usage: { modelCalls: 1, inputTokens: 120, costUsd: 0.001 },
        error,
      });
      await agent.end({ type: "agent.failed", error });

      return {
        status: "failed",
        error,
        usage: { modelCalls: 1, toolCalls: 0, durationMs: 9, costUsd: 0.001 },
        runtime: RUNTIME,
      };
    }

    await model.end({
      type: "model.completed",
      payload: { modelId: "fixture-model", finishReason: "stop" },
      usage: {
        modelCalls: 1,
        inputTokens: 120,
        outputTokens: 40,
        cacheReadTokens: 8,
        costUsd: 0.002,
      },
    });

    const tool = await context.trace.span({
      type: "tool.started",
      parentId: agent.id,
      payload: { tool: "lookup" },
    });

    await tool.end({
      type: "tool.completed",
      payload: { tool: "lookup", status: "ok" },
      usage: { toolCalls: 1 },
    });

    if (outcome === "aborted") {
      await agent.end({ type: "agent.failed", payload: { cancelled: true } });

      return {
        status: "aborted",
        usage: { modelCalls: 1, toolCalls: 1, durationMs: 11, costUsd: 0.002 },
        runtime: RUNTIME,
      };
    }

    await agent.end({ type: "agent.completed", usage: { modelCalls: 1, toolCalls: 1 } });

    return {
      status: "completed",
      output: { category: "cloud bookkeeping" } satisfies FixtureOutput,
      usage: { modelCalls: 1, toolCalls: 1, durationMs: 13, costUsd: 0.002 },
      runtime: RUNTIME,
    };
  };
}

/**
 * Run the fixture domain through a real `createHarness()` and record it.
 *
 * ```ts
 * const { storage, result } = await recordFixtureRun({ outcome: "failed" });
 * const inspection = await inspectRun(storage, result.runId);
 * ```
 */
export async function recordFixtureRun<TStorage extends Storage = InMemoryStorage>(
  options: RecordFixtureRunOptions<TStorage> = {},
): Promise<RecordedFixtureRun<TStorage>> {
  const outcome = options.outcome ?? "completed";
  const storage = (options.storage ?? createInMemoryStorage()) as TStorage;
  const sinks: TraceSink[] = [createStorageTraceSink({ storage }), ...(options.sinks ?? [])];
  const harness = createHarness({
    agentRuntime: createFakeAgentRuntime({ handler: fixtureHandler(outcome) }),
    trace: createBufferedTraceWriter({ sink: createFanOutTraceSink(sinks) }),
    storage,
    target: "@internal/observability-fixture",
  });

  const result = await harness.run({ domain: fixtureDomain, input: { vendorName: "Northwind" } });

  return { storage, result };
}
