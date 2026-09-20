import { newRunId, type RunId, type TraceEvent } from "@internal/core";
import { createInMemoryStorage } from "@internal/testing";
import { describe, expect, it } from "vitest";
import { recordFixtureRun } from "./fixtures.js";
import { inspectRun, type TraceOnlySource } from "./inspect-run.js";

/**
 * `inspectRun()` (M2-T10), against real runs recorded by a real harness.
 *
 * Every case here starts from `recordFixtureRun()`, which runs
 * `createHarness()` with a fake agent runtime and records the result into an
 * in-memory `Storage` through the real buffered writer. So what is being
 * asserted is that the inspector reads what the harness actually writes, not
 * that it reads a shape this file imagined.
 */

/** A trace-only source over a fixed event list, for the partial-evidence cases. */
function traceSource(events: readonly TraceEvent[]): TraceOnlySource {
  return {
    kind: "trace",
    description: "a fixed event list",
    readTrace(runId: RunId): Promise<readonly TraceEvent[]> {
      return Promise.resolve(events.filter((event) => event.runId === runId));
    },
  };
}

describe("inspectRun: a completed run", () => {
  it("finds the run, its job and its trace", async () => {
    const { storage, result } = await recordFixtureRun();

    const inspection = await inspectRun(storage, result.runId);

    expect(inspection.found).toBe(true);
    expect(inspection.source).toBe("storage");
    expect(inspection.availability).toEqual({ run: true, job: true, trace: true });
    expect(inspection.notes).toEqual([]);
    expect(inspection.job?.id).toBe(result.jobId);
    expect(inspection.run?.runId).toBe(result.runId);
  });

  it("reports the route as full-agent with no workflow version", async () => {
    const { storage, result } = await recordFixtureRun();

    const { route } = await inspectRun(storage, result.runId);

    expect(route.route).toBe("full-agent");
    expect(route.workflowVersionId).toBeNull();
    expect(route.fallbackCount).toBe(0);
    expect(route.fallbackSource).toBe("ledger");
    expect(route.target).toBe("@internal/observability-fixture");
    expect(route.domain).toEqual({ id: "vendor-triage-fixture", version: "1.0.0" });
    expect(route.jobType).toBe("triage");
    expect(route.runtime?.name).toBe("fake-eve");
  });

  it("lists every event once, in sequence order, with monotonic offsets", async () => {
    const { storage, result } = await recordFixtureRun();

    const { timeline } = await inspectRun(storage, result.runId);

    expect(timeline.map((entry) => entry.type)).toEqual([
      "run.started",
      "agent.started",
      "model.started",
      "model.completed",
      "tool.started",
      "tool.completed",
      "agent.completed",
      "run.completed",
    ]);
    expect(timeline.map((entry) => entry.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const offsets = timeline.map((entry) => entry.offsetMs);

    expect(offsets[0]).toBe(0);
    expect(offsets.every((offset) => offset !== null)).toBe(true);
    expect(offsets).toEqual([...(offsets as number[])].toSorted((a, b) => a - b));
  });

  it("summarizes each event's identity from its payload, skipping the behavior digests", async () => {
    const { storage, result } = await recordFixtureRun();

    const byType = new Map(
      (await inspectRun(storage, result.runId)).timeline.map((entry) => [
        entry.type,
        entry.summary,
      ]),
    );

    expect(byType.get("model.started")).toBe("modelId=fixture-model");
    expect(byType.get("tool.completed")).toBe("status=ok tool=lookup");
    // `run.started` carries the component digests under `behavior`, which is an
    // object and therefore never lands in a one-line summary.
    expect(byType.get("run.started")).not.toContain("behavior");
    expect(byType.get("run.started")).toContain("jobType=triage");
  });

  it("pairs each started call with its terminal event and totals the latencies", async () => {
    const { storage, result } = await recordFixtureRun();

    const { calls } = await inspectRun(storage, result.runId);

    expect(calls.model.count).toBe(1);
    expect(calls.model.calls[0]).toMatchObject({
      id: "fixture-model",
      status: "completed",
      errorCode: null,
    });
    expect(calls.model.totalLatencyMs).toBeTypeOf("number");
    expect(calls.tool.count).toBe(1);
    expect(calls.tool.calls[0]).toMatchObject({ id: "lookup", status: "completed" });
    expect(calls.jev.count).toBe(0);
    expect(calls.jevCalls).toBe(0);
    expect(calls.jevNote).toContain("M3");
  });

  it("reports no errors and a completed result", async () => {
    const { storage, result } = await recordFixtureRun();

    const inspection = await inspectRun(storage, result.runId);

    expect(inspection.errors).toEqual([]);
    expect(inspection.result.status).toBe("completed");
    expect(inspection.result.statusSource).toBe("ledger");
    expect(inspection.result.success).toBe(true);
    expect(inspection.result.finishedAt).not.toBeNull();
  });

  it("says the output is not persisted rather than inventing one", async () => {
    const { storage, result } = await recordFixtureRun();

    const { result: inspected } = await inspectRun(storage, result.runId);

    expect(inspected.output).toBeNull();
    expect(inspected.outputNote).toContain("not persisted in Milestone 2");
    expect(inspected.outputNote).toContain("artifacts");
  });

  it("sums the trace's token and cost usage beside the ledger's figures", async () => {
    const { storage, result } = await recordFixtureRun();

    const { cost } = await inspectRun(storage, result.runId);

    expect(cost.costUsd).toBe(0.002);
    expect(cost.tracedCostUsd).toBe(0.002);
    expect(cost.modelCalls).toBe(1);
    expect(cost.toolCalls).toBe(1);
    expect(cost.tokens).toEqual({
      inputTokens: 120,
      outputTokens: 40,
      cacheReadTokens: 8,
      cacheWriteTokens: null,
      totalTokens: 160,
    });
  });

  it("reports the fingerprint as consistent, with the run.started component digests", async () => {
    const { storage, result } = await recordFixtureRun();

    const { fingerprints } = await inspectRun(storage, result.runId);

    expect(fingerprints.consistent).toBe(true);
    expect(fingerprints.inconsistentSequences).toEqual([]);
    expect(fingerprints.run).toMatch(/^sha256:/);
    expect(fingerprints.trace).toBe(fingerprints.run);
    expect(fingerprints.agentVersion).toBe(fingerprints.run);
    expect(fingerprints.scheme).toBe(1);
    expect(fingerprints.algorithm).toBe("sha256");
    expect(Object.keys(fingerprints.components ?? {}).toSorted()).toEqual([
      "instructions",
      "model",
      "policy",
      "schemas",
      "skills",
      "sop",
      "tools",
      "workflowIr",
    ]);
  });
});

describe("inspectRun: a failed run", () => {
  it("remains inspectable, with the failure from both the trace and the ledger", async () => {
    const { storage, result } = await recordFixtureRun({ outcome: "failed" });

    const inspection = await inspectRun(storage, result.runId);

    expect(inspection.found).toBe(true);
    expect(inspection.result.status).toBe("failed");
    expect(inspection.result.success).toBe(false);
    expect(inspection.errors.map((entry) => entry.source)).toEqual([
      "trace",
      "trace",
      "trace",
      "ledger",
    ]);
    expect(inspection.errors.at(-1)?.error.code).toBe("AGENT_EXECUTION");
    expect(inspection.errors[0]).toMatchObject({ source: "trace", type: "model.failed" });
  });

  it("marks the failed model call and leaves the tool group empty", async () => {
    const { storage, result } = await recordFixtureRun({ outcome: "failed" });

    const { calls } = await inspectRun(storage, result.runId);

    expect(calls.model.calls[0]).toMatchObject({
      id: "fixture-model",
      status: "failed",
      errorCode: "AGENT_EXECUTION",
    });
    expect(calls.tool.count).toBe(0);
  });
});

describe("inspectRun: an aborted run", () => {
  it("reports aborted with a null success rather than a failure", async () => {
    const { storage, result } = await recordFixtureRun({ outcome: "aborted" });

    const inspection = await inspectRun(storage, result.runId);

    expect(inspection.result.status).toBe("aborted");
    expect(inspection.result.success).toBeNull();
    expect(inspection.errors).toEqual([]);
  });
});

describe("inspectRun: partial evidence", () => {
  it("reports a run that does not exist as not found, without throwing", async () => {
    const inspection = await inspectRun(createInMemoryStorage(), newRunId());

    expect(inspection.found).toBe(false);
    expect(inspection.availability).toEqual({ run: false, job: false, trace: false });
    expect(inspection.notes).toEqual([
      "no ledger row for this run; the trace is the only record of it",
      "no trace events for this run",
    ]);
    expect(inspection.timeline).toEqual([]);
    expect(inspection.result.status).toBeNull();
  });

  it("inspects a trace with no ledger row and derives the status from it", async () => {
    const { storage, result } = await recordFixtureRun();
    const events = storage.events.filter((event) => event.runId === result.runId);

    const inspection = await inspectRun(traceSource(events), result.runId);

    expect(inspection.found).toBe(true);
    expect(inspection.source).toBe("trace");
    expect(inspection.availability).toEqual({ run: false, job: false, trace: true });
    expect(inspection.notes).toEqual(["job and ledger row unavailable (trace-only source)"]);
    expect(inspection.job).toBeNull();
    expect(inspection.run).toBeNull();
    expect(inspection.result.status).toBe("completed");
    expect(inspection.result.statusSource).toBe("trace");
    expect(inspection.calls.model.count).toBe(1);
    expect(inspection.route.domain).toEqual({ id: "vendor-triage-fixture", version: "1.0.0" });
    expect(inspection.route.fallbackSource).toBe("trace");
    expect(inspection.fingerprints.consistent).toBe(true);
    expect(inspection.cost.costUsd).toBeNull();
    expect(inspection.cost.tracedCostUsd).toBe(0.002);
  });

  it("inspects a ledger row with no trace and says the trace is missing", async () => {
    const { storage, result } = await recordFixtureRun();
    // A crash between `startRun` and the first flush leaves exactly this.
    const bare = createInMemoryStorage();
    const job = await storage.getJob(result.jobId);
    const row = await storage.getRun(result.runId);

    expect(job).not.toBeNull();
    expect(row).not.toBeNull();

    if (job === null || row === null) {
      expect.unreachable("the fixture must have written a job and a run");
    }

    await bare.saveJob(job);
    await bare.startRun({
      runId: row.runId,
      jobId: row.jobId,
      attempt: row.attempt,
      domain: row.domain,
      jobType: row.jobType,
      behaviorFingerprint: row.behaviorFingerprint,
      agentVersion: row.agentVersion,
      workflowVersionId: row.workflowVersionId,
      target: row.target,
      runtime: row.runtime,
      startedAt: row.startedAt,
    });

    const inspection = await inspectRun(bare, result.runId);

    expect(inspection.found).toBe(true);
    expect(inspection.availability).toEqual({ run: true, job: true, trace: false });
    expect(inspection.notes).toEqual(["no trace events for this run"]);
    expect(inspection.result.status).toBe("running");
    expect(inspection.timeline).toEqual([]);
    expect(inspection.fingerprints.components).toBeNull();
  });

  it("flags an event whose fingerprint disagrees with the run's", async () => {
    const { storage, result } = await recordFixtureRun();
    const events = storage.events
      .filter((event) => event.runId === result.runId)
      .map((event, index) =>
        index === 2 ? { ...event, behaviorFingerprint: "sha256:different" } : event,
      );

    const { fingerprints } = await inspectRun(traceSource(events), result.runId);

    expect(fingerprints.consistent).toBe(false);
    expect(fingerprints.inconsistentSequences).toEqual([2]);
  });
});

describe("inspectRun: paging", () => {
  it("follows the trace cursor to the end rather than reading one page", async () => {
    const { storage, result } = await recordFixtureRun();
    // A store whose pages are one event long, so a reader that took the first
    // page and stopped would visibly lose seven events.
    const paged = {
      ...storage,
      getTrace: (runId: typeof result.runId, cursor?: { readonly after?: number }) =>
        storage.getTrace(runId, { ...cursor, limit: 1 }),
    };

    const inspection = await inspectRun(paged, result.runId);

    expect(inspection.timeline).toHaveLength(8);
  });
});
