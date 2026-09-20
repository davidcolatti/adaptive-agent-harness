import {
  type AgentExecution,
  type CapabilityRegistry,
  createExecutionContext,
  createTraceRecorder,
  type ExecutionContext,
  type FallbackContext,
  HARNESS_RUNTIME_INFO,
  type Job,
  newJobId,
  newRunId,
  type TraceEvent,
  type WorkflowVersionRecord,
} from "@internal/core";
import {
  createFakeAgentRuntime,
  createInMemoryStorage,
  createRecordingTraceWriter,
  type InMemoryStorage,
  type RecordingTraceWriter,
} from "@internal/testing";
import { createWorkflowRuntime, type WorkflowRuntime } from "@internal/workflow";
import { beforeEach, describe, expect, it } from "vitest";
import { createCircuitBreaker } from "./circuit-breaker.js";
import {
  capFallbackOutputs,
  createRouter,
  FALLBACK_ENVELOPE_MAX_BYTES,
  type Router,
  remainingBudgetAfter,
} from "./router.js";
import {
  compileFixture,
  createFixtureCapabilities,
  FIXTURE_DOMAIN,
  fixtureJob,
} from "./test-workflow.js";
import { createWorkflowRegistry, type WorkflowRegistry } from "./workflow-registry.js";

/**
 * The router (M5-T3 through M5-T6, ADR-0044).
 *
 * Every test here is deterministic, makes no model call and touches no
 * database: an in-memory `Storage`, the real registry over it, the real local
 * interpreter, and `createFakeAgentRuntime()` as the full agent. That is M5-T3's
 * "registry lookup is deterministic and unit-tested" and M5-T3's "do not use an
 * LLM to decide whether a known workflow exists" — there is no model in this
 * file to ask.
 */

/** What every test builds: a registry, a router, and what to inspect after. */
interface Fixture {
  readonly capabilities: CapabilityRegistry;
  readonly registry: WorkflowRegistry;
  readonly router: Router;
  readonly storage: InMemoryStorage;
  readonly trace: RecordingTraceWriter;
  readonly workflowRuntime: WorkflowRuntime;
  /** Every context the full agent was handed, in call order. */
  readonly fullAgentContexts: readonly ExecutionContext[];
  /** A fresh `ExecutionContext` for one run, sharing `trace`. */
  context(job: Job, budget?: Job["budget"]): ExecutionContext;
}

function createFixture(
  options: {
    readonly capabilities?: CapabilityRegistry;
    readonly fullAgentHandler?: (job: Job, context: ExecutionContext) => AgentExecution;
    readonly breakerThresholds?: { readonly fallbackRate: number; readonly failureRate: number };
  } = {},
): Fixture {
  const capabilities = options.capabilities ?? createFixtureCapabilities();
  const storage = createInMemoryStorage();
  const registry = createWorkflowRegistry({ storage });
  const trace = createRecordingTraceWriter();
  const fullAgentContexts: ExecutionContext[] = [];

  const fullAgent = createFakeAgentRuntime({
    handler: (job, context) => {
      fullAgentContexts.push(context);

      return (
        options.fullAgentHandler?.(job, context) ?? {
          status: "completed",
          output: { decision: "full-agent" },
          usage: { modelCalls: 3, toolCalls: 2, durationMs: 11, costUsd: 0.02 },
          runtime: { name: "fake-full-agent", version: "0.0.0", metadata: {} },
        }
      );
    },
  });

  // The workflow's own `agent` node runs a *different* fake, so a test can tell
  // "the workflow's agent ran" from "the fallback agent ran".
  const workflowRuntime = createWorkflowRuntime({
    registry: capabilities,
    agentRuntime: createFakeAgentRuntime({
      result: {
        status: "completed",
        output: { decision: "assisted" },
        usage: { modelCalls: 1, toolCalls: 1, durationMs: 5 },
        runtime: { name: "fake-node-agent", version: "0.0.0", metadata: {} },
      },
    }),
  });

  const router = createRouter({
    registry,
    capabilities,
    workflowRuntime,
    fullAgent,
    ...(options.breakerThresholds === undefined
      ? {}
      : {
          breaker: createCircuitBreaker({
            storage,
            registry,
            window: { runs: 10 },
            thresholds: options.breakerThresholds,
          }),
        }),
  });

  return {
    capabilities,
    registry,
    router,
    storage,
    trace,
    workflowRuntime,
    fullAgentContexts,
    context(job: Job, budget: Job["budget"] = {}): ExecutionContext {
      const runId = newRunId();

      return createExecutionContext({
        runId,
        jobId: job.id,
        domain: { ...FIXTURE_DOMAIN },
        budget,
        recorder: createTraceRecorder({ runId, writer: trace }),
      });
    },
  };
}

