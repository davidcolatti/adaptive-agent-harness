import {
  HARNESS_RUNTIME_INFO,
  type Job,
  MAX_PAGE_SIZE,
  newJobId,
  newRunId,
  newTraceEventId,
  type RunId,
  type RunStart,
  type Storage,
  StorageError,
  type TraceEvent,
  type TraceEventType,
  ValidationError,
} from "@internal/core";
import { createInMemoryStorage } from "@internal/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { createSupabaseStorage } from "./supabase-storage.js";

/**
 * The `Storage` contract suite (M2-T5).
 *
 * Build plan section 8 names `Storage` in the list of ports whose every
 * implementation runs the same contract suite, and this is that suite. It runs
 * against `createInMemoryStorage()` from `@internal/testing` **always**, and
 * against `createSupabaseStorage()` against a real local Supabase when
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both set.
 *
 * ## Why this is a contract test and not an integration test
 *
 * The taxonomy says `*.integration.test.ts` "may use local Supabase" and
 * `*.contract.test.ts` "validates adapter compatibility … every implementation
 * runs the same suite". Both descriptions fit a Supabase-backed suite, so the
 * question is what the file is *for*: this one exists to prove the two
 * implementations of one port behave identically, which is the contract
 * project's entire purpose, and it would be pointless run against only one of
 * them. There is precedent for a contract test using real infrastructure —
 * `eve-agent-runtime.contract.test.ts` starts an actual `eve dev` server.
 *
 * Facts about the *schema* rather than the port — that thirteen tables exist,
 * that row-level security is on, that `order by id` is creation order — are a
 * genuinely different question and live in
 * `supabase-schema.integration.test.ts`.
 *
 * ## When Supabase is not available
 *
 * The Supabase leg **skips with a printed reason** rather than failing. A
 * contributor with no Docker must still be able to run `pnpm check`, and a
 * suite that fails for a missing environment teaches everyone to ignore it. The
 * reason is printed, so a skip is never silent.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_CONFIGURED = SUPABASE_URL !== "" && SUPABASE_SERVICE_ROLE_KEY !== "";

if (!SUPABASE_CONFIGURED) {
  process.stderr.write(
    [
      "",
      "storage.contract.test.ts: SKIPPING the Supabase leg of the Storage contract suite.",
      "  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set, so there is no",
      "  database to run it against. The in-memory leg still runs, and it asserts the",
      "  same things.",
      "",
      "  To run it: start Docker, then",
      "    pnpm supabase:start",
      "    pnpm exec supabase status -o env \\",
      "      --override-name api.url=SUPABASE_URL \\",
      "      --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY > .env.local",
      "    set -a; source .env.local; set +a; pnpm test:contract",
      "",
      "  See docs/runbooks/supabase-local.md.",
      "",
    ].join("\n"),
  );
}

const DOMAIN = { id: "storage-contract", version: "1.0.0" } as const;

/** A job every leg of the suite can save. Unique per call, so legs cannot collide. */
function makeJob(jobType = "contract-case"): Job<{ marker: string }, { ok: boolean }> {
  return {
    id: newJobId(),
    domain: { ...DOMAIN },
    jobType,
    objective: "Exercise the Storage contract.",
    input: { marker: "contract" },
    contracts: {
      inputSchema: "storage-contract.input@1.0.0",
      outputSchema: "storage-contract.output@1.0.0",
      sop: "storage-contract-sop",
    },
    budget: { maxModelCalls: 2 },
    permissions: [{ toolId: "read_thing", mode: "read" }],
    metadata: { suite: "storage-contract" },
  };
}

function makeRunStart(job: Job, overrides: Partial<RunStart> = {}): RunStart {
  return {
    runId: newRunId(),
    jobId: job.id,
    attempt: 1,
    domain: { ...DOMAIN },
    jobType: job.jobType,
    behaviorFingerprint: `sha256:${"a".repeat(64)}`,
    agentVersion: `sha256:${"a".repeat(64)}`,
    workflowVersionId: null,
    target: "@internal/storage-contract-fixture",
    runtime: HARNESS_RUNTIME_INFO,
    startedAt: new Date("2026-09-19T12:00:00.000Z").toISOString(),
    ...overrides,
  };
}

