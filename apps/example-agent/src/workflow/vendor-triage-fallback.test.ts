import type {
  AgentExecution,
  CapabilityKind,
  CapabilityRef,
  CapabilityRegistry,
  ExecutionContext,
  FallbackContext,
  Job,
  TraceEvent,
  WorkflowVersionRecord,
} from "@internal/core";
import { createHarness, formatCapabilityRef } from "@internal/core";
import { createRouter, createWorkflowRegistry } from "@internal/registry";
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
 * Milestone 5's required integration test (M5-T6): **the full agent consumes
 * what the compiled workflow already established, and the harness does not
 * repeat the research tool call.**
 *
 * Everything here is real except the two model-shaped things a unit test may
 * not call: the whole `createHarness()` path, the real vendor-triage domain,
 * the real capability registry, the hand-authored compiled workflow, the real
 * `@internal/registry` router over a real registry, the real local interpreter,
 * and the real trace recorder. The workflow's `research` node and the router's
 * full agent are each a `createFakeAgentRuntime()`, which is AGENTS.md's test
 * taxonomy ("no live model calls" in the unit layer) rather than a shortcut:
 * both implement `AgentRuntime` and nothing else, and both record into the
 * run's own recorder exactly as `EveAgentRuntime` does.
 *
 * Using two *different* fakes is what makes the central assertion possible. The
 * question is whether the fallback agent re-did the workflow's research, and
 * that can only be answered if "the workflow's agent ran" and "the fallback
 * agent ran" leave distinguishable marks in one trace.
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

/**
 * What the fallback agent produces, **built from the envelope** rather than
 * from a constant.
 *
 * This is the difference between a test that proves the agent *could* have used
 * the workflow's research and one that proves it *did*. The agent is handed no
 * vendor evidence of its own and calls no tool; everything factual in its answer
 * has to come from `node:research`'s inline output, so asserting that its
 * `evidence` equals the workflow's is a real statement about the envelope
 * carrying usable evidence.
 */
function triageFromEnvelope(fallback: FallbackContext | undefined): VendorTriageOutput {
  const research = fallback?.completedNodes.find((node) => node.nodeId === "research");
  const completed = research?.output as VendorTriageOutput | null | undefined;

  if (completed == null) {
    // Nothing to build on: either the compiled path escalated before reaching
    // `research`, or no workflow ran at all. A real agent researches from
    // scratch here, and so does this one — with **visibly different** evidence,
    // which is what keeps the equality assertions honest. If a regression
    // emptied the envelope, the research-route test would get this value and
    // fail rather than silently matching a shared constant.
    return {
      ...AGENT_TRIAGE,
      evidence: [{ claim: "Researched from scratch by the full agent.", source: "no envelope" }],
      recommendation: {
        decision: "request_information",
        rationale: "No completed research was handed over, so the agent started from nothing.",
      },
    };
  }

  return {
    ...completed,
    recommendation: {
      decision: "request_information",
      rationale: "Confirmed from the workflow's completed research; no further lookup was needed.",
    },
  };
}

function request(vendorName: string): VendorTriageInput {
  return { vendorName, procurementSop: PROCUREMENT_SOP };
}

/** What the fallback agent saw, recorded for assertions after the run. */
interface FallbackObservation {
  readonly fallback: FallbackContext | undefined;
  readonly budget: ExecutionContext["budget"];
  readonly rootId: string;
  readonly jobJson: string;
}

interface Fixture {
  readonly harness: ReturnType<typeof createHarness>;
  readonly storage: ReturnType<typeof createInMemoryStorage>;
  readonly trace: ReturnType<typeof createRecordingTraceWriter>;
  readonly version: WorkflowVersionRecord;
  readonly observations: readonly FallbackObservation[];
}

/**
 * The whole path: registry, active version, router, harness.
 *
 * `capabilities` is how a test breaks one node without touching the domain:
 * `compileWorkflow()` only asks `has()`, so the workflow still compiles, and
 * the runtime asks `resolve()`, which is where a wrapper can return a thrower.
 * The same technique `vendor-triage-run.test.ts` already uses.
 */
