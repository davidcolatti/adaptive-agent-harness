import type {
  CapabilityKind,
  CapabilityRef,
  CapabilityRegistry,
  Job,
  TraceEvent,
} from "@internal/core";
import { createHarness, formatCapabilityRef } from "@internal/core";
import {
  createFakeAgentRuntime,
  createInMemoryStorage,
  createRecordingTraceWriter,
} from "@internal/testing";
import { createWorkflowRuntime } from "@internal/workflow";
import { describe, expect, it } from "vitest";
import { createVendorTriageRegistry } from "../capabilities.js";
import { createVendorDecisionPort } from "../decisions/index.js";
import { PROCUREMENT_SOP, type VendorTriageInput, vendorTriage } from "../domain/index.js";
import type { VendorTriageOutput } from "../domain/schemas.js";
import { compileVendorTriageWorkflow } from "./vendor-triage-workflow.js";

/**
 * The hand-authored vendor workflow as a **run** (M4-T10).
 *
 * Every route runs through `createHarness()` on
 * `WorkflowRuntime.asAgentRuntime()`, which is the M4 status file's design
 * option made real: from the harness's point of view a compiled workflow is
 * just another thing that runs a job, so trace, storage and
 * `pnpm harness run show` keep working with no router (M5 adds one).
 *
 * Five of Milestone 4's eight acceptance criteria are verified here, against
 * the real domain rather than a fixture graph:
 *
 * - "A human-authored workflow runs locally"
 * - "Every node validates inputs and outputs"
 * - "An agent node cannot call an ungranted tool"
 * - "A failed node is visible in the trace"
 * - "DSL output can be serialized to canonical IR" (through the compiled value)
 *
 * The researching agent is `createFakeAgentRuntime()` rather than
 * `EveAgentRuntime`: a unit test makes no model call (AGENTS.md's test
 * taxonomy), and the real adapter is exercised by `pnpm example:run:mock
 * -- --workflow`.
 */

/** A triage of the shape the example agent produces, valid against the domain's output schema. */
const AGENT_TRIAGE: VendorTriageOutput = {
  category: "Product usage analytics with session replay.",
  riskFlags: [
    {
      clause: "The vendor holds a current SOC 2 Type II report.",
      concern: "Only a Type I assessment is evidenced, and the Type II window has no end date.",
      evidence: "vendor website, /security (captured 2026-09-03)",
    },
  ],
  missingInformation: ["A published data processing agreement (SOP requirement 2)."],
  recommendation: {
    decision: "request_information",
    rationale: "The security assurance and the DPA are both unestablished.",
  },
  evidence: [
    {
      claim: "A SOC 2 Type I assessment was completed this year.",
      source: "vendor website, /security (captured 2026-09-03)",
    },
  ],
};

/** A request for one vendor. */
function request(vendorName: string): VendorTriageInput {
  return { vendorName, procurementSop: PROCUREMENT_SOP };
}

/** What every route's test needs: a harness over the compiled workflow, and what to inspect after. */
function createFixture(
  options: {
    readonly registry?: CapabilityRegistry;
    readonly agentOutput?: VendorTriageOutput;
  } = {},
) {
  const registry = options.registry ?? createVendorTriageRegistry();
  const agentRuntime = createFakeAgentRuntime({
    result: {
      status: "completed",
      output: options.agentOutput ?? AGENT_TRIAGE,
      usage: { modelCalls: 2, toolCalls: 1, durationMs: 7 },
      runtime: { name: "fake-eve", version: "0.0.0", metadata: {} },
    },
  });
  const compiled = compileVendorTriageWorkflow(registry);
  const storage = createInMemoryStorage();
  const runtime = createWorkflowRuntime({
    registry,
    agentRuntime,
    // M3-T8: the real decision port over the credential-free fixture engine,
    // and the storage the run already has, so every route's decisions land in
    // the same in-memory store the run's ledger row does.
    decisionEngine: createVendorDecisionPort({ storage }),
  });
  const trace = createRecordingTraceWriter();
  const harness = createHarness({
    agentRuntime: runtime.asAgentRuntime(compiled),
    trace,
    storage,
    target: "@internal/example-agent+workflow",
  });

  return { agentRuntime, compiled, harness, storage, trace };
}

/** Every `node.*` event of a recorded trace, as `<type> <node>`. */
function nodeEvents(events: readonly TraceEvent[]): readonly string[] {
  return events
    .filter((event) => event.type.startsWith("node."))
    .map((event) => `${event.type} ${String(event.node)}`);
}

