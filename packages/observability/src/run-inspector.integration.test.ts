import type { Storage } from "@internal/core";
import { createSupabaseStorage } from "@internal/storage-supabase";
import { createInMemoryStorage } from "@internal/testing";
import { describe, expect, it } from "vitest";
import { recordFixtureRun } from "./fixtures.js";
import { inspectRun } from "./inspect-run.js";
import { renderRunInspection } from "./render.js";

/**
 * The run inspector against a real local Supabase (M2-T10).
 *
 * The unit suites prove the inspector reads the `Storage` port correctly, using
 * the in-memory implementation. This one proves the thing that cannot be proved
 * in memory: that a run written to Postgres, through PostgREST, with `jsonb`
 * payloads, `snake_case` columns and `timestamptz` timestamps, comes back as
 * the same inspection. Every one of those is a chance for a value to change
 * shape on the way through, and the inspector is what a human will trust when
 * something has gone wrong.
 *
 * It is an integration test rather than a contract test because there is one
 * inspector, not two implementations of a port: the taxonomy's `integration`
 * project is the one that "may use local Supabase".
 *
 * It **skips with a printed reason** when the two Supabase variables are not
 * set, so `pnpm check` passes on a machine with no Docker. The reason is
 * printed, so a skip is never silent.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CONFIGURED = SUPABASE_URL !== "" && SUPABASE_SERVICE_ROLE_KEY !== "";

if (!CONFIGURED) {
  process.stderr.write(
    [
      "",
      "run-inspector.integration.test.ts: SKIPPING the Supabase leg of the run inspector.",
      "  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not both set, so there is no",
      "  database to write a run to and read it back from. The unit suites still run",
      "  against the in-memory Storage and assert the same fields.",
      "",
      "  To run it: start Docker, then",
      "    pnpm supabase:start",
      "    pnpm exec supabase status -o env \\",
      "      --override-name api.url=SUPABASE_URL \\",
      "      --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY > .env.local",
      "    set -a; source .env.local; set +a; pnpm test:integration",
      "",
      "  See docs/runbooks/inspecting-a-run.md.",
      "",
    ].join("\n"),
  );
}

/**
 * The real adapter, built once; every case writes its own run.
 *
 * It falls back to the in-memory store when the variables are absent so that
 * this module has no `undefined` to assert away. Nothing runs in that case,
 * because `describe.skipIf` skips the whole suite.
 */
const storage: Storage = CONFIGURED
  ? createSupabaseStorage({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY })
  : createInMemoryStorage();

describe.skipIf(!CONFIGURED)("inspectRun against Supabase", () => {
  it("inspects a completed run written through the real harness and adapter", async () => {
    const { result } = await recordFixtureRun({ storage });

    const inspection = await inspectRun(storage, result.runId);

    expect(inspection.found).toBe(true);
    expect(inspection.availability).toEqual({ run: true, job: true, trace: true });
    expect(inspection.notes).toEqual([]);
    expect(inspection.job?.id).toBe(result.jobId);
    expect(inspection.job?.objective).toBe("Triage Northwind.");
    expect(inspection.route.route).toBe("full-agent");
    expect(inspection.route.target).toBe("@internal/observability-fixture");
    expect(inspection.timeline.map((entry) => entry.type)).toEqual([
      "run.started",
      "agent.started",
      "model.started",
      "model.completed",
      "tool.started",
      "tool.completed",
      "agent.completed",
      "run.completed",
    ]);
    expect(inspection.calls.model.calls[0]).toMatchObject({
      id: "fixture-model",
      status: "completed",
    });
    expect(inspection.calls.tool.calls[0]).toMatchObject({ id: "lookup", status: "completed" });
    expect(inspection.result.status).toBe("completed");
    expect(inspection.result.success).toBe(true);
    expect(inspection.cost.tokens.totalTokens).toBe(160);
    expect(inspection.fingerprints.consistent).toBe(true);
    expect(inspection.fingerprints.run).toMatch(/^sha256:/);
    expect(Object.keys(inspection.fingerprints.components ?? {})).toHaveLength(8);
  });

  it("keeps a failed run inspectable, with the error in the trace and on the row", async () => {
    const { result } = await recordFixtureRun({ outcome: "failed", storage });

    const inspection = await inspectRun(storage, result.runId);

    expect(inspection.found).toBe(true);
    expect(inspection.result.status).toBe("failed");
    expect(inspection.errors.some((entry) => entry.source === "ledger")).toBe(true);
    expect(inspection.errors.some((entry) => entry.source === "trace")).toBe(true);
    expect(inspection.calls.model.calls[0]?.status).toBe("failed");
    expect(renderRunInspection(inspection)).toContain("AGENT_EXECUTION");
  });

  it("produces the same inspection over Postgres as over the in-memory store", async () => {
    const supabase = await recordFixtureRun({ storage });
    const memory = await recordFixtureRun();

    const fromPostgres = await inspectRun(storage, supabase.result.runId);
    const fromMemory = await inspectRun(memory.storage, memory.result.runId);

    // Everything but the identifiers, timestamps and measured latencies, which
    // are two different runs and are supposed to differ. `jobId` is blanked
    // for that reason; everything else in a summary is behaviour.
    const summaries = (inspection: typeof fromPostgres): readonly string[] =>
      inspection.timeline.map((entry) => entry.summary.replaceAll(/\b[0-9a-f-]{36}\b/g, "<id>"));

    expect(fromPostgres.timeline.map((entry) => entry.type)).toEqual(
      fromMemory.timeline.map((entry) => entry.type),
    );
    expect(summaries(fromPostgres)).toEqual(summaries(fromMemory));
    expect(fromPostgres.cost.tokens).toEqual(fromMemory.cost.tokens);
    expect(fromPostgres.fingerprints.components).toEqual(fromMemory.fingerprints.components);
    expect(fromPostgres.fingerprints.run).toBe(fromMemory.fingerprints.run);
    expect(fromPostgres.route.route).toBe(fromMemory.route.route);
    expect(fromPostgres.job?.contracts).toEqual(fromMemory.job?.contracts);
    expect(fromPostgres.job?.input).toEqual(fromMemory.job?.input);
  });
});
