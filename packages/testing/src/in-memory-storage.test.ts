import {
  HARNESS_RUNTIME_INFO,
  type Job,
  newJobId,
  newRunId,
  newTraceEventId,
  type RunId,
  type RunStart,
  type TraceEvent,
  ValidationError,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { createInMemoryStorage } from "./in-memory-storage.js";

/**
 * `createInMemoryStorage()` (M2-T5).
 *
 * The **port's** behaviour is not tested here: that is
 * `packages/storage-supabase/src/storage.contract.test.ts`, which runs one
 * suite against this implementation and against Supabase, so that the two
 * cannot quietly diverge. What is here is what is specific to this one — its
 * inspection accessors, and the fact that it validates rather than trusting
 * what it is handed, which is what keeps a unit test that passes against it
 * from being a unit test that lies.
 */

const DOMAIN = { id: "in-memory", version: "1.0.0" } as const;

function makeJob(): Job<{ marker: string }, { ok: boolean }> {
  return {
    id: newJobId(),
    domain: { ...DOMAIN },
    jobType: "in-memory-case",
    objective: "Exercise the in-memory storage.",
    input: { marker: "value" },
    contracts: {
      inputSchema: "in-memory.input@1.0.0",
      outputSchema: "in-memory.output@1.0.0",
      sop: "in-memory-sop",
    },
    budget: {},
    permissions: [],
    metadata: {},
  };
}

function makeStart(job: Job, attempt = 1): RunStart {
  return {
    runId: newRunId(),
    jobId: job.id,
    attempt,
    domain: { ...DOMAIN },
    jobType: job.jobType,
    behaviorFingerprint: null,
    agentVersion: null,
    workflowVersionId: null,
    target: null,
    runtime: HARNESS_RUNTIME_INFO,
    startedAt: new Date("2026-09-19T12:00:00.000Z").toISOString(),
  };
}

function makeEvent(runId: RunId, sequence: number): TraceEvent {
  return {
    id: newTraceEventId(),
    runId,
    attempt: 1,
    sequence,
    timestamp: new Date(Date.UTC(2026, 8, 19, 12, 0, sequence)).toISOString(),
    type: sequence === 0 ? "run.started" : "run.completed",
    parentId: null,
    node: null,
    version: 1,
    behaviorFingerprint: null,
    payload: {},
    usage: null,
    latencyMs: null,
    error: null,
  };
}

describe("createInMemoryStorage", () => {
  it("exposes what it holds, so a test can assert on it directly", async () => {
    const storage = createInMemoryStorage();
    const job = makeJob();

    await storage.saveJob(job);

    const start = makeStart(job);
    await storage.startRun(start);
    await storage.appendTraceEvents([makeEvent(start.runId, 0), makeEvent(start.runId, 1)]);

    expect(storage.jobs.map((held) => held.id)).toEqual([job.id]);
    expect(storage.runs.map((run) => run.runId)).toEqual([start.runId]);
    expect(storage.events.map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("reports the events in append order, whatever the sequence order was", async () => {
    const storage = createInMemoryStorage();
    const job = makeJob();
    await storage.saveJob(job);
    const start = makeStart(job);
    await storage.startRun(start);

    // `events` is the append log, so it says what the writer did.
    // `getTrace()` is the ordered read, and it sorts.
    await storage.appendTraceEvents([makeEvent(start.runId, 1), makeEvent(start.runId, 0)]);

    expect(storage.events.map((event) => event.sequence)).toEqual([1, 0]);
    expect((await storage.getTrace(start.runId)).events.map((event) => event.sequence)).toEqual([
      0, 1,
    ]);
  });

  it("starts empty", () => {
    const storage = createInMemoryStorage();

    expect(storage.jobs).toEqual([]);
    expect(storage.runs).toEqual([]);
    expect(storage.events).toEqual([]);
  });

  it("validates a job rather than storing whatever it was handed", async () => {
    // An in-memory store that swallowed a malformed job would let a unit test
    // pass and the Supabase-backed one fail on the same input, which is exactly
    // the divergence a shared contract suite exists to prevent.
    const storage = createInMemoryStorage();

    await expect(
      storage.saveJob({ ...makeJob(), jobType: "" } as unknown as Job),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists runs of every job when no filter narrows them", async () => {
    const storage = createInMemoryStorage();
    const first = makeJob();
    const second = makeJob();

    await storage.saveJob(first);
    await storage.saveJob(second);
    await storage.startRun(makeStart(first));
    await storage.startRun(makeStart(second));

    expect((await storage.listRuns()).runs).toHaveLength(2);
  });

  it("gives each instance its own store", async () => {
    const one = createInMemoryStorage();
    const two = createInMemoryStorage();
    const job = makeJob();

    await one.saveJob(job);

    expect(await two.getJob(job.id)).toBeNull();
  });
});
