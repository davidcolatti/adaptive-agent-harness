import { createHarness } from "@internal/core";
import {
  createFakeAgentRuntime,
  createFakeClock,
  createRecordingTraceWriter,
} from "@internal/testing";
import { describe, expect, it } from "vitest";
import { vendorTriage } from "./index.js";
import { PROCUREMENT_SOP } from "./procurement-sop.js";
import type { VendorTriageInput, VendorTriageOutput } from "./schemas.js";

/**
 * The example domain, end to end through `createHarness()`, with a fake
 * `AgentRuntime` standing in for `EveAgentRuntime`.
 *
 * This is Milestone 1's "a fake `AgentRuntime` can replace `EveAgentRuntime` in
 * a unit test" criterion applied to the real domain rather than to a fabricated
 * one, and the end-to-end form of "one intentionally invalid output fails
 * closed". It makes no model call and reads no credential.
 */

const NORTHWIND: VendorTriageInput = {
  vendorName: "Northwind Ledger",
  procurementSop: PROCUREMENT_SOP,
};

/** A hand-written output that satisfies `vendorTriageOutputSchema`. */
const NORTHWIND_OUTPUT: VendorTriageOutput = {
  category: "cloud bookkeeping and expense reconciliation",
  riskFlags: [],
  missingInformation: [
    "The SOC 2 Type II report itself has not been reviewed, only its existence.",
  ],
  recommendation: {
    decision: "proceed_with_conditions",
    rationale:
      "The published security, DPA and support evidence meets the SOP, but the SOC 2 report has not been read.",
    conditions: ["Procurement obtains and reviews the SOC 2 Type II report under NDA."],
  },
  evidence: [
    {
      claim:
        "A SOC 2 Type II report covering security and availability is held and renewed annually.",
      source: "vendor website, /security (captured 2026-09-01)",
    },
    {
      claim: "A standard DPA with SCCs and a named sub-processor list is published.",
      source: "vendor website, /legal/dpa (captured 2026-09-01)",
    },
  ],
};

const RUNTIME = { name: "fake-eve", version: "0.0.0", metadata: {} };
const USAGE = { modelCalls: 3, toolCalls: 1, durationMs: 42 };

describe("vendorTriage through createHarness", () => {
  it("completes with the validated output", async () => {
    const agentRuntime = createFakeAgentRuntime({
      result: { status: "completed", output: NORTHWIND_OUTPUT, usage: USAGE, runtime: RUNTIME },
    });
    const trace = createRecordingTraceWriter();
    const harness = createHarness({
      agentRuntime,
      trace,
      clock: createFakeClock({ start: new Date("2026-09-19T12:00:00.000Z") }),
    });

    const result = await harness.run({ domain: vendorTriage, input: NORTHWIND });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") {
      expect.unreachable("expected a completed result");
    }

    expect(result.output).toEqual(NORTHWIND_OUTPUT);
    expect(result.domain).toEqual({ id: "vendor-triage", version: "1.0.0" });
    expect(result.usage).toEqual(USAGE);
    expect(result.runtime).toEqual(RUNTIME);
    expect(trace.types()).toEqual(["run.started", "run.completed"]);
    expect(trace.flushCount).toBe(1);
  });

  it("hands the runtime the job the domain built, with its budget and one read grant", async () => {
    const agentRuntime = createFakeAgentRuntime({
      result: { status: "completed", output: NORTHWIND_OUTPUT, usage: USAGE, runtime: RUNTIME },
    });

    await createHarness({ agentRuntime }).run({ domain: vendorTriage, input: NORTHWIND });

    const call = agentRuntime.calls[0];

    expect(call?.job.jobType).toBe("vendor-triage");
    expect(call?.job.objective).toContain("Northwind Ledger");
    expect(call?.job.contracts).toEqual({
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      sop: "procurement-sop",
    });
    expect(call?.job.permissions).toEqual([
      { toolId: "lookup_vendor_evidence", mode: "read" },
      { toolId: "load_skill", mode: "read" },
    ]);
    expect(call?.context.budget).toEqual({
      maxModelCalls: 8,
      maxToolCalls: 8,
      maxDurationMs: 120_000,
    });
  });

  it("fails closed on an intentionally invalid output", async () => {
    const agentRuntime = createFakeAgentRuntime({
      result: {
        status: "completed",
        // `category` must be a non-empty string, and the other four required
        // fields are missing entirely.
        output: { category: 1 },
        usage: USAGE,
        runtime: RUNTIME,
      },
    });
    const harness = createHarness({ agentRuntime });

    const result = await harness.run({ domain: vendorTriage, input: NORTHWIND });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      expect.unreachable("expected a failed result");
    }

    expect(result.error.code).toBe("VALIDATION");
    expect(result.error.message).toContain("vendor-triage agent output failed validation");
    expect(Object.hasOwn(result, "output")).toBe(false);
  });

  it("fails closed on an output that invents a decision the SOP does not allow", async () => {
    const agentRuntime = createFakeAgentRuntime({
      result: {
        status: "completed",
        output: {
          ...NORTHWIND_OUTPUT,
          recommendation: { decision: "auto_approve", rationale: "Looks fine." },
        },
        usage: USAGE,
        runtime: RUNTIME,
      },
    });

    const result = await createHarness({ agentRuntime }).run({
      domain: vendorTriage,
      input: NORTHWIND,
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") {
      expect.unreachable("expected a failed result");
    }
    expect(result.error.code).toBe("VALIDATION");
  });

  it("throws before reaching the runtime when the input is invalid", async () => {
    const agentRuntime = createFakeAgentRuntime({
      result: { status: "completed", output: NORTHWIND_OUTPUT, usage: USAGE, runtime: RUNTIME },
    });

    await expect(
      createHarness({ agentRuntime }).run({
        domain: vendorTriage,
        input: { vendorName: "", procurementSop: PROCUREMENT_SOP },
      }),
    ).rejects.toThrow("vendor-triage job input failed validation");

    expect(agentRuntime.calls).toHaveLength(0);
  });
});
