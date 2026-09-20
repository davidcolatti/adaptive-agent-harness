import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BEHAVIOR_COMPONENT_NAMES,
  createBehaviorFingerprint,
  createHarness,
  diffBehaviorComponents,
} from "@internal/core";
import {
  createFakeAgentRuntime,
  createRecordingTraceWriter,
  type RecordingTraceWriter,
} from "@internal/testing";
import { describe, expect, it } from "vitest";
import { EXAMPLE_AGENT_CONFIG } from "../agent/lib/agent-config.js";
import { loadVendorTriageBehavior } from "./behavior.js";
import { vendorTriageManifest } from "./capabilities.js";
import { vendorTriage } from "./domain/index.js";
import { PROCUREMENT_SOP } from "./domain/procurement-sop.js";
import type { VendorTriageInput, VendorTriageOutput } from "./domain/schemas.js";
import { NO_PROCEED_WITH_OPEN_RISK_FLAGS_THRESHOLDS } from "./policies/no-proceed-with-open-risk-flags.js";

/**
 * The example domain's behavior fingerprint (M2-T8), against the real authored
 * files rather than a fixture.
 *
 * This is where the M2 acceptance criterion "Behavior fingerprint changes when
 * instructions/SOP/policy changes" is checked end to end: the descriptor is
 * built from `agent/instructions.md`, `agent/skills/`, the capability manifest,
 * the shared agent configuration and the policy thresholds, exactly as a run
 * builds it.
 */

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const NORTHWIND: VendorTriageInput = {
  vendorName: "Northwind Ledger",
  procurementSop: PROCUREMENT_SOP,
};

const OUTPUT: VendorTriageOutput = {
  category: "finance and accounting",
  riskFlags: [],
  missingInformation: ["The SOC 2 Type II report has not been reviewed."],
  recommendation: {
    decision: "proceed_with_conditions",
    rationale: "The published evidence meets the SOP, but the report has not been read.",
    conditions: ["Procurement reviews the SOC 2 Type II report under NDA."],
  },
  evidence: [{ claim: "A SOC 2 Type II report is held.", source: "vendor website, /security" }],
};

const RUNTIME = { name: "fake-eve", version: "0.0.0", metadata: {} };
const USAGE = { modelCalls: 2, toolCalls: 1, durationMs: 9 };

function runHarness(
  trace: RecordingTraceWriter,
): ReturnType<ReturnType<typeof createHarness>["run"]> {
  const harness = createHarness({
    agentRuntime: createFakeAgentRuntime({
      result: { status: "completed", output: OUTPUT, usage: USAGE, runtime: RUNTIME },
    }),
    trace,
  });

  return harness.run({ domain: vendorTriage, input: NORTHWIND });
}

describe("loadVendorTriageBehavior", () => {
  it("reads the real instructions file", async () => {
    const descriptor = await loadVendorTriageBehavior();

    expect(descriptor.instructions).toBe(
      await readFile(join(APP_ROOT, "agent", "instructions.md"), "utf8"),
    );
    expect(descriptor.instructions).toContain("You triage vendors against a procurement standard");
  });

  it("reads every skill under agent/skills/, named the way eve names them", async () => {
    const descriptor = await loadVendorTriageBehavior();

    // `agent/skills/triage-vendor.md` is the skill `triage-vendor`
    // (`eve/docs/reference/agent-files.md`, "Naming from paths").
    expect(descriptor.skills.map((skill) => skill.id)).toEqual(["triage-vendor"]);
    expect(descriptor.skills[0]?.content).toBe(
      await readFile(join(APP_ROOT, "agent", "skills", "triage-vendor.md"), "utf8"),
    );
  });

  it("carries the SOP content, not its identifier", async () => {
    const descriptor = await loadVendorTriageBehavior();

    // `Job.contracts.sop` is the bare identifier `procurement-sop` (ADR-0032).
    // The fingerprint covers the revision of it that ran.
    expect(descriptor.sop).toBe(PROCUREMENT_SOP);
    expect(vendorTriage.createJob(NORTHWIND).contracts.sop).toBe("procurement-sop");
  });

  it("takes tools and schemas from the capability manifest, with their fingerprints", async () => {
    const descriptor = await loadVendorTriageBehavior();

    expect(descriptor.tools.map((tool) => tool.id).sort()).toEqual([
      "load_skill",
      "lookup_vendor_evidence",
    ]);

    const lookup = descriptor.tools.find((tool) => tool.id === "lookup_vendor_evidence");
    const registered = vendorTriageManifest.entries.find(
      (entry) => entry.kind === "tool" && entry.ref.id === "lookup_vendor_evidence",
    );

    expect(lookup?.definitionFingerprint).toBe(registered?.fingerprint);

    expect(descriptor.schemas.map((schema) => schema.ref)).toEqual([
      "vendor-triage.input@1.0.0",
      "vendor-triage.output@1.0.0",
    ]);
    expect(descriptor.schemas.every((schema) => schema.fingerprint.startsWith("sha256:"))).toBe(
      true,
    );
  });

  it("takes the model configuration from the constant `agent/agent.ts` uses", async () => {
    const descriptor = await loadVendorTriageBehavior();

    // The single-source-of-truth guarantee: `agent/agent.ts` passes this exact
    // object to `defineAgent`, so the fingerprint cannot describe a different
    // configuration from the one the agent runs under.
    expect(descriptor.model).toEqual({ ...EXAMPLE_AGENT_CONFIG });
  });

  it("takes the policy thresholds from the constant the policy enforces", async () => {
    const descriptor = await loadVendorTriageBehavior();

    expect(descriptor.policy).toEqual({
      "no-proceed-with-open-risk-flags": { ...NO_PROCEED_WITH_OPEN_RISK_FLAGS_THRESHOLDS },
    });
  });

  it("has no workflow IR, because this domain runs the full agent", async () => {
    expect((await loadVendorTriageBehavior()).workflowIr).toBeNull();
  });

  it("contains no secret: no credential name and no credential value", async () => {
    const serialized = JSON.stringify(await loadVendorTriageBehavior());

    for (const name of ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "apiKey", "token"]) {
      expect(serialized).not.toContain(name);
    }
  });

  it("is stable: two loads of an unchanged tree fingerprint identically", async () => {
    const first = createBehaviorFingerprint(await loadVendorTriageBehavior());
    const second = createBehaviorFingerprint(await loadVendorTriageBehavior());

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(diffBehaviorComponents(first, second)).toEqual([]);
  });
});

