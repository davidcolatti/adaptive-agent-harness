import {
  HARNESS_RUNTIME_INFO,
  type Job,
  newJobId,
  newRunId,
  newTraceEventId,
  TRACE_EVENT_TYPES,
  type TraceEvent,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { createSupabaseStorage } from "./supabase-storage.js";

/**
 * Facts about the **schema** rather than about the `Storage` port (M2-T5,
 * M2-T6).
 *
 * The contract suite (`storage.contract.test.ts`) proves that two
 * implementations of one port behave the same. These are different questions
 * entirely — do the thirteen tables exist, is row-level security on, does
 * `order by id` return creation order — and they have exactly one possible
 * implementation, so they belong in the `integration` project, which the
 * taxonomy defines as the layer that "may use local Supabase".
 *
 * Skips with a printed reason when Supabase is not configured, for the same
 * reason the contract suite does: `pnpm check` must pass on a machine with no
 * Docker, and a suite that fails for a missing environment gets ignored.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
/** Optional. Present when `.env.local` was captured with the anon key mapped. */
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const CONFIGURED = SUPABASE_URL !== "" && SUPABASE_SERVICE_ROLE_KEY !== "";

if (!CONFIGURED) {
  process.stderr.write(
    [
      "",
      "supabase-schema.integration.test.ts: SKIPPING.",
      "  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set, so there is no",
      "  database to check the schema against. See docs/runbooks/supabase-local.md for",
      "  how to start one and capture its environment.",
      "",
    ].join("\n"),
  );
}

/** M2-T5's table list, verbatim and in its order. */
const EXPECTED_TABLES = [
  "domains",
  "jobs",
  "runs",
  "trace_events",
  "artifacts",
  "workflow_definitions",
  "workflow_versions",
  "workflow_promotions",
  "decisions",
  "eval_runs",
  "eval_results",
  "learning_runs",
  "compiler_runs",
] as const;

const DOMAIN = { id: "schema-integration", version: "1.0.0" } as const;

function makeJob(): Job<{ marker: string }, { ok: boolean }> {
  return {
    id: newJobId(),
    domain: { ...DOMAIN },
    jobType: "schema-case",
    objective: "Exercise the schema.",
    input: { marker: "schema" },
    contracts: {
      inputSchema: "schema-integration.input@1.0.0",
      outputSchema: "schema-integration.output@1.0.0",
      sop: "schema-integration-sop",
    },
    budget: {},
    permissions: [],
    metadata: {},
  };
}

describe.skipIf(!CONFIGURED)("the committed migrations produce the schema M2-T5 specifies", () => {
  const storage = CONFIGURED
    ? createSupabaseStorage({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY })
    : undefined;

  function require_(): NonNullable<typeof storage> {
    if (storage === undefined) {
      throw new Error("unreachable: skipped when not configured");
    }

    return storage;
  }

  it.each(EXPECTED_TABLES)("exposes the `%s` table to the service role", async (table) => {
    // A `select` of zero rows still round-trips through PostgREST's schema
    // cache, so it fails when the table is absent or not exposed and succeeds
    // when it is there and empty. That is exactly the property under test.
    const { error } = await require_().client.from(table).select("*").limit(1);

    expect(error, `select from ${table} failed: ${error?.message ?? ""}`).toBeNull();
  });

  // Row-level security, checked the way it actually matters: with the anon key,
  // which is the credential a leaked client would hold. RLS is enabled on every
  // table with **no policies**, so `anon` reads nothing and writes nothing even
  // though Supabase grants it table privileges by default. Skipped rather than
  // failed when no anon key is captured, because the service-role key alone is
  // enough to run everything else here.
  describe.skipIf(ANON_KEY === "")("denies the anon role, which holds no policy", () => {
    const anon =
      ANON_KEY === ""
        ? undefined
        : createSupabaseStorage({ url: SUPABASE_URL, serviceRoleKey: ANON_KEY }).client;

    it.each(EXPECTED_TABLES)("returns no rows of `%s` to anon", async (table) => {
      const { data, error } = await (anon ?? require_().client).from(table).select("*").limit(1);

      // RLS with no policy filters every row away rather than erroring, which
      // is the documented behaviour: "no data is accessible through the API
      // when using a publishable key, until you create policies."
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("refuses an anon insert", async () => {
      const { error } = await (anon ?? require_().client)
        .from("domains")
        .insert({ id: "anon-should-not-write", version: "1.0.0" });

      expect(error).not.toBeNull();
      // 42501 is Postgres's `insufficient_privilege`, which is what an RLS
      // policy violation reports.
      expect(error?.code).toBe("42501");
    });
  });

  it("orders a uuid primary key in creation order, closing ADR-0030's caveat", async () => {
    const storage_ = require_();
    const job = makeJob();
    await storage_.saveJob(job);

    const runId = newRunId();
    await storage_.startRun({
      runId,
      jobId: job.id,
      attempt: 1,
      domain: { ...DOMAIN },
      jobType: job.jobType,
      behaviorFingerprint: null,
      agentVersion: null,
      workflowVersionId: null,
      target: "@internal/schema-integration-fixture",
      runtime: HARNESS_RUNTIME_INFO,
      startedAt: new Date().toISOString(),
    });

    // Ten events, minted in order by the same generator the recorder uses, so
    // their ids are UUIDv7s that are strictly increasing (ADR-0030).
    const events: TraceEvent[] = Array.from({ length: 10 }, (_unused, index) => ({
      id: newTraceEventId(),
      runId,
      attempt: 1,
      sequence: index,
      timestamp: new Date().toISOString(),
      type: index === 0 ? "run.started" : "model.completed",
      parentId: null,
      node: null,
      version: 1,
      behaviorFingerprint: null,
      payload: {},
      usage: null,
      latencyMs: null,
      error: null,
    }));

    await storage_.appendTraceEvents(events);

    const { data, error } = await storage_.client
      .from("trace_events")
      .select("id")
      .eq("run_id", runId)
      // Order by the `uuid` column itself. Neither the Postgres 17 nor the 18
      // documentation states how `uuid` values compare, which is why ADR-0030
      // left this as an open caveat rather than an assumption.
      .order("id", { ascending: true });

    expect(error).toBeNull();

    const byUuidColumn = (data ?? []).map((row) => row.id);
    const byTextualSort = [...byUuidColumn].sort();

    // If `uuid` comparison were signed-byte, or anything other than unsigned
    // bytewise, these two would differ for ids whose bytes cross 0x80.
    expect(byUuidColumn).toEqual(byTextualSort);
    // And the textual sort is the mint order, which is the property that makes
    // an id usable as a cursor.
    expect(byUuidColumn).toEqual(events.map((event) => event.id));
  });

  it("refuses a trace event whose type is outside the closed taxonomy", async () => {
    const storage_ = require_();
    const job = makeJob();
    await storage_.saveJob(job);

    const runId = newRunId();
    await storage_.startRun({
      runId,
      jobId: job.id,
      attempt: 1,
      domain: { ...DOMAIN },
      jobType: job.jobType,
      behaviorFingerprint: null,
      agentVersion: null,
      workflowVersionId: null,
      target: null,
      runtime: HARNESS_RUNTIME_INFO,
      startedAt: new Date().toISOString(),
    });

    // The check constraint, not the TypeScript type, is what is under test: a
    // row inserted by anything other than this adapter must still be refused.
    const { error } = await storage_.client.from("trace_events").insert({
      id: newTraceEventId(),
      run_id: runId,
      attempt: 1,
      sequence: 0,
      occurred_at: new Date().toISOString(),
      type: "run.exploded",
      version: 1,
    });

    expect(error).not.toBeNull();
    // 23514 is Postgres's `check_violation`.
    expect(error?.code).toBe("23514");
  });

  it("accepts every member of the closed taxonomy", async () => {
    const storage_ = require_();
    const job = makeJob();
    await storage_.saveJob(job);

    const runId = newRunId();
    await storage_.startRun({
      runId,
      jobId: job.id,
      attempt: 1,
      domain: { ...DOMAIN },
      jobType: job.jobType,
      behaviorFingerprint: null,
      agentVersion: null,
      workflowVersionId: null,
      target: null,
      runtime: HARNESS_RUNTIME_INFO,
      startedAt: new Date().toISOString(),
    });

    // The constraint restates the taxonomy in SQL, so this is the test that
    // catches the two lists drifting apart.
    await storage_.appendTraceEvents(
      TRACE_EVENT_TYPES.map((type, index) => ({
        id: newTraceEventId(),
        runId,
        attempt: 1,
        sequence: index,
        timestamp: new Date().toISOString(),
        type,
        parentId: null,
        node: null,
        version: 1 as const,
        behaviorFingerprint: null,
        payload: {},
        usage: null,
        latencyMs: null,
        error: null,
      })),
    );

    const page = await storage_.getTrace(runId, { limit: TRACE_EVENT_TYPES.length });

    expect(page.events.map((event) => event.type)).toEqual([...TRACE_EVENT_TYPES]);
  });

  it("refuses a trace event for a run that does not exist", async () => {
    // The foreign key is what makes "every trace has a run row" a database
    // rule rather than a property of the harness calling things in order.
    const storage_ = require_();
    const orphan = newRunId();

    const { error } = await storage_.client.from("trace_events").insert({
      id: newTraceEventId(),
      run_id: orphan,
      attempt: 1,
      sequence: 0,
      occurred_at: new Date().toISOString(),
      type: "run.started",
      version: 1,
    });

    expect(error).not.toBeNull();
    // 23503 is Postgres's `foreign_key_violation`.
    expect(error?.code).toBe("23503");
  });
});