/** Register the fixture workflow and promote it straight to `active`. */
async function activate(
  fixture: Fixture,
  options: { readonly version?: string; readonly jobType?: string } = {},
): Promise<WorkflowVersionRecord> {
  const compiled = compileFixture(fixture.capabilities, options.version ?? "1.0.0");
  const draft = await fixture.registry.register(compiled, {
    domain: { ...FIXTURE_DOMAIN },
    actor: "david",
    sop: "vendor-triage-sop",
  });

  await fixture.registry.promote(draft.id, "candidate", { actor: "david" });

  return await fixture.registry.promote(draft.id, "active", { actor: "david" });
}

/** The recorded trace as `<type>` strings, in sequence order. */
function types(events: readonly TraceEvent[]): readonly string[] {
  return events.map((event) => event.type);
}

describe("createRouter", () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  describe("routing (M5-T3)", () => {
    it("routes to the compiled workflow when an active compatible version exists", async () => {
      const version = await activate(fixture);
      const job = fixtureJob("ok");

      const decision = await fixture.router.route(job);

      expect(decision.route).toBe("workflow");
      expect(decision.version?.id).toBe(version.id);
      expect(decision.refusal).toBeNull();

      const execution = await fixture.router.run(job, fixture.context(job));

      expect(execution.status).toBe("completed");
      expect(execution.workflowVersionId).toBe(version.id);
      expect(execution.fallbackCount).toBe(0);
      // The fixture workflow has no `jev` node, so zero here is a measurement.
      expect(execution.jevCalls).toBe(0);
      expect(execution.metadata).toMatchObject({
        route: "workflow",
        workflowVersionId: version.id,
        workflowId: "vendor-triage",
      });
      // The full agent was never asked: the compiled path answered.
      expect(fixture.fullAgentContexts).toHaveLength(0);
    });

    it("routes to the full agent when the registry holds nothing at all", async () => {
      const job = fixtureJob("ok");

      const decision = await fixture.router.route(job);

      expect(decision).toMatchObject({ route: "full-agent", version: null, compiled: null });
      expect(decision.rejections).toEqual([]);

      const execution = await fixture.router.run(job, fixture.context(job));

      expect(execution.status).toBe("completed");
      // No workflow ran, so the ledger column stays as `startRun` wrote it.
      expect(execution.workflowVersionId).toBeUndefined();
      expect(execution.metadata).toMatchObject({ route: "full-agent", workflowVersionId: null });
      expect(fixture.fullAgentContexts).toHaveLength(1);
    });

    it("never force-fits an unsupported job into a workflow, and says why", async () => {
      await activate(fixture);
      // The same domain, a job type the version does not declare. An exact-match
      // selector has no nearest neighbour to fall to.
      const job = fixtureJob("ok", { jobType: "renewal" });

      const decision = await fixture.router.route(job);

      expect(decision.route).toBe("full-agent");
      // No *candidate* was even considered: `findActive` filters by job type,
      // so the rejection list is empty and the honest answer is "nothing to
      // route to", not "something was rejected".
      expect(decision.rejections).toEqual([]);

      const execution = await fixture.router.run(job, fixture.context(job));

      expect(execution.status).toBe("completed");
      expect(execution.workflowVersionId).toBeUndefined();
    });

    it("reports the selector's rejections when an active version is incompatible", async () => {
      const version = await activate(fixture);
      // An input contract the version does not declare. The version is active
      // and for this job type, so it *is* a candidate, and it is rejected.
      const job = fixtureJob("ok", {
        contracts: {
          inputSchema: "vendor.other-input@1.0.0",
          outputSchema: "vendor.output@1.0.0",
          sop: "vendor-triage-sop",
        },
      });

      const decision = await fixture.router.route(job);

      expect(decision.route).toBe("full-agent");
      expect(decision.rejections).toEqual([
        {
          versionId: version.id,
          reason: "input-schema-mismatch",
          detail: expect.stringContaining("vendor.other-input@1.0.0"),
        },
      ]);
    });

    it("returns traffic to the full agent the moment an active version is retired", async () => {
      const version = await activate(fixture);
      const job = fixtureJob("ok");

      expect((await fixture.router.route(job)).route).toBe("workflow");

      await fixture.registry.retire(version.id, { actor: "david", reason: "regression" });

      // The **same router instance**, with no invalidation call in between:
      // routing re-resolves per run, so there is no cache to be stale.
      const after = await fixture.router.route(fixtureJob("ok"));

      expect(after.route).toBe("full-agent");
      expect(after.version).toBeNull();
    });

    it("is deterministic: the same job and registry decide the same way every time", async () => {
      const version = await activate(fixture);
      const job = fixtureJob("ok");

      const decisions = await Promise.all([
        fixture.router.route(job),
        fixture.router.route(job),
        fixture.router.route(job),
      ]);

      for (const decision of decisions) {
        expect(decision.route).toBe("workflow");
        expect(decision.version?.id).toBe(version.id);
      }
    });
  });

  describe("workflow outcomes", () => {
    it("reports a workflow defect as a failure, and never escalates it", async () => {
      // A `FailedWorkflowRun` is an invariant violation — a graph the validator
      // was supposed to have rejected — and a compiled workflow cannot be made
      // to produce one without first defeating the validator. The interpreter is
      // therefore stubbed for exactly this case, which is the router's own
      // contract under test: what it does with each `WorkflowRunResult` status.
      const defective = createFixture();
      const version = await activate(defective);
      const stubbed = createRouter({
        registry: defective.registry,
        capabilities: defective.capabilities,
        fullAgent: createFakeAgentRuntime({
          result: {
            status: "completed",
            output: { decision: "full-agent" },
            usage: { modelCalls: 1, toolCalls: 0, durationMs: 1 },
            runtime: { name: "fake-full-agent", version: "0.0.0", metadata: {} },
          },
        }),
        workflowRuntime: {
          ...defective.workflowRuntime,
          run: async () => ({
            status: "failed",
            error: {
              name: "WorkflowError",
              code: "WORKFLOW",
              message: "node `ghost` does not exist",
              details: {},
            },
            usage: { modelCalls: 0, toolCalls: 0, durationMs: 1 },
            nodes: [],
            jevCalls: 0,
          }),
        },
      });
      const job = fixtureJob("ok");

      const execution = await stubbed.run(job, defective.context(job));

      // "Workflow failure does not mark the job successful" (M5 acceptance), and
      // a defect is not a fallback condition: escalating one would hide a bug
      // behind a working system (ADR-0040).
      expect(execution.status).toBe("failed");
      expect(execution.fallbackCount).toBe(0);
      expect(execution.workflowVersionId).toBe(version.id);
    });

    it("completes through the fallback agent and records that a fallback happened", async () => {
      const version = await activate(fixture);
      const job = fixtureJob("nope");

      const execution = await fixture.router.run(job, fixture.context(job));

      // The run completed because the *agent* completed it. The ledger says
      // which workflow was tried and that it handed the job back, so a later
      // reader can tell this from a workflow that answered on its own.
      expect(execution.status).toBe("completed");
      expect(execution.fallbackCount).toBe(1);
      expect(execution.workflowVersionId).toBe(version.id);
    });

    it("reports a failed fallback agent as a failure", async () => {
      const failing = createFixture({
        fullAgentHandler: () => ({
          status: "failed",
          error: {
            name: "AgentExecutionError",
            code: "AGENT_EXECUTION",
            message: "the agent gave up",
            details: {},
          },
          usage: { modelCalls: 1, toolCalls: 0, durationMs: 4 },
          runtime: { name: "fake-full-agent", version: "0.0.0", metadata: {} },
        }),
      });
      const version = await activate(failing);
      const job = fixtureJob("nope");

      const execution = await failing.router.run(job, failing.context(job));

      expect(execution.status).toBe("failed");
      expect(execution.fallbackCount).toBe(1);
      expect(execution.workflowVersionId).toBe(version.id);
    });
  });

  describe("escalation and the fallback envelope (M5-T5, M5-T6)", () => {
    it("hands the full agent the original job and what the workflow established", async () => {
      await activate(fixture);
      const job = fixtureJob("escalate", {
        budget: { maxModelCalls: 10, maxToolCalls: 10, maxDurationMs: 60_000 },
      });

      const execution = await fixture.router.run(
        job,
        fixture.context(job, { maxModelCalls: 10, maxToolCalls: 10, maxDurationMs: 60_000 }),
      );

      expect(execution.status).toBe("completed");
      expect(execution.fallbackCount).toBe(1);
      expect(fixture.fullAgentContexts).toHaveLength(1);

      const fallback = fixture.fullAgentContexts[0]?.fallback;

      expect(fallback).toBeDefined();
      expect(fallback?.reason).toBe("unsupported_case");
      expect(fallback?.nodeId).toBe("give-up");
      expect(fallback?.detail).toContain("no route it can justify");
      expect(fallback?.workflow).toMatchObject({ id: "vendor-triage", version: "1.0.0" });
    });

    it("marks only deterministic validated outputs as trusted", async () => {
      await activate(fixture);
      const job = fixtureJob("escalate");

      await fixture.router.run(job, fixture.context(job));

      const completed = fixture.fullAgentContexts[0]?.fallback?.completedNodes ?? [];

      // `route` is a `branch`: harness-side computation over an already
      // validated input, so the agent may build on it (ADR-0040).
      expect(completed).toContainEqual({
        nodeId: "route",
        outputRef: "node:route",
        trusted: true,
        // The value itself, not only a pointer to it: the router fills it in
        // from the run's records (M5-T6).
        output: { label: "escalate", vendor: "acme" },
      });
      // `assist` is an `agent`: its output validated, which is why it is listed
      // at all, but a schema says an answer is well shaped, not that it is
      // right. Over-trusting it is exactly what north-star invariant 2 forbids.
      // Carried **and** flagged untrusted. An `agent` result is exactly what a
      // full agent most needs to see and least should take on faith, so it
      // travels with `trusted: false` rather than being withheld.
      expect(completed).toContainEqual({
        nodeId: "assist",
        outputRef: "node:assist",
        trusted: false,
        output: { decision: "assisted" },
      });
      // The node that gave up produced nothing, so it is not listed at all:
      // "failed/partial node output is not automatically reusable" (M5-T6).
      expect(completed.map((node) => node.nodeId)).not.toContain("give-up");
    });

    it("recalculates the remaining budget before invoking the agent", async () => {
      await activate(fixture);
      const budget = { maxModelCalls: 10, maxToolCalls: 10, maxDurationMs: 60_000 };
      const job = fixtureJob("escalate", { budget });

      await fixture.router.run(job, fixture.context(job, budget));

      const context = fixture.fullAgentContexts[0];
      const remaining = context?.fallback?.remainingBudget;

      // The workflow's `agent` node spent one model call and one tool call, so
      // the agent is handed strictly less than the job started with — in every
      // dimension the workflow touched.
      expect(remaining?.maxModelCalls).toBe(9);
      expect(remaining?.maxToolCalls).toBe(9);
      // Wall clock, not a counter: an in-process fixture can genuinely take
      // zero whole milliseconds, so the assertion is that time was subtracted
      // rather than that it was measurable.
      expect(remaining?.maxDurationMs).toBeLessThanOrEqual(60_000);
      // And the context it actually runs under carries that budget, not the
      // job's: an agent must not be able to spend the workflow's money twice.
      expect(context?.budget).toEqual(remaining);
    });

    it("leaves the original job untouched", async () => {
      await activate(fixture);
      const job = fixtureJob("escalate", { budget: { maxModelCalls: 4 } });
      const before = JSON.stringify(job);

      await fixture.router.run(job, fixture.context(job, { maxModelCalls: 4 }));

      expect(JSON.stringify(job)).toBe(before);
    });

    it("links the compiled run span to the fallback agent execution in the trace", async () => {
      await activate(fixture);
      const job = fixtureJob("escalate");

      await fixture.router.run(job, fixture.context(job));

      const events = fixture.trace.events;
      const started = events.find((event) => event.type === "fallback.started");
      const completed = events.find((event) => event.type === "fallback.completed");

      expect(started).toBeDefined();
      expect(completed).toBeDefined();
      // The link: the terminal event is a child of the `fallback.started` span,
      // and both carry the node that gave up.
      expect(completed?.parentId).toBe(started?.id);
      expect(completed?.payload).toMatchObject({
        reason: "unsupported_case",
        outcome: "completed",
        agentRuntime: "fake-full-agent",
      });
      // Started before completed, in one sequence: there is one recorder.
      expect(types(events).indexOf("fallback.started")).toBeLessThan(
        types(events).indexOf("fallback.completed"),
      );
    });

    it("roots the fallback agent's own events on the fallback span", async () => {
      const observed: string[] = [];
      const linked = createFixture({
        fullAgentHandler: (_job, context) => {
          observed.push(String(context.trace.rootId));

          return {
            status: "completed",
            output: { decision: "full-agent" },
            usage: { modelCalls: 1, toolCalls: 0, durationMs: 3 },
            runtime: { name: "fake-full-agent", version: "0.0.0", metadata: {} },
          };
        },
      });

      await activate(linked);
      const job = fixtureJob("escalate");

      await linked.router.run(job, linked.context(job));

      const started = linked.trace.events.find((event) => event.type === "fallback.started");

      // An adapter parents its first event on `context.trace.rootId`, so this is
      // what makes the agent's whole subtree hang under the escalation rather
      // than beside it.
      expect(observed).toEqual([String(started?.id)]);
    });

    it("reports the whole attempt's usage, workflow plus fallback", async () => {
      await activate(fixture);
      const job = fixtureJob("escalate");

      const execution = await fixture.router.run(job, fixture.context(job));

      // The workflow's `agent` node spent 1 model call and 1 tool call; the
      // fallback agent spent 3 and 2. Reporting only the second half would make
      // the compiled path look free every time it gave up.
      expect(execution.usage.modelCalls).toBe(4);
      expect(execution.usage.toolCalls).toBe(3);
    });

    it("sums the decisions made on both sides of the handoff", async () => {
      // The compiled path's judgments plus any the full agent made after it
      // took over. Reporting only the agent's would make the workflow's
      // judgments free on the ledger, which is exactly the comparison M6 and
      // M7 need to be able to trust.
      const counting = createFixture({
        fullAgentHandler: () => ({
          status: "completed",
          output: { decision: "full-agent" },
          usage: { modelCalls: 1, toolCalls: 0, durationMs: 2 },
          runtime: { name: "fake-full-agent", version: "0.0.0", metadata: {} },
          jevCalls: 1,
        }),
      });
      const version = await activate(counting);
      const job = fixtureJob("escalate");
      const escalating = createRouter({
        registry: counting.registry,
        capabilities: counting.capabilities,
        fullAgent: createFakeAgentRuntime({
          handler: () => ({
            status: "completed",
            output: { decision: "full-agent" },
            usage: { modelCalls: 1, toolCalls: 0, durationMs: 2 },
            runtime: { name: "fake-full-agent", version: "0.0.0", metadata: {} },
            jevCalls: 1,
          }),
        }),
        workflowRuntime: {
          ...counting.workflowRuntime,
          run: async (workflow, innerJob, context) => {
            const result = await counting.workflowRuntime.run(workflow, innerJob, context);

            // The fixture workflow has no `jev` node, so the interpreter
            // honestly reports zero; this substitutes a run that made two
            // decisions, which is what the summing is about.
            return { ...result, jevCalls: 2 };
          },
        },
      });

      const execution = await escalating.run(job, counting.context(job));

      expect(execution.fallbackCount).toBe(1);
      expect(execution.jevCalls).toBe(3);
      expect(execution.workflowVersionId).toBe(version.id);
    });

    it("publishes the envelope in the execution's metadata", async () => {
      await activate(fixture);
      const job = fixtureJob("escalate");

      const execution = await fixture.router.run(job, fixture.context(job));
      const fallback = (execution.metadata as { readonly fallback?: FallbackContext } | undefined)
        ?.fallback;

      expect(fallback).toMatchObject({ reason: "unsupported_case", nodeId: "give-up" });
    });
  });

  describe("the circuit breaker seam (M5-T7)", () => {
    it("sends traffic to the full agent while a supplied breaker reports tripped", async () => {
      const tripped = createFixture({ breakerThresholds: { fallbackRate: 0.5, failureRate: 1 } });
      const version = await activate(tripped);

      // Two finished runs of this version, both with a fallback: a 1.0 fallback
      // rate against a 0.5 threshold.
      for (const _ of [0, 1]) {
        const runId = newRunId();
        const jobId = newJobId();

        await tripped.storage.startRun({
          runId,
          jobId,
          attempt: 1,
          domain: { ...FIXTURE_DOMAIN },
          jobType: "triage",
          behaviorFingerprint: null,
          agentVersion: null,
          workflowVersionId: version.id,
          target: null,
          runtime: HARNESS_RUNTIME_INFO,
          startedAt: new Date().toISOString(),
        });
        await tripped.storage.finishRun({
          runId,
          status: "completed",
          success: true,
          costUsd: null,
          latencyMs: 5,
          modelCalls: 1,
          toolCalls: 0,
          jevCalls: 0,
          fallbackCount: 1,
          runtime: HARNESS_RUNTIME_INFO,
          finishedAt: new Date().toISOString(),
          error: null,
        });
      }

      const decision = await tripped.router.route(fixtureJob("ok"));

      expect(decision.route).toBe("full-agent");
      expect(decision.refusal).toMatchObject({ kind: "circuit-breaker", versionId: version.id });
      // The version is still `active`: the router refused to send traffic, and
      // retiring is a status change a human makes (AD-005).
      expect((await tripped.storage.getWorkflowVersion(version.id))?.status).toBe("active");
    });
  });
});