/** A registry in which one handler throws, and everything else is the domain's own. */
function registryWithFailingFinalize(): CapabilityRegistry {
  // A delegating wrapper rather than a second set of registrations: the point of
  // the test is that *this* workflow, compiled against *this* domain, escalates
  // when a node breaks, so everything except the one handler must be the real
  // thing. `compileWorkflow()` only asks `has()`, so the workflow still
  // compiles; the runtime asks `resolve()`, and gets the thrower.
  const registry = createVendorTriageRegistry();

  return {
    register: (kind, registration) => registry.register(kind, registration),
    has: (kind, ref) => registry.has(kind, ref),
    entries: () => registry.entries(),
    toManifest: () => registry.toManifest(),
    resolve<TValue>(kind: CapabilityKind, ref: CapabilityRef | string): TValue {
      const formatted = typeof ref === "string" ? ref : formatCapabilityRef(ref);

      if (kind === "handler" && formatted === "finalize-clear-triage@1.0.0") {
        return ((): never => {
          throw new Error("the finalize handler is deliberately broken in this test");
        }) as TValue;
      }

      return registry.resolve<TValue>(kind, ref);
    },
  };
}

describe("the `clear` route", () => {
  it("runs a human-authored workflow locally, end to end, with no agent call", async () => {
    const { agentRuntime, harness, trace } = createFixture();
    const result = await harness.run({ domain: vendorTriage, input: request("Northwind Ledger") });

    expect(result.status).toBe("completed");

    if (result.status !== "completed") {
      return;
    }

    // The domain's own output schema accepted it, which is `createHarness()`'s
    // second validation on top of the node's own.
    // The category a `jev` node decided, in the SOP's own vocabulary (M3-T8),
    // rather than the fixture's stated offering copied through.
    expect(result.output.category).toBe("finance and accounting");
    expect(result.output.recommendation.decision).toBe("proceed_with_conditions");

    // The whole point of the compiled path: the full agent was never reached.
    expect(agentRuntime.calls).toHaveLength(0);
    expect(result.usage.modelCalls).toBe(1);

    expect(nodeEvents(trace.events)).toStrictEqual([
      "node.started classify",
      "node.completed classify",
      "node.started route",
      "node.completed route",
      "node.started finalize",
      "node.completed finalize",
    ]);
  });

  it("names the workflow and its fingerprint on the run's runtime info", async () => {
    const { compiled, harness } = createFixture();
    const result = await harness.run({ domain: vendorTriage, input: request("Northwind Ledger") });

    expect(result.runtime).toMatchObject({
      name: "@internal/workflow",
      metadata: {
        workflowId: "vendor-triage-v1",
        workflowVersion: "1.0.0",
        workflowFingerprint: compiled.fingerprint,
      },
    });
  });

  it("records the branch's chosen label and target in the trace", async () => {
    const { harness, trace } = createFixture();

    await harness.run({ domain: vendorTriage, input: request("Northwind Ledger") });

    const completed = trace.events.find(
      (event) => event.type === "node.completed" && event.node === "route",
    );

    expect(completed?.payload).toMatchObject({ label: "clear", target: "finalize" });
  });

  it("validates every node's input and output, with `node` set on each event", async () => {
    const { harness, trace } = createFixture();

    await harness.run({ domain: vendorTriage, input: request("Northwind Ledger") });

    for (const event of trace.events.filter((candidate) => candidate.type.startsWith("node."))) {
      expect(event.node).not.toBeNull();
      // ADR-0040's amendment: a `node.*` payload carries the value that was
      // validated, which is how "persist node result" is met in a milestone
      // that builds no durability.
      expect(event.payload).toHaveProperty("nodeId", event.node);
    }

    const finalize = trace.events.find(
      (event) => event.type === "node.completed" && event.node === "finalize",
    );

    // `finalize`'s input is the composite the `object` binding built, and it
    // passed `vendor-triage.finalize-input@1.0.0`.
    expect(trace.events.find((event) => event.node === "finalize")?.payload).toHaveProperty(
      "input",
    );
    expect(finalize?.payload).toHaveProperty("output");
  });

  it("stores one decision record per jev node executed, with its policy outcome (M3-T3)", async () => {
    const { harness, storage, trace } = createFixture();
    const result = await harness.run({
      domain: vendorTriage,
      input: request("Northwind Ledger"),
    });

    // The `clear` route executes exactly one `jev` node, so the run has exactly
    // one decision. This is the count `select count(*) from decisions where
    // run_id = ...` returns against Supabase on the same route.
    const decisions = await storage.listDecisions(result.runId);

    expect(decisions).toHaveLength(1);
    // One stored record per `decision.*` span the runtime opened: the trace and
    // the table agree about how many judgments this run made, which is what
    // makes `pnpm harness run show`'s Jev-calls line and the table joinable.
    expect(trace.events.filter((event) => event.type === "decision.completed")).toHaveLength(1);

    const record = decisions[0];

    expect(record?.nodeId).toBe("classify");
    // The raw judgment: three answers about the vendor, keyed as the bundle
    // keyed them, with the distributions the provider reported.
    expect(Object.keys(record?.result.answers ?? {})).toStrictEqual([
      "lowRisk",
      "category",
      "evidenceSufficient",
    ]);
    expect(record?.result.answers.category?.value).toBe("finance and accounting");
    // The organization's decision about it, beside it and not inside it.
    expect(record?.policy).toMatchObject({
      route: "clear",
      policy: { id: "vendor-triage.route", version: "1.0.0" },
    });
    expect(record?.policy?.reasons.length).toBeGreaterThan(0);
  });
});

