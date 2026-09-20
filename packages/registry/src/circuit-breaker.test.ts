import {
  HARNESS_RUNTIME_INFO,
  newJobId,
  newRunId,
  type RunStatus,
  type WorkflowVersionId,
} from "@internal/core";
import { createInMemoryStorage, type InMemoryStorage } from "@internal/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { type CircuitBreaker, createCircuitBreaker } from "./circuit-breaker.js";
import { compileFixture, createFixtureCapabilities, FIXTURE_DOMAIN } from "./test-workflow.js";
import { createWorkflowRegistry, type WorkflowRegistry } from "./workflow-registry.js";

/**
 * The circuit breaker (M5-T7, ADR-0044).
 *
 * Every test runs against the in-memory `Storage`, which is a real
 * implementation of the port rather than a stub, so what passes here is a
 * statement about the contract the Supabase adapter satisfies too.
 */

/** One finished run of `versionId`, with the outcome the window will see. */
async function recordRun(
  storage: InMemoryStorage,
  versionId: WorkflowVersionId | null,
  outcome: { readonly status: Exclude<RunStatus, "running">; readonly fallbackCount: number },
): Promise<void> {
  const runId = newRunId();
  const at = new Date().toISOString();

  await storage.startRun({
    runId,
    jobId: newJobId(),
    attempt: 1,
    domain: { ...FIXTURE_DOMAIN },
    jobType: "triage",
    behaviorFingerprint: null,
    agentVersion: null,
    workflowVersionId: versionId,
    target: null,
    runtime: HARNESS_RUNTIME_INFO,
    startedAt: at,
  });

  await storage.finishRun({
    runId,
    status: outcome.status,
    success: outcome.status === "aborted" ? null : outcome.status === "completed",
    costUsd: null,
    latencyMs: 5,
    modelCalls: 1,
    toolCalls: 0,
    jevCalls: 0,
    fallbackCount: outcome.fallbackCount,
    runtime: HARNESS_RUNTIME_INFO,
    finishedAt: at,
    error: null,
  });
}

describe("createCircuitBreaker", () => {
  let storage: InMemoryStorage;
  let registry: WorkflowRegistry;
  let breaker: CircuitBreaker;
  let versionId: WorkflowVersionId;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    registry = createWorkflowRegistry({ storage });
    breaker = createCircuitBreaker({
      storage,
      registry,
      window: { runs: 4 },
      thresholds: { fallbackRate: 0.5, failureRate: 0.5 },
    });

    const capabilities = createFixtureCapabilities();
    const draft = await registry.register(compileFixture(capabilities), {
      domain: { ...FIXTURE_DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    await registry.promote(draft.id, "candidate", { actor: "david" });
    await registry.promote(draft.id, "active", { actor: "david" });
    versionId = draft.id;
  });

  it("does not trip on no evidence at all", async () => {
    // An untried workflow is not a failing one, and `0/0` is not `1`.
    expect(await breaker.evaluate(versionId)).toEqual({
      tripped: false,
      fallbackRate: 0,
      failureRate: 0,
      sample: 0,
    });
  });

  it("trips when the fallback rate reaches the threshold", async () => {
    await recordRun(storage, versionId, { status: "completed", fallbackCount: 1 });
    await recordRun(storage, versionId, { status: "completed", fallbackCount: 0 });

    const reading = await breaker.evaluate(versionId);

    expect(reading).toEqual({ tripped: true, fallbackRate: 0.5, failureRate: 0, sample: 2 });
  });

  it("trips when the failure rate reaches the threshold", async () => {
    await recordRun(storage, versionId, { status: "failed", fallbackCount: 0 });
    await recordRun(storage, versionId, { status: "completed", fallbackCount: 0 });

    const reading = await breaker.evaluate(versionId);

    expect(reading).toMatchObject({ tripped: true, failureRate: 0.5, sample: 2 });
  });

  it("stays closed below both thresholds", async () => {
    for (const _ of [0, 1, 2]) {
      await recordRun(storage, versionId, { status: "completed", fallbackCount: 0 });
    }
    await recordRun(storage, versionId, { status: "completed", fallbackCount: 1 });

    const reading = await breaker.evaluate(versionId);

    expect(reading).toEqual({ tripped: false, fallbackRate: 0.25, failureRate: 0, sample: 4 });
  });

  it("counts only this version's runs", async () => {
    // A run of no workflow at all — the full agent — is not evidence about this
    // version, however badly it went.
    await recordRun(storage, null, { status: "failed", fallbackCount: 0 });
    await recordRun(storage, versionId, { status: "completed", fallbackCount: 0 });

    expect(await breaker.evaluate(versionId)).toMatchObject({ sample: 1, failureRate: 0 });
  });

  it("ignores a run its caller aborted", async () => {
    // A cancellation is evidence about the caller, not about the workflow.
    await recordRun(storage, versionId, { status: "aborted", fallbackCount: 0 });
    await recordRun(storage, versionId, { status: "completed", fallbackCount: 0 });

    expect(await breaker.evaluate(versionId)).toMatchObject({ sample: 1, tripped: false });
  });

  it("ignores a run that has not finished", async () => {
    await storage.startRun({
      runId: newRunId(),
      jobId: newJobId(),
      attempt: 1,
      domain: { ...FIXTURE_DOMAIN },
      jobType: "triage",
      behaviorFingerprint: null,
      agentVersion: null,
      workflowVersionId: versionId,
      target: null,
      runtime: HARNESS_RUNTIME_INFO,
      startedAt: new Date().toISOString(),
    });

    expect(await breaker.evaluate(versionId)).toMatchObject({ sample: 0, tripped: false });
  });

  it("looks no further back than the window", async () => {
    // Four failures, then four clean runs. With a window of four, the breaker
    // sees only the clean ones: a workflow that was fixed is not still broken.
    for (const _ of [0, 1, 2, 3]) {
      await recordRun(storage, versionId, { status: "failed", fallbackCount: 1 });
    }
    for (const _ of [0, 1, 2, 3]) {
      await recordRun(storage, versionId, { status: "completed", fallbackCount: 0 });
    }

    expect(await breaker.evaluate(versionId)).toEqual({
      tripped: false,
      fallbackRate: 0,
      failureRate: 0,
      sample: 4,
    });
  });

  describe("trip", () => {
    it("retires the version through the registry, with an actor and a reason", async () => {
      const retired = await breaker.trip(versionId, {
        actor: "david",
        reason: "fallback rate over 50% across the last 4 runs",
      });

      expect(retired.status).toBe("retired");

      // A ledger row, not a silent status flip: AD-005 puts a human in front of
      // every status change and the promotion history records whose decision
      // this was.
      const promotions = await storage.listWorkflowPromotions(versionId);
      const last = promotions.at(-1);

      expect(last).toMatchObject({
        fromStatus: "active",
        toStatus: "retired",
        actor: "david",
        reason: "fallback rate over 50% across the last 4 runs",
      });
    });

    it("does not evaluate first: tripping is the operator's decision", async () => {
      // No runs exist at all, so `evaluate()` would report `tripped: false`.
      // `trip()` still retires, because an operator may have evidence the
      // ledger does not.
      expect((await breaker.evaluate(versionId)).tripped).toBe(false);

      const retired = await breaker.trip(versionId, { actor: "david" });

      expect(retired.status).toBe("retired");
    });
  });
});