describe("capFallbackOutputs", () => {
  /** An envelope whose completed nodes carry `sizes` bytes of filler each. */
  function envelope(sizes: readonly number[]): FallbackContext {
    return {
      reason: "unsupported_case",
      detail: "no route",
      nodeId: null,
      workflow: { id: "w", version: "1.0.0", fingerprint: "sha256:abc" },
      completedNodes: sizes.map((size, index) => ({
        nodeId: `n${String(index)}` as FallbackContext["completedNodes"][number]["nodeId"],
        outputRef: `node:n${String(index)}`,
        trusted: true,
        output: { filler: "x".repeat(size) },
      })),
      evidenceRefs: [],
      remainingBudget: {},
    };
  }

  it("leaves an envelope that already fits completely alone", () => {
    const small = envelope([10, 10]);

    expect(capFallbackOutputs(small)).toBe(small);
  });

  it("drops the largest output first, and keeps its reference", () => {
    // One node far over the budget and two well under it. Dropping the big one
    // is enough, so the small ones — the deterministic intermediates an agent
    // can actually act on — survive.
    const capped = capFallbackOutputs(envelope([200, FALLBACK_ENVELOPE_MAX_BYTES + 1_000, 200]));

    expect(capped.completedNodes.map((node) => node.output === null)).toEqual([false, true, false]);
    // A dropped value is still named: the agent is told the node completed and
    // where its result lives, rather than being told nothing.
    expect(capped.completedNodes[1]?.outputRef).toBe("node:n1");
    expect(capped.completedNodes[1]?.trusted).toBe(true);
  });

  it("says in `detail` which results it could not carry", () => {
    const capped = capFallbackOutputs(envelope([FALLBACK_ENVELOPE_MAX_BYTES + 1_000]));

    // An agent silently given less than it asked for would conclude the work
    // was never done.
    expect(capped.detail).toContain("no route");
    expect(capped.detail).toContain("n0");
    expect(capped.detail).toContain("too large to carry inline");
  });

  it("stops dropping as soon as the envelope fits", () => {
    // Three equal outputs, each a third of a budget that two of them exceed.
    const third = Math.floor(FALLBACK_ENVELOPE_MAX_BYTES / 2);
    const capped = capFallbackOutputs(envelope([third, third, third]));
    const nulls = capped.completedNodes.filter((node) => node.output === null);

    expect(nulls.length).toBeGreaterThan(0);
    expect(nulls.length).toBeLessThan(3);
  });

  it("honours a caller-supplied budget", () => {
    const capped = capFallbackOutputs(envelope([500, 500]), 200);

    expect(capped.completedNodes.every((node) => node.output === null)).toBe(true);
  });
});

describe("remainingBudgetAfter", () => {
  it("leaves an absent dimension absent", () => {
    // An absent dimension is unlimited, and unlimited minus three is unlimited,
    // not a number.
    expect(remainingBudgetAfter({}, { modelCalls: 3, toolCalls: 3, durationMs: 3 })).toEqual({});
  });

  it("floors an overspent dimension at zero rather than going negative", () => {
    expect(
      remainingBudgetAfter(
        { maxModelCalls: 2, maxCostUsd: 1 },
        { modelCalls: 5, toolCalls: 0, durationMs: 0, costUsd: 4 },
      ),
    ).toEqual({ maxModelCalls: 0, maxCostUsd: 0 });
  });

  it("leaves the cost budget alone when the runtime did not know what it spent", () => {
    // Not knowing what was spent is not a proof that nothing was.
    expect(
      remainingBudgetAfter({ maxCostUsd: 1.5 }, { modelCalls: 1, toolCalls: 0, durationMs: 2 }),
    ).toEqual({ maxCostUsd: 1.5 });
  });
});