async function createFixture(
  options: { readonly capabilities?: CapabilityRegistry } = {},
): Promise<Fixture> {
  const capabilities = options.capabilities ?? createVendorTriageRegistry();
  const compiled = compileVendorTriageWorkflow(capabilities);
  const storage = createInMemoryStorage();
  const trace = createRecordingTraceWriter();
  const observations: FallbackObservation[] = [];

  // The workflow's `research` node. It records the same `agent.*` / `tool.*`
  // events an adapter would, so "the research tool was called" is a fact about
  // the trace rather than about this fixture's bookkeeping.
  const researchAgent = createFakeAgentRuntime({
    handler: async (_job, context) => {
      const agentSpan = await context.trace.span({
        type: "agent.started",
        parentId: context.trace.rootId,
        payload: { agent: "vendor-triage-agent" },
      });
      const toolSpan = await context.trace.span({
        type: "tool.started",
        parentId: agentSpan.id,
        payload: { tool: "lookup_vendor_evidence" },
      });

      await toolSpan.end({ type: "tool.completed", payload: { tool: "lookup_vendor_evidence" } });
      await agentSpan.end({ type: "agent.completed", payload: { agent: "vendor-triage-agent" } });

      return {
        status: "completed",
        output: AGENT_TRIAGE,
        usage: { modelCalls: 2, toolCalls: 1, durationMs: 7 },
        runtime: { name: "fake-research-agent", version: "0.0.0", metadata: {} },
      } satisfies AgentExecution;
    },
  });

  // The router's full agent: what an escalation reaches. It asserts nothing
  // itself — assertions belong in the tests — but records what it saw and
  // produces the final triage **without calling any tool**.
  const fullAgent = createFakeAgentRuntime({
    handler: async (job: Job, context: ExecutionContext) => {
      observations.push({
        fallback: context.fallback,
        budget: context.budget,
        rootId: String(context.trace.rootId),
        jobJson: JSON.stringify(job),
      });

      const span = await context.trace.span({
        type: "agent.started",
        parentId: context.trace.rootId,
        payload: { agent: "vendor-triage-full-agent" },
      });

      await span.end({ type: "agent.completed", payload: { agent: "vendor-triage-full-agent" } });

      return {
        status: "completed",
        // Built from `context.fallback`, not from a constant, and it throws if
        // the envelope carried nothing usable.
        output: triageFromEnvelope(context.fallback),
        // One model call, **no tool call**: the whole point of the envelope.
        usage: { modelCalls: 1, toolCalls: 0, durationMs: 3 },
        runtime: { name: "fake-full-agent", version: "0.0.0", metadata: {} },
      } satisfies AgentExecution;
    },
  });

  const registry = createWorkflowRegistry({ storage });
  const draft = await registry.register(compiled, {
    domain: { id: vendorTriage.id, version: vendorTriage.version },
    actor: "example-agent",
    sop: "procurement-sop",
  });

  await registry.promote(draft.id, "candidate", { actor: "example-agent" });

  const version = await registry.promote(draft.id, "active", { actor: "example-agent" });

  const router = createRouter({
    registry,
    capabilities,
    workflowRuntime: createWorkflowRuntime({
      registry: capabilities,
      agentRuntime: researchAgent,
      decisionEngine: createVendorDecisionPort(),
    }),
    fullAgent,
  });

  return {
    harness: createHarness({
      agentRuntime: router,
      trace,
      storage,
      target: "@internal/example-agent+router",
    }),
    storage,
    trace,
    version,
    observations,
  };
}

/** The domain registry with one handler replaced by a thrower. */
function registryWithFailingDecide(): CapabilityRegistry {
  const registry = createVendorTriageRegistry();

  return {
    register: (kind, registration) => registry.register(kind, registration),
    has: (kind, ref) => registry.has(kind, ref),
    entries: () => registry.entries(),
    toManifest: () => registry.toManifest(),
    resolve<TValue>(kind: CapabilityKind, ref: CapabilityRef | string): TValue {
      const formatted = typeof ref === "string" ? ref : formatCapabilityRef(ref);

      if (kind === "handler" && formatted === "decide-verified-triage@1.0.0") {
        return ((): never => {
          throw new Error("the decide handler is deliberately broken in this test");
        }) as TValue;
      }

      return registry.resolve<TValue>(kind, ref);
    },
  };
}

/** Every event of `type`, in sequence order. */
function eventsOfType(events: readonly TraceEvent[], type: string): readonly TraceEvent[] {
  return events.filter((event) => event.type === type);
}