describe("the M2 acceptance criterion, against the real descriptor", () => {
  // "Behavior fingerprint changes when instructions/SOP/policy changes."
  // Each case edits one component of the loaded descriptor, the way editing the
  // corresponding file or constant would, and asserts that the composite moves
  // and that exactly that component is named as the reason.
  it.each([
    ["instructions", { instructions: "You triage vendors. Be brief." }],
    ["sop", { sop: `${PROCUREMENT_SOP}\n7. Insurance.\n` }],
    [
      "policy",
      { policy: { "no-proceed-with-open-risk-flags": { maxOpenRiskFlagsForProceed: 2 } } },
    ],
  ])(
    "changes when the %s changes, and names it as the component that moved",
    async (component, override) => {
      const descriptor = await loadVendorTriageBehavior();
      const before = createBehaviorFingerprint(descriptor);
      const after = createBehaviorFingerprint({ ...descriptor, ...override });

      expect(after.fingerprint).not.toBe(before.fingerprint);
      expect(diffBehaviorComponents(before, after)).toEqual([component]);
    },
  );

  it("does not change when nothing behavior-affecting changes", async () => {
    const descriptor = await loadVendorTriageBehavior();
    const before = createBehaviorFingerprint(descriptor);

    // Re-declaring the same content in a different order, with CRLF line
    // endings, is the shape of a checkout on another machine. It is not a
    // behavior change and must not read as one.
    const after = createBehaviorFingerprint({
      ...descriptor,
      instructions: descriptor.instructions.replace(/\n/g, "\r\n"),
      tools: [...descriptor.tools].reverse(),
      schemas: [...descriptor.schemas].reverse(),
    });

    expect(after.fingerprint).toBe(before.fingerprint);
  });
});

describe("vendorTriage through createHarness, with the behavior fingerprint", () => {
  it("stamps one non-null fingerprint on every trace event and on the result", async () => {
    const trace = createRecordingTraceWriter();
    const result = await runHarness(trace);
    const expected = createBehaviorFingerprint(await loadVendorTriageBehavior());

    expect(result.status).toBe("completed");
    expect(result.behaviorFingerprint?.fingerprint).toBe(expected.fingerprint);
    expect(result.behaviorFingerprint?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(trace.events.length).toBeGreaterThan(0);
    expect(new Set(trace.events.map((event) => event.behaviorFingerprint))).toEqual(
      new Set([expected.fingerprint]),
    );
  });

  it("puts every component digest in the run.started payload", async () => {
    const trace = createRecordingTraceWriter();
    await runHarness(trace);

    const started = trace.events.find((event) => event.type === "run.started");
    const behavior = started?.payload.behavior as
      | { readonly components?: Record<string, string> }
      | undefined;

    expect(Object.keys(behavior?.components ?? {}).sort()).toEqual(
      [...BEHAVIOR_COMPONENT_NAMES].sort(),
    );
    // Identity-only: digests, never the instructions or the SOP they cover.
    expect(JSON.stringify(started?.payload)).not.toContain("procurement standard operating");
  });
});