describe("the `research` route", () => {
  it("calls the agent exactly once, under the node's own grants, and completes", async () => {
    const { agentRuntime, harness, trace } = createFixture();
    const result = await harness.run({
      domain: vendorTriage,
      input: request("Tessellate Analytics"),
    });

    expect(result.status).toBe("completed");
    expect(agentRuntime.calls).toHaveLength(1);

    const [call] = agentRuntime.calls;

    // M4-T8: "an `agent` node receives only its granted tools". The sub-run's
    // context carries the **node's** permissions, not the job's.
    expect(call?.context.permissions).toStrictEqual([
      { toolId: "lookup_vendor_evidence", mode: "read" },
      { toolId: "load_skill", mode: "read" },
    ]);
    // And the derived job is this job narrowed to this node: same id and domain,
    // the node's schemas, the node's grants.
    expect((call?.job as Job | undefined)?.contracts).toMatchObject({
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
    });

    expect(nodeEvents(trace.events)).toStrictEqual([
      "node.started classify",
      "node.completed classify",
      "node.started route",
      "node.completed route",
      "node.started research",
      "node.completed research",
      "node.started verify",
      "node.completed verify",
      "node.started decide",
      "node.completed decide",
    ]);
  });

  it("applies the policy to the agent's triage and the verification", async () => {
    const { harness } = createFixture();
    const result = await harness.run({
      domain: vendorTriage,
      input: request("Tessellate Analytics"),
    });

    expect(result.status).toBe("completed");

    if (result.status !== "completed") {
      return;
    }

    // The agent's triage is supported (it cites a source) and its
    // recommendation is not an unconditional `proceed`, so `decide` passes it
    // through unchanged.
    expect(result.output).toEqual(AGENT_TRIAGE);
  });

  it("escalates when the policy refuses the agent's recommendation", async () => {
    const { harness, trace } = createFixture({
      agentOutput: {
        ...AGENT_TRIAGE,
        recommendation: { decision: "proceed", rationale: "The agent waved it through." },
      },
    });
    const result = await harness.run({
      domain: vendorTriage,
      input: request("Tessellate Analytics"),
    });

    expect(result.status).toBe("completed");

    if (result.status !== "completed") {
      return;
    }

    // `decide` is deterministic code applying a threshold, so this is a
    // completed workflow whose *recommendation* is an escalation, not a
    // workflow that gave up.
    expect(result.output.recommendation.decision).toBe("escalate");
    expect(trace.types()).not.toContain("fallback.started");
  });
});