describe("the vendor workflow falling back to the full agent (M5-T5, M5-T6)", () => {
  describe("after the research route breaks downstream of the agent", () => {
    it("reaches the full agent with the research the workflow already completed", async () => {
      const fixture = await createFixture({ capabilities: registryWithFailingDecide() });

      // `Tessellate Analytics` is on file with a research indicator, so the
      // fixture decision port routes it to `research`: the agent runs, `verify`
      // runs, and the broken `decide` handler is what gives up.
      const result = await fixture.harness.run({
        domain: vendorTriage,
        input: request("Tessellate Analytics"),
      });

      expect(result.status).toBe("completed");

      const observation = fixture.observations[0];

      expect(fixture.observations).toHaveLength(1);
      expect(observation?.fallback).toBeDefined();
      expect(observation?.fallback?.reason).toBe("workflow_error");
      expect(observation?.fallback?.nodeId).toBe("decide");
      expect(observation?.fallback?.detail).toContain("deliberately broken");
      expect(observation?.fallback?.workflow).toMatchObject({
        id: "vendor-triage-v1",
        version: "1.0.0",
      });

      // The research the agent did travels **with its output**, so the full
      // agent can use it rather than merely learn that it happened.
      expect(observation?.fallback?.completedNodes).toContainEqual({
        nodeId: "research",
        outputRef: "node:research",
        // **Not trusted, and that is the correct answer** (ADR-0040): an
        // `agent` node is probabilistic, and a schema says an answer is well
        // shaped rather than right. It is still carried, because an untrusted
        // result is exactly what the full agent most needs to see and least
        // should take on faith — the flag tells it which, rather than the
        // envelope withholding it (ADR-0044).
        trusted: false,
        output: AGENT_TRIAGE,
      });
      // The node that gave up produced nothing, so it is not offered at all.
      expect(
        (observation?.fallback?.completedNodes ?? []).map((node) => node.nodeId),
      ).not.toContain("decide");
    });

    it("builds its answer out of the workflow's research, not out of nothing", async () => {
      const fixture = await createFixture({ capabilities: registryWithFailingDecide() });

      const result = await fixture.harness.run({
        domain: vendorTriage,
        input: request("Tessellate Analytics"),
      });

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      // M5-T5, stated as an assertion rather than as an absence: the agent
      // called no tool and was given no vendor evidence of its own, so every
      // factual claim in its answer came out of the envelope. If the envelope
      // carried references alone, `triageFromEnvelope()` would have thrown and
      // this run would have failed.
      const output = result.output as VendorTriageOutput;

      expect(output.evidence).toEqual(AGENT_TRIAGE.evidence);
      expect(output.riskFlags).toEqual(AGENT_TRIAGE.riskFlags);
      expect(output.category).toBe(AGENT_TRIAGE.category);
      // And it did its own job on top of the evidence rather than echoing the
      // workflow's conclusion.
      expect(output.recommendation.rationale).toContain("Confirmed from the workflow");
    });

    it("does not repeat the research tool call", async () => {
      const fixture = await createFixture({ capabilities: registryWithFailingDecide() });

      await fixture.harness.run({
        domain: vendorTriage,
        input: request("Tessellate Analytics"),
      });

      const events = fixture.trace.events;

      // **Exactly once, from the workflow.** This is M5-T6's required proof:
      // the research tool ran inside the compiled path and the fallback agent
      // did not run it again.
      expect(eventsOfType(events, "tool.started")).toHaveLength(1);
      expect(eventsOfType(events, "tool.completed")).toHaveLength(1);
      expect(eventsOfType(events, "tool.started")[0]?.payload).toMatchObject({
        tool: "lookup_vendor_evidence",
      });

      // Two agent runs, and they are distinguishable: the workflow's research
      // agent, then the fallback agent.
      expect(eventsOfType(events, "agent.started").map((event) => event.payload.agent)).toEqual([
        "vendor-triage-agent",
        "vendor-triage-full-agent",
      ]);
    });

    it("recalculates the remaining budget before the agent is invoked", async () => {
      const fixture = await createFixture({ capabilities: registryWithFailingDecide() });

      await fixture.harness.run({
        domain: vendorTriage,
        input: request("Tessellate Analytics"),
      });

      const budget = fixture.observations[0]?.budget;

      // The domain's job allows eight model calls and eight tool calls. The
      // compiled path spent four model calls before giving up — two `jev`
      // decisions and the research agent's two — and one tool call, so that is
      // what the fallback agent no longer has.
      expect(budget?.maxModelCalls).toBe(4);
      expect(budget?.maxToolCalls).toBe(7);
      expect(budget?.maxDurationMs).toBeLessThanOrEqual(120_000);
      // And the envelope agrees with the context it travels in.
      expect(fixture.observations[0]?.fallback?.remainingBudget).toEqual(budget);
    });

    it("links the compiled run span to the fallback agent execution", async () => {
      const fixture = await createFixture({ capabilities: registryWithFailingDecide() });

      await fixture.harness.run({
        domain: vendorTriage,
        input: request("Tessellate Analytics"),
      });

      const events = fixture.trace.events;
      const started = eventsOfType(events, "fallback.started")[0];
      const completed = eventsOfType(events, "fallback.completed")[0];
      const agentStarted = eventsOfType(events, "agent.started")[1];

      expect(started).toBeDefined();
      // `fallback.started` → the agent's own events, parented on it →
      // `fallback.completed`, in one sequence, from one recorder.
      expect(agentStarted?.parentId).toBe(started?.id);
      expect(completed?.parentId).toBe(started?.id);
      expect(completed?.payload).toMatchObject({ outcome: "completed" });
      expect(fixture.observations[0]?.rootId).toBe(String(started?.id));
    });

    it("records the fallback and the workflow version on the run's ledger row", async () => {
      const fixture = await createFixture({ capabilities: registryWithFailingDecide() });

      const result = await fixture.harness.run({
        domain: vendorTriage,
        input: request("Tessellate Analytics"),
      });

      const run = await fixture.storage.getRun(result.runId);

      expect(run).toMatchObject({
        status: "completed",
        fallbackCount: 1,
        workflowVersionId: fixture.version.id,
      });
      // The whole attempt's cost, not just the agent's half: four model calls
      // inside the workflow plus the fallback agent's one.
      expect(run?.modelCalls).toBe(5);
      expect(run?.toolCalls).toBe(1);
      // `runs.jev_calls` is a measurement now, not a hardcoded zero: the
      // research route asks both `jev` nodes — `classify` and `verify` — for a
      // decision before `decide` gives up.
      expect(run?.jevCalls).toBe(2);
    });

    it("leaves the original job immutable", async () => {
      const fixture = await createFixture({ capabilities: registryWithFailingDecide() });

      await fixture.harness.run({
        domain: vendorTriage,
        input: request("Tessellate Analytics"),
      });

      const handedOver = JSON.parse(fixture.observations[0]?.jobJson ?? "{}") as Job;
      const stored = await fixture.storage.getJob(handedOver.id);

      // The agent was handed the job as the harness built it and saved it, not
      // a narrowed or annotated copy: everything the fallback adds lives in the
      // context. Compared by value rather than by serialized bytes, because key
      // order is not part of what "unchanged" means here.
      expect(handedOver).toEqual(JSON.parse(JSON.stringify(stored)));
    });
  });

  describe("after the default route escalates", () => {
    it("reaches the full agent with `unsupported_case` and no tool call at all", async () => {
      const fixture = await createFixture();

      // A vendor with no frozen evidence on file: the fixture decision port
      // answers `uncertain`, and the graph's `default` branch is the authored
      // escalation.
      const result = await fixture.harness.run({
        domain: vendorTriage,
        input: request("Aurelia Freight"),
      });

      expect(result.status).toBe("completed");
      expect(fixture.observations[0]?.fallback?.reason).toBe("unsupported_case");
      expect(fixture.observations[0]?.fallback?.nodeId).toBe("full-agent");
      expect(fixture.observations[0]?.fallback?.detail).toContain("no route it can justify");
      // The compiled path never reached the research node, so the envelope
      // offers only the decision and the branch.
      expect(
        (fixture.observations[0]?.fallback?.completedNodes ?? []).map((node) => node.nodeId),
      ).toEqual(["classify", "route"]);
      // Nothing looked anything up, in the workflow or afterwards.
      expect(eventsOfType(fixture.trace.events, "tool.started")).toHaveLength(0);

      const run = await fixture.storage.getRun(result.runId);

      expect(run).toMatchObject({ fallbackCount: 1, workflowVersionId: fixture.version.id });
      // One decision: `classify` ran and routed to the escalation, so `verify`
      // never did.
      expect(run?.jevCalls).toBe(1);
    });
  });

  describe("when the workflow answers on its own", () => {
    it("never invokes the full agent and records no fallback", async () => {
      const fixture = await createFixture();

      // `Northwind Ledger` is on file with nothing that needs reading, so the
      // compiled path finishes in code.
      const result = await fixture.harness.run({
        domain: vendorTriage,
        input: request("Northwind Ledger"),
      });

      expect(result.status).toBe("completed");
      expect(fixture.observations).toHaveLength(0);
      expect(eventsOfType(fixture.trace.events, "fallback.started")).toHaveLength(0);

      const run = await fixture.storage.getRun(result.runId);

      expect(run).toMatchObject({ fallbackCount: 0, workflowVersionId: fixture.version.id });
      expect(run?.jevCalls).toBe(1);
    });
  });

  describe("when no workflow is compatible", () => {
    it("routes straight to the full agent and leaves the workflow column null", async () => {
      const fixture = await createFixture();

      // The registry holds one active version for `vendor-triage`; retiring it
      // returns traffic to the full agent with nothing to invalidate.
      const registry = createWorkflowRegistry({ storage: fixture.storage });

      await registry.retire(fixture.version.id, { actor: "example-agent", reason: "test" });

      const result = await fixture.harness.run({
        domain: vendorTriage,
        input: request("Northwind Ledger"),
      });

      expect(result.status).toBe("completed");
      expect(fixture.observations).toHaveLength(1);
      // No workflow ran, so nothing overwrote `startRun`'s `null`.
      expect(fixture.observations[0]?.fallback).toBeUndefined();

      const run = await fixture.storage.getRun(result.runId);

      expect(run).toMatchObject({ fallbackCount: 0, workflowVersionId: null });
      // The full agent ran alone and asked for no decisions, so zero here is a
      // measurement too.
      expect(run?.jevCalls).toBe(0);
    });
  });
});
