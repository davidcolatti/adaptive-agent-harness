import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type Budget,
  createExecutionContext,
  type ExecutionContext,
  type ToolGrant,
} from "./context.js";
import { ValidationError } from "./errors.js";
import { type JobId, newJobId, newRunId, type RunId } from "./ids.js";
import type { JsonObject } from "./json.js";

const RUN_ID = newRunId();
const JOB_ID = newJobId();

const REQUIRED = {
  runId: RUN_ID,
  jobId: JOB_ID,
  domain: { id: "vendor-triage", version: "1.0.0" },
  runtime: { name: "eve", version: "0.63.0" },
} as const;

describe("ExecutionContext", () => {
  it("carries every field M1-T7 requires", () => {
    // Branded since M2-T1 (ADR-0030): a bare `string`, or the other kind of
    // id, is a compile error here rather than a silent mix-up.
    expectTypeOf<ExecutionContext["runId"]>().toEqualTypeOf<RunId>();
    expectTypeOf<ExecutionContext["jobId"]>().toEqualTypeOf<JobId>();
    expectTypeOf<ExecutionContext["attempt"]>().toEqualTypeOf<number>();
    expectTypeOf<ExecutionContext["signal"]>().toEqualTypeOf<AbortSignal>();
    expectTypeOf<ExecutionContext["permissions"]>().toEqualTypeOf<readonly ToolGrant[]>();
    expectTypeOf<ExecutionContext["runtime"]["metadata"]>().toEqualTypeOf<JsonObject>();
  });

  it("matches the budget dimensions the build plan fixes for Job.budget", () => {
    expectTypeOf<keyof Budget>().toEqualTypeOf<
      "maxCostUsd" | "maxDurationMs" | "maxModelCalls" | "maxToolCalls"
    >();
  });
});

describe("createExecutionContext", () => {
  it("copies through the fields it is given", () => {
    const signal = AbortSignal.abort();
    const permissions: readonly ToolGrant[] = [{ toolId: "fixture.read", mode: "read" }];

    const context = createExecutionContext({
      ...REQUIRED,
      attempt: 3,
      budget: { maxModelCalls: 4 },
      permissions,
      signal,
      runtime: { name: "eve", version: "0.63.0", metadata: { sessionKind: "local" } },
    });

    expect(context.runId).toBe(RUN_ID);
    expect(context.jobId).toBe(JOB_ID);
    expect(context.domain).toEqual({ id: "vendor-triage", version: "1.0.0" });
    expect(context.attempt).toBe(3);
    expect(context.budget).toEqual({ maxModelCalls: 4 });
    expect(context.permissions).toBe(permissions);
    expect(context.signal).toBe(signal);
    expect(context.runtime).toEqual({
      name: "eve",
      version: "0.63.0",
      metadata: { sessionKind: "local" },
    });
  });

  it("defaults the attempt to the first one", () => {
    expect(createExecutionContext(REQUIRED).attempt).toBe(1);
  });

  it("defaults to an unlimited budget and to no permissions at all", () => {
    const context = createExecutionContext(REQUIRED);

    expect(context.budget).toEqual({});
    expect(context.permissions).toEqual([]);
  });

  it("defaults runtime metadata to an empty object", () => {
    expect(createExecutionContext(REQUIRED).runtime.metadata).toEqual({});
  });

  it("defaults to a trace writer that accepts events", async () => {
    const context = createExecutionContext(REQUIRED);

    await expect(
      context.trace.append({
        runId: context.runId,
        sequence: 0,
        timestamp: "2026-01-02T03:04:05.000Z",
        type: "run.started",
        payload: {},
      }),
    ).resolves.toBeUndefined();
    await expect(context.trace.flush()).resolves.toBeUndefined();
  });

  it("defaults to a signal that is not aborted and never will be", () => {
    const { signal } = createExecutionContext(REQUIRED);

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("gives each context its own default signal", () => {
    expect(createExecutionContext(REQUIRED).signal).not.toBe(
      createExecutionContext(REQUIRED).signal,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects attempt %p, because attempts are 1-based",
    (attempt) => {
      expect(() => createExecutionContext({ ...REQUIRED, attempt })).toThrow(ValidationError);
    },
  );

  it("reports which field was wrong", () => {
    try {
      createExecutionContext({ ...REQUIRED, attempt: 0 });
      expect.unreachable("createExecutionContext should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues).toEqual([
        { path: ["attempt"], message: "expected an integer >= 1, received 0" },
      ]);
    }
  });
});
