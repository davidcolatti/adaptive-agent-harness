import { describe, expect, expectTypeOf, it } from "vitest";
import type { AgentExecution, AgentExecutionUsage, AgentRuntime } from "./agent-runtime.js";
import { createExecutionContext } from "./context.js";
import { AgentExecutionError, serializeError } from "./errors.js";
import { newJobId, newRunId } from "./ids.js";
import type { Job } from "./job.js";

interface TriageOutput {
  readonly category: string;
}

const USAGE: AgentExecutionUsage = { modelCalls: 1, toolCalls: 2, durationMs: 5 };
const RUNTIME = { name: "test", version: "0.0.0", metadata: {} };

const JOB: Job<{ vendorName: string }, TriageOutput> = {
  id: newJobId(),
  domain: { id: "triage", version: "1.0.0" },
  jobType: "triage",
  objective: "Triage Acme.",
  input: { vendorName: "Acme" },
  contracts: { inputSchema: "a", outputSchema: "b", sop: "c" },
  budget: {},
  permissions: [],
  metadata: {},
};

describe("AgentExecution", () => {
  it("narrows on `status` without a type guard", () => {
    const execution: AgentExecution<TriageOutput> = {
      status: "completed",
      output: { category: "bookkeeping" },
      usage: USAGE,
      runtime: RUNTIME,
    };

    if (execution.status === "completed") {
      expectTypeOf(execution.output).toEqualTypeOf<TriageOutput>();
      expect(execution.output.category).toBe("bookkeeping");
    } else {
      expect.unreachable("expected the completed variant");
    }
  });

  it("carries a failure as a serialized harness error, not a thrown one", () => {
    const execution: AgentExecution<TriageOutput> = {
      status: "failed",
      error: serializeError(new AgentExecutionError("the model refused")),
      usage: USAGE,
      runtime: RUNTIME,
    };

    expect(execution.status === "failed" && execution.error.code).toBe("AGENT_EXECUTION");
  });

  it("reports usage on every variant, including an abort", () => {
    const execution: AgentExecution<TriageOutput> = {
      status: "aborted",
      usage: { modelCalls: 0, toolCalls: 0, durationMs: 1 },
      runtime: RUNTIME,
    };

    expect(execution.usage.durationMs).toBe(1);
  });

  it("does not let a completed execution omit its output", () => {
    // @ts-expect-error `completed` requires `output`.
    const execution: AgentExecution<TriageOutput> = {
      status: "completed",
      usage: USAGE,
      runtime: RUNTIME,
    };

    expect(execution.status).toBe("completed");
  });
});

describe("AgentRuntime", () => {
  it("infers the output type from the job it is handed", async () => {
    const runtime: AgentRuntime = {
      run<_TInput, TOutput>(): Promise<AgentExecution<TOutput>> {
        return Promise.resolve({ status: "aborted", usage: USAGE, runtime: RUNTIME });
      },
    };

    const context = createExecutionContext({
      runId: newRunId(),
      jobId: JOB.id,
      domain: JOB.domain,
      runtime: { name: "test", version: "0.0.0" },
    });

    const execution = runtime.run(JOB, context);

    expectTypeOf(execution).toEqualTypeOf<Promise<AgentExecution<TriageOutput>>>();
    await expect(execution).resolves.toMatchObject({ status: "aborted" });
  });
});