/** One trace event, stamped the way a `TraceRecorder` would stamp it. */
function makeEvent(
  runId: RunId,
  sequence: number,
  type: TraceEventType,
  overrides: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    id: newTraceEventId(),
    runId,
    attempt: 1,
    sequence,
    timestamp: new Date(Date.UTC(2026, 8, 19, 12, 0, sequence)).toISOString(),
    type,
    parentId: null,
    node: null,
    version: 1,
    behaviorFingerprint: `sha256:${"a".repeat(64)}`,
    payload: { step: sequence },
    usage: null,
    latencyMs: null,
    error: null,
    ...overrides,
  };
}

/**
 * The suite itself, stated once and run against every implementation.
 *
 * `create` is a factory rather than an instance so that each `describe` block
 * gets its own store; the Supabase leg shares one database across runs, which
 * is why every case here mints fresh ids rather than relying on an empty table.
 */
function describeStorageContract(name: string, create: () => Storage): void {
  describe(`Storage contract: ${name}`, () => {
    it("saves a job and reads it back through parseJob", async () => {
      const storage = create();
      const job = makeJob();

      await storage.saveJob(job);

      const read = await storage.getJob(job.id);

      expect(read).not.toBeNull();
      expect(read?.id).toBe(job.id);
      expect(read?.jobType).toBe(job.jobType);
      expect(read?.objective).toBe(job.objective);
      expect(read?.input).toEqual({ marker: "contract" });
      expect(read?.contracts).toEqual(job.contracts);
      expect(read?.budget).toEqual({ maxModelCalls: 2 });
      expect(read?.permissions).toEqual([{ toolId: "read_thing", mode: "read" }]);
      expect(read?.metadata).toEqual({ suite: "storage-contract" });
    });

    it("saving the same job twice is idempotent, because a job is immutable", async () => {
      const storage = create();
      const job = makeJob();

      await storage.saveJob(job);
      await storage.saveJob(job);

      expect((await storage.getJob(job.id))?.id).toBe(job.id);
    });

    it("returns null for a job that was never saved", async () => {
      expect(await create().getJob(newJobId())).toBeNull();
    });

    it("startRun opens a `running` row with the ledger's later columns empty", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      const record = await storage.startRun(start);

      expect(record.runId).toBe(start.runId);
      expect(record.jobId).toBe(job.id);
      expect(record.attempt).toBe(1);
      expect(record.domain).toEqual({ id: DOMAIN.id, version: DOMAIN.version });
      expect(record.jobType).toBe(job.jobType);
      expect(record.status).toBe("running");
      expect(record.success).toBeNull();
      expect(record.finishedAt).toBeNull();
      expect(record.error).toBeNull();
      // M3/M5 fill these; 0 is a measurement, not a placeholder.
      expect(record.jevCalls).toBe(0);
      expect(record.fallbackCount).toBe(0);
      // M4/M6 fill these; null is "not applicable yet", not zero.
      expect(record.workflowVersionId).toBeNull();
      expect(record.qualityScore).toBeNull();
      expect(record.humanReview).toBeNull();
      // Closes ADR-0034's open question: which agent actually ran.
      expect(record.target).toBe("@internal/storage-contract-fixture");
      expect(record.behaviorFingerprint).toBe(start.behaviorFingerprint);
      expect(record.agentVersion).toBe(start.agentVersion);
      expect(record.startedAt).toBe(start.startedAt);
    });

    it("finishRun writes the outcome and the runtime that actually ran", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      await storage.startRun(start);

      const finished = await storage.finishRun({
        runId: start.runId,
        status: "completed",
        success: true,
        costUsd: 0.0125,
        latencyMs: 4321,
        modelCalls: 3,
        toolCalls: 2,
        jevCalls: 0,
        fallbackCount: 0,
        runtime: { name: "eve", version: "0.63.0", metadata: { sessionId: "sess_1" } },
        finishedAt: new Date("2026-09-19T12:00:04.321Z").toISOString(),
        error: null,
      });

      expect(finished.status).toBe("completed");
      expect(finished.success).toBe(true);
      expect(finished.costUsd).toBeCloseTo(0.0125, 6);
      expect(finished.latencyMs).toBe(4321);
      expect(finished.modelCalls).toBe(3);
      expect(finished.toolCalls).toBe(2);
      // `startRun` recorded the harness placeholder; `finishRun` corrects it.
      expect(finished.runtime.name).toBe("eve");
      expect(finished.runtime.version).toBe("0.63.0");
      expect(finished.runtime.metadata).toEqual({ sessionId: "sess_1" });
      expect(finished.finishedAt).toBe("2026-09-19T12:00:04.321Z");

      expect(await storage.getRun(start.runId)).toEqual(finished);
    });

    it("keeps a failed run inspectable: a `failed` row carrying its error", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      await storage.startRun(start);

      const finished = await storage.finishRun({
        runId: start.runId,
        status: "failed",
        success: false,
        costUsd: null,
        latencyMs: 12,
        modelCalls: 1,
        toolCalls: 0,
        jevCalls: 0,
        fallbackCount: 0,
        runtime: HARNESS_RUNTIME_INFO,
        finishedAt: new Date("2026-09-19T12:00:00.012Z").toISOString(),
        error: {
          name: "AgentExecutionError",
          code: "AGENT_EXECUTION",
          message: "the fixture runtime failed on purpose",
          details: { runId: start.runId },
        },
      });

      expect(finished.status).toBe("failed");
      expect(finished.success).toBe(false);
      expect(finished.error?.code).toBe("AGENT_EXECUTION");
      expect(finished.error?.message).toBe("the fixture runtime failed on purpose");

      const read = await storage.getRun(start.runId);

      expect(read?.status).toBe("failed");
      expect(read?.error?.code).toBe("AGENT_EXECUTION");
    });

    it("records an aborted run as aborted, with a null success", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      await storage.startRun(start);

      const finished = await storage.finishRun({
        runId: start.runId,
        status: "aborted",
        success: null,
        costUsd: null,
        latencyMs: 3,
        modelCalls: 0,
        toolCalls: 0,
        jevCalls: 0,
        fallbackCount: 0,
        runtime: HARNESS_RUNTIME_INFO,
        finishedAt: new Date("2026-09-19T12:00:00.003Z").toISOString(),
        error: null,
      });

      // A cancellation is not a defect and not a success. `false` here would
      // teach every downstream query the wrong thing (ADR-0031).
      expect(finished.status).toBe("aborted");
      expect(finished.success).toBeNull();
    });

    it("rejects a second run of the same attempt of one job", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      await storage.startRun(makeRunStart(job));

      // "Retrying creates a new attempt, not duplicate events": the ledger
      // refuses a second row for attempt 1 rather than silently accepting two
      // executions as one.
      await expect(storage.startRun(makeRunStart(job, { attempt: 1 }))).rejects.toBeInstanceOf(
        StorageError,
      );
    });

    it("accepts a second attempt of the same job as a separate run", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const first = await storage.startRun(makeRunStart(job, { attempt: 1 }));
      const second = await storage.startRun(makeRunStart(job, { attempt: 2 }));

      expect(second.runId).not.toBe(first.runId);
      expect(second.attempt).toBe(2);

      const page = await storage.listRuns({ jobId: job.id });

      expect(page.runs.map((run) => run.attempt).sort()).toEqual([1, 2]);
    });

    it("rejects finishing a run that was never started", async () => {
      await expect(
        create().finishRun({
          runId: newRunId(),
          status: "completed",
          success: true,
          costUsd: null,
          latencyMs: 1,
          modelCalls: 0,
          toolCalls: 0,
          jevCalls: 0,
          fallbackCount: 0,
          runtime: HARNESS_RUNTIME_INFO,
          finishedAt: new Date().toISOString(),
          error: null,
        }),
      ).rejects.toBeInstanceOf(StorageError);
    });

    it("returns null for a run that does not exist", async () => {
      expect(await create().getRun(newRunId())).toBeNull();
    });

    it("appends a trace and reads it back in sequence order", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      await storage.startRun(start);

      const started = makeEvent(start.runId, 0, "run.started");
      const agent = makeEvent(start.runId, 1, "agent.started", { parentId: started.id });
      const model = makeEvent(start.runId, 2, "model.completed", {
        parentId: agent.id,
        usage: { modelCalls: 1, inputTokens: 40, outputTokens: 7 },
        latencyMs: 91,
      });
      const completed = makeEvent(start.runId, 3, "run.completed", { latencyMs: 120 });

      await storage.appendTraceEvents([started, agent, model, completed]);

      const page = await storage.getTrace(start.runId);

      expect(page.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
      expect(page.events.map((event) => event.type)).toEqual([
        "run.started",
        "agent.started",
        "model.completed",
        "run.completed",
      ]);
      expect(page.nextCursor).toBeNull();

      // The parent linkage survives the round trip, which is what makes a span
      // reconstructable from storage alone (ADR-0031: a `*.started` event's own
      // id is its span id).
      expect(page.events[1]?.parentId).toBe(started.id);
      expect(page.events[2]?.parentId).toBe(agent.id);
      expect(page.events[2]?.usage).toEqual({ modelCalls: 1, inputTokens: 40, outputTokens: 7 });
      expect(page.events[2]?.latencyMs).toBe(91);
      expect(page.events[0]?.behaviorFingerprint).toBe(`sha256:${"a".repeat(64)}`);
      expect(page.events[0]?.payload).toEqual({ step: 0 });
    });

    it("appending the same batch twice creates no duplicate events", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      await storage.startRun(start);

      const batch = [
        makeEvent(start.runId, 0, "run.started"),
        makeEvent(start.runId, 1, "run.completed"),
      ];

      await storage.appendTraceEvents(batch);
      // Exactly what the buffered writer does after a sink failure: it keeps
      // the batch and sends it again, in the same order.
      await storage.appendTraceEvents(batch);

      const page = await storage.getTrace(start.runId);

      expect(page.events).toHaveLength(2);
      expect(page.events.map((event) => event.sequence)).toEqual([0, 1]);
    });

    it("ignores a re-sent position rather than overwriting it, because a trace is append-only", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      await storage.startRun(start);

      const first = makeEvent(start.runId, 0, "run.started", {
        payload: { attemptWrite: "first" },
      });

      await storage.appendTraceEvents([first]);
      await storage.appendTraceEvents([
        makeEvent(start.runId, 0, "run.started", { payload: { attemptWrite: "second" } }),
      ]);

      const page = await storage.getTrace(start.runId);

      expect(page.events).toHaveLength(1);
      expect(page.events[0]?.payload).toEqual({ attemptWrite: "first" });
    });

    it("appending an empty batch is a no-op", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);
      const start = makeRunStart(job);
      await storage.startRun(start);

      await expect(storage.appendTraceEvents([])).resolves.toBeUndefined();
      expect((await storage.getTrace(start.runId)).events).toEqual([]);
    });

    it("pages a trace with a sequence cursor", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      await storage.startRun(start);

      await storage.appendTraceEvents(
        Array.from({ length: 5 }, (_unused, index) =>
          makeEvent(start.runId, index, index === 4 ? "run.completed" : "model.completed"),
        ),
      );

      const first = await storage.getTrace(start.runId, { limit: 2 });

      expect(first.events.map((event) => event.sequence)).toEqual([0, 1]);
      expect(first.nextCursor).toBe(1);

      const second = await storage.getTrace(start.runId, {
        after: first.nextCursor ?? 0,
        limit: 2,
      });

      expect(second.events.map((event) => event.sequence)).toEqual([2, 3]);
      expect(second.nextCursor).toBe(3);

      const third = await storage.getTrace(start.runId, {
        after: second.nextCursor ?? 0,
        limit: 2,
      });

      expect(third.events.map((event) => event.sequence)).toEqual([4]);
      expect(third.nextCursor).toBeNull();
    });

    it("returns an empty trace for a run with no events", async () => {
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);
      const start = makeRunStart(job);
      await storage.startRun(start);

      expect(await storage.getTrace(start.runId)).toEqual({ events: [], nextCursor: null });
    });

    it("lists runs newest first and pages with a keyset cursor", async () => {
      const storage = create();
      const job = makeJob(`paging-${newJobId()}`);
      await storage.saveJob(job);

      const starts = [1, 2, 3].map((attempt) => makeRunStart(job, { attempt }));

      for (const start of starts) {
        await storage.startRun(start);
      }

      const newestFirst = [...starts].sort((left, right) =>
        left.runId < right.runId ? 1 : left.runId > right.runId ? -1 : 0,
      );

      const first = await storage.listRuns({ jobId: job.id }, { limit: 2 });

      expect(first.runs.map((run) => run.runId)).toEqual([
        newestFirst[0]?.runId,
        newestFirst[1]?.runId,
      ]);
      expect(first.nextCursor).toBe(newestFirst[1]?.runId);

      const after = first.nextCursor;

      expect(after).not.toBeNull();

      const second = await storage.listRuns(
        { jobId: job.id },
        { ...(after === null ? {} : { after }), limit: 2 },
      );

      expect(second.runs.map((run) => run.runId)).toEqual([newestFirst[2]?.runId]);
      expect(second.nextCursor).toBeNull();
    });

    it("filters runs by AD-008's learning scope: domain, version and job type", async () => {
      const storage = create();
      const mine = makeJob(`scope-${newJobId()}`);
      const other = makeJob(`scope-${newJobId()}`);

      await storage.saveJob(mine);
      await storage.saveJob(other);

      const start = makeRunStart(mine);
      await storage.startRun(start);
      await storage.startRun(makeRunStart(other));

      const page = await storage.listRuns({
        domainId: DOMAIN.id,
        domainVersion: DOMAIN.version,
        jobType: mine.jobType,
      });

      expect(page.runs.map((run) => run.runId)).toEqual([start.runId]);
    });

    it("filters runs by status", async () => {
      const storage = create();
      const job = makeJob(`status-${newJobId()}`);
      await storage.saveJob(job);

      const running = makeRunStart(job, { attempt: 1 });
      const completed = makeRunStart(job, { attempt: 2 });

      await storage.startRun(running);
      await storage.startRun(completed);
      await storage.finishRun({
        runId: completed.runId,
        status: "completed",
        success: true,
        costUsd: null,
        latencyMs: 5,
        modelCalls: 0,
        toolCalls: 0,
        jevCalls: 0,
        fallbackCount: 0,
        runtime: HARNESS_RUNTIME_INFO,
        finishedAt: new Date().toISOString(),
        error: null,
      });

      const stillRunning = await storage.listRuns({ jobId: job.id, status: "running" });

      expect(stillRunning.runs.map((run) => run.runId)).toEqual([running.runId]);
    });

    it("rejects a page limit above the documented maximum rather than truncating", async () => {
      const storage = create();

      // A silently short page looks exactly like the end of the data, which is
      // the bug this refuses to have.
      await expect(storage.listRuns({}, { limit: MAX_PAGE_SIZE + 1 })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        storage.getTrace(newRunId(), { limit: MAX_PAGE_SIZE + 1 }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(storage.listRuns({}, { limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    });

    it("reconstructs a whole execution from storage alone: job, ledger row and ordered trace", async () => {
      // The acceptance criterion "a trace reconstructs execution without
      // application logs", stated as a test: everything an inspector needs is
      // reachable from a run id and nothing else.
      const storage = create();
      const job = makeJob();
      await storage.saveJob(job);

      const start = makeRunStart(job);
      await storage.startRun(start);
      await storage.appendTraceEvents([
        makeEvent(start.runId, 0, "run.started", { payload: { jobId: job.id } }),
        makeEvent(start.runId, 1, "run.completed", { latencyMs: 7 }),
      ]);
      await storage.finishRun({
        runId: start.runId,
        status: "completed",
        success: true,
        costUsd: 0.01,
        latencyMs: 7,
        modelCalls: 1,
        toolCalls: 0,
        jevCalls: 0,
        fallbackCount: 0,
        runtime: { name: "eve", version: "0.63.0", metadata: {} },
        finishedAt: new Date("2026-09-19T12:00:00.007Z").toISOString(),
        error: null,
      });

      const run = await storage.getRun(start.runId);

      expect(run).not.toBeNull();

      const readJob = await storage.getJob(run?.jobId ?? newJobId());
      const trace = await storage.getTrace(start.runId);

      expect(readJob?.objective).toBe("Exercise the Storage contract.");
      expect(run?.status).toBe("completed");
      expect(run?.target).toBe("@internal/storage-contract-fixture");
      expect(run?.behaviorFingerprint).toBe(start.behaviorFingerprint);
      expect(trace.events.map((event) => event.type)).toEqual(["run.started", "run.completed"]);
      expect(trace.events.map((event) => event.sequence)).toEqual([0, 1]);
    });
  });
}

describeStorageContract("in-memory (@internal/testing)", () => createInMemoryStorage());

describe.skipIf(!SUPABASE_CONFIGURED)("Supabase leg", () => {
  // One client for the file. Every case mints its own ids, so they share a
  // database without sharing state; that is also what the adapter has to
  // tolerate in reality.
  const storage = SUPABASE_CONFIGURED
    ? createSupabaseStorage({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY })
    : undefined;

  beforeAll(() => {
    expect(storage, "the Supabase leg must not run without a client").toBeDefined();
  });

  describeStorageContract("supabase (@internal/storage-supabase)", () => {
    if (storage === undefined) {
      throw new Error("unreachable: the Supabase leg is skipped when it is not configured");
    }

    return storage;
  });

  it("rejects an empty url or key at construction rather than on the first query", () => {
    expect(() => createSupabaseStorage({ url: "", serviceRoleKey: "k" })).toThrow(ValidationError);
    expect(() => createSupabaseStorage({ url: "http://x", serviceRoleKey: "  " })).toThrow(
      ValidationError,
    );
  });
});