describe("the default route", () => {
  it("escalates to the full agent with a fallback envelope the caller can read", async () => {
    const { agentRuntime, compiled, harness, trace } = createFixture();
    const result = await harness.run({ domain: vendorTriage, input: request("Aurelia Freight") });

    // M4's mapping, which M5's router replaces: `AgentRuntime` has no
    // `escalated` status, so the envelope travels in a `WorkflowError`'s
    // `details`.
    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      return;
    }

    expect(result.error.code).toBe("WORKFLOW");
    expect(result.error.details?.fallback).toMatchObject({
      reason: "unsupported_case",
      workflow: {
        id: "vendor-triage-v1",
        version: "1.0.0",
        fingerprint: compiled.fingerprint,
      },
    });

    expect(agentRuntime.calls).toHaveLength(0);
    expect(trace.types()).toContain("fallback.started");
    expect(nodeEvents(trace.events)).toStrictEqual([
      "node.started classify",
      "node.completed classify",
      "node.started route",
      "node.completed route",
      "node.started full-agent",
      // An `escalate` node is **not** a failure: it closes as completed and ends
      // the run with a fallback.
      "node.completed full-agent",
    ]);
  });

  it("carries what the compiled path established into the envelope", async () => {
    const { harness } = createFixture();
    const result = await harness.run({ domain: vendorTriage, input: request("Aurelia Freight") });

    if (result.status !== "failed") {
      expect.unreachable("the default route must escalate");
      return;
    }

    const fallback = result.error.details?.fallback as {
      readonly completedNodes: readonly { readonly nodeId: string; readonly trusted: boolean }[];
    };

    // The `escalate` node ran and its span closed, but it produces a
    // `FallbackContext` rather than a value, so it is not offered to the agent
    // as a completed node (M5-T6, ADR-0044).
    expect(fallback.completedNodes.map((node) => node.nodeId)).toStrictEqual(["classify", "route"]);
    // A `jev` answer is judgment, not established fact, so it is not trusted; a
    // `branch`'s pass-through output is.
    expect(fallback.completedNodes.find((node) => node.nodeId === "classify")?.trusted).toBe(false);
    expect(fallback.completedNodes.find((node) => node.nodeId === "route")?.trusted).toBe(true);
  });
});

describe("a failed node", () => {
  it("is visible in the trace, and the run escalates rather than reporting success", async () => {
    const { harness, trace } = createFixture({ registry: registryWithFailingFinalize() });
    const result = await harness.run({ domain: vendorTriage, input: request("Northwind Ledger") });

    expect(result.status).toBe("failed");

    const failed = trace.events.find((event) => event.type === "node.failed");

    expect(failed?.node).toBe("finalize");
    expect(failed?.error?.message).toContain("deliberately broken");
    expect(trace.types()).toContain("fallback.started");

    const fallback = trace.events.find((event) => event.type === "fallback.started");

    expect(fallback?.payload).toMatchObject({ reason: "workflow_error", nodeId: "finalize" });
  });
});

describe("node permissions", () => {
  it("refuses to run a node granting a tool the job does not, before anything executes", async () => {
    const { agentRuntime, harness, trace } = createFixture();
    // `harness.run({ permissions })` **replaces** the job's list, so this is a
    // job that may read the fixture tool and nothing else, while the `research`
    // node still grants `load_skill`.
    const result = await harness.run({
      domain: vendorTriage,
      input: request("Tessellate Analytics"),
      permissions: [{ toolId: "lookup_vendor_evidence", mode: "read" }],
    });

    expect(result.status).toBe("failed");

    if (result.status !== "failed") {
      return;
    }

    expect(result.error.code).toBe("PERMISSION_DENIED");
    expect(result.error.message).toContain("load_skill");
    // "Before any attempt" is the part that matters: the check runs before the
    // node's span opens, so the trace records the `research` node as never
    // having started and the agent was never reached.
    expect(agentRuntime.calls).toHaveLength(0);
    expect(nodeEvents(trace.events)).toStrictEqual([
      "node.started classify",
      "node.completed classify",
      "node.started route",
      "node.completed route",
    ]);
  });

  it("hands the agent node exactly its own grants and never the job's wider list", async () => {
    const { agentRuntime, harness } = createFixture();

    await harness.run({
      domain: vendorTriage,
      input: request("Tessellate Analytics"),
      permissions: [
        { toolId: "lookup_vendor_evidence", mode: "read" },
        { toolId: "load_skill", mode: "read" },
        { toolId: "publish_report", mode: "write" },
      ],
    });

    // The job grants three; the node grants two; the sub-run sees two. A `code`
    // node sees none at all, because it is called with one argument and no
    // context.
    expect(agentRuntime.calls[0]?.context.permissions).toStrictEqual([
      { toolId: "lookup_vendor_evidence", mode: "read" },
      { toolId: "load_skill", mode: "read" },
    ]);
  });
});

describe("the run ledger", () => {
  it("records the workflow run under its own target", async () => {
    const { harness, storage } = createFixture();
    const result = await harness.run({ domain: vendorTriage, input: request("Northwind Ledger") });
    const page = await storage.listRuns({ domainId: "vendor-triage" });
    const row = page.runs.find((candidate) => candidate.runId === result.runId);

    expect(row?.target).toBe("@internal/example-agent+workflow");
    expect(row?.status).toBe("completed");
  });
});
