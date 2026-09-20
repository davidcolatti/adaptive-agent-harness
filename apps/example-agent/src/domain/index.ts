import { type CreateJobInput, defineDomain } from "@internal/core";
import { loadVendorTriageBehavior } from "../behavior.js";
import { PROCUREMENT_SOP } from "./procurement-sop.js";
import {
  type VendorTriageInput,
  vendorTriageInputSchema,
  vendorTriageOutputSchema,
} from "./schemas.js";

/**
 * The vendor-triage domain definition.
 *
 * This is the example's side of the harness boundary: the agent under `agent/`
 * is authored for `eve`, and this file is what the harness is handed. Nothing
 * here imports `eve`, and nothing under `agent/` imports the harness.
 *
 * **Nothing runs it yet.** `createHarness()` is M1-T4 and `EveAgentRuntime` is
 * M1-T6; until both exist there is no `pnpm example:run`. What exists today is
 * a registered domain whose schemas a unit test can validate against, including
 * the Milestone 1 criterion that an intentionally invalid output fails closed.
 */

/** How many model calls one triage may make before the budget stops it. */
const MAX_MODEL_CALLS = 8;

/** How many tool calls one triage may make. */
const MAX_TOOL_CALLS = 8;

/** How long one triage may run, in milliseconds. */
const MAX_DURATION_MS = 120_000;

function createJob(input: VendorTriageInput): CreateJobInput<VendorTriageInput> {
  return {
    jobType: "vendor-triage",
    objective: `Triage ${input.vendorName} against the supplied procurement SOP and recommend what should happen next.`,
    input,
    // String references, resolved by the capability registry in M1-T9. They are
    // written by hand here because nothing yet resolves them, and a reference
    // that names a schema is more honest than embedding one that cannot be
    // serialized into a trace.
    contracts: {
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      sop: "procurement-sop",
    },
    budget: {
      maxModelCalls: MAX_MODEL_CALLS,
      maxToolCalls: MAX_TOOL_CALLS,
      maxDurationMs: MAX_DURATION_MS,
    },
    // Exactly the two tools the agent has, and `eve info --json` reports
    // exactly these two. A grant is checked by tool name at the moment the
    // model asks for it (`EveAgentRuntime`, M1-T6), so an ungranted tool fails
    // the run closed rather than running unnoticed.
    //
    // `lookup_vendor_evidence` is `read` because it reads frozen fixture data
    // and changes nothing; the tool's own `approval: never()` and the pure
    // `agent/lib/` module are the other two halves of that claim.
    //
    // `load_skill` is `read` because it adds no execution surface by itself
    // (`eve/docs/concepts/built-in-tools.md`): it pulls
    // `agent/skills/triage-vendor.md`, instructions this repository wrote, into
    // the turn. It is a framework tool rather than an authored one, which is why
    // it is granted here but not registered as a domain capability in
    // `src/capabilities.ts`.
    permissions: [
      { toolId: "lookup_vendor_evidence", mode: "read" },
      { toolId: "load_skill", mode: "read" },
    ],
    metadata: { fixtureEvidenceOnly: true },
  };
}

export const vendorTriage = defineDomain({
  id: "vendor-triage",
  version: "1.0.0",
  inputSchema: vendorTriageInputSchema,
  outputSchema: vendorTriageOutputSchema,
  createJob,
  // What this domain's behavior is made of (M2-T8, ADR-0034). The harness
  // resolves it once per run, before `run.started`, and stamps the resulting
  // `sha256:` fingerprint on every trace event and on the run result. It is a
  // loader rather than a literal because gathering it means reading
  // `agent/instructions.md` and `agent/skills/`, and because reading them per
  // run is what makes an edit between two runs show up as a changed behavior.
  behavior: loadVendorTriageBehavior,
  evals: [
    {
      id: "northwind-ledger-well-documented",
      description:
        "A vendor whose evidence meets most of the SOP should not be escalated, and should cite what it rests on.",
      input: {
        vendorName: "Northwind Ledger",
        procurementSop: PROCUREMENT_SOP,
      },
      expect(output) {
        if (output.recommendation.decision === "escalate") {
          throw new Error("a well-documented vendor should not be escalated");
        }
        if (output.evidence.length === 0) {
          throw new Error("every triage must cite its evidence");
        }
      },
    },
    {
      id: "cobalt-harbor-payment-change",
      description:
        "A vendor with an unverified banking-detail change must raise a risk flag and must not be waved through.",
      input: {
        vendorName: "Cobalt Harbor Logistics",
        procurementSop: PROCUREMENT_SOP,
      },
      expect(output) {
        if (output.riskFlags.length === 0) {
          throw new Error("the payment-change evidence must raise at least one risk flag");
        }
        if (output.recommendation.decision === "proceed") {
          throw new Error("no triage may recommend proceeding while a risk flag is open");
        }
      },
    },
  ],
});

export { PROCUREMENT_SOP } from "./procurement-sop.js";
export type { VendorTriageInput, VendorTriageOutput } from "./schemas.js";
export { vendorTriageInputSchema, vendorTriageOutputSchema } from "./schemas.js";
