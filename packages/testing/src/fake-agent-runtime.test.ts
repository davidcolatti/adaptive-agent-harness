import {
  type AgentExecution,
  AgentExecutionError,
  type AgentExecutionUsage,
  createExecutionContext,
  type ExecutionContext,
  type Job,
  serializeError,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { createFakeAgentRuntime } from "./fake-agent-runtime.js";

interface TriageOutput {
  readonly category: string;
}

const USAGE: AgentExecutionUsage = { modelCalls: 1, toolCalls: 1, durationMs: 3 };
const RUNTIME = { name: "fake", version: "0.0.0", metadata: {} };

const JOB: Job<{ vendorName: string }, TriageOutput> = {
  id: "job_1",
  domain: { id: "vendor-triage", version: "1.0.0" },
  jobType: "vendor-triage",
  objective: "Triage Acme.",
  input: { vendorName: "Acme" },
  contracts: {
    inputSchema: "vendor-triage.input@1.0.0",
    outputSchema: "vendor-triage.output@1.0.0",
    sop: "procurement-sop",
  },
  budget: {},
  permissions: [],
  metadata: {},
};

const COMPLETED: AgentExecution = {
  status: "completed",
  output: { category: "bookkeeping" },
  usage: USAGE,
  runtime: RUNTIME,
};

function contextWith(signal?: AbortSignal): ExecutionContext {
  return createExecutionContext({
    runId: "run_1",
    jobId: JOB.id,
    domain: JOB.domain,
    runtime: { name: "fake", version: "0.0.0" },
    ...(signal === undefined ? {} : { signal }),
  });
}

describe("createFakeAgentRuntime", () => {
  it("returns the scripted result", async () => {
    const runtime = createFakeAgentRuntime({ result: COMPLETED });

    const execution = await runtime.run(JOB, contextWith());

    expect(execution.status).toBe("completed");
    expect(execution.status === "completed" && execution.output).toEqual({
      category: "bookkeeping",
    });
  });

  it("types the scripted output as the job's output type", async () => {
    const runtime = createFakeAgentRuntime({ result: COMPLETED });

    const execution = await runtime.run(JOB, contextWith());

    if (execution.status !== "completed") {
      expect.unreachable("expected the completed variant");
    } else {
      // `execution.output` is `TriageOutput` here, taken from the job.
      expect(execution.output.category).toBe("bookkeeping");
    }
  });

  it("records every call with the job and context it was given", async () => {
    const runtime = createFakeAgentRuntime({ result: COMPLETED });
    const context = contextWith();

    await runtime.run(JOB, context);
    await runtime.run(JOB, context);

    expect(runtime.calls).toHaveLength(2);
    expect(runtime.calls[0]?.job).toBe(JOB);
    expect(runtime.calls[0]?.context).toBe(context);
  });

  it("consults a handler with the job and context", async () => {
    const runtime = createFakeAgentRuntime({
      handler: (job) => ({
        status: "completed",
        output: { category: `seen ${job.jobType}` },
        usage: USAGE,
        runtime: RUNTIME,
      }),
    });

    const execution = await runtime.run(JOB, contextWith());

    expect(execution.status === "completed" && execution.output).toEqual({
      category: "seen vendor-triage",
    });
  });

  it("can script a failure without throwing", async () => {
    const runtime = createFakeAgentRuntime({
      result: {
        status: "failed",
        error: serializeError(new AgentExecutionError("the model refused")),
        usage: USAGE,
        runtime: RUNTIME,
      },
    });

    const execution = await runtime.run(JOB, contextWith());

    expect(execution.status === "failed" && execution.error.code).toBe("AGENT_EXECUTION");
  });

  it("reports `aborted` when the signal has already fired, without consulting the handler", async () => {
    let handlerCalls = 0;
    const runtime = createFakeAgentRuntime({
      handler: () => {
        handlerCalls += 1;
        return COMPLETED;
      },
    });

    const execution = await runtime.run(JOB, contextWith(AbortSignal.abort()));

    expect(execution.status).toBe("aborted");
    expect(handlerCalls).toBe(0);
    // The call still happened: the runtime was reached, then cancelled.
    expect(runtime.calls).toHaveLength(1);
  });

  it("reports `aborted` when the signal fires while the run is in flight", async () => {
    const controller = new AbortController();
    const runtime = createFakeAgentRuntime({ result: COMPLETED, delayMs: 10_000 });

    const pending = runtime.run(JOB, contextWith(controller.signal));
    controller.abort();

    await expect(pending).resolves.toMatchObject({ status: "aborted" });
  });

  it("completes normally when the delay elapses without an abort", async () => {
    const runtime = createFakeAgentRuntime({ result: COMPLETED, delayMs: 1 });

    await expect(runtime.run(JOB, contextWith())).resolves.toMatchObject({ status: "completed" });
  });

  it("reports the runtime info it was given", async () => {
    const runtime = createFakeAgentRuntime({
      result: COMPLETED,
      runtime: { name: "fake-eve", version: "1.2.3", metadata: { sessionKind: "test" } },
    });

    const execution = await runtime.run(JOB, contextWith(AbortSignal.abort()));

    expect(execution.runtime).toEqual({
      name: "fake-eve",
      version: "1.2.3",
      metadata: { sessionKind: "test" },
    });
  });
});
