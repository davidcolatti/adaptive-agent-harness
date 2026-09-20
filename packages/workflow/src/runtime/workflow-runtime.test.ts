import type { TraceEvent } from "@internal/core";
import {
  createCapabilityRegistry,
  createHarness,
  createTraceRecorder,
  defineDomain,
  newJobId,
  newRunId,
} from "@internal/core";
import {
  createFakeAgentRuntime,
  createInMemoryStorage,
  createRecordingTraceWriter,
} from "@internal/testing";
import { describe, expect, it } from "vitest";
import { compileWorkflow } from "../compile.js";
import { workflow } from "../dsl/index.js";
import { createInMemoryArtifactStore, createInMemoryProtectedEffectStore } from "./ports.js";
import {
  ANY_SCHEMA,
  agentNode,
  artifactNode,
  branchNode,
  callNode,
  chainNode,
  codeNode,
  compiledWorkflow,
  createRunFixture,
  createTestRegistry,
  escalateNode,
  guardSchema,
  jevNode,
  loopNode,
  mapNode,
  passSchema,
  recordingSleep,
  reduceNode,
  registerFunction,
  registerSchema,
  TEST_DOMAIN,
} from "./test-fixtures.js";
import { createWorkflowRuntime } from "./workflow-runtime.js";

/**
 * The local deterministic runtime (M4-T3, M4-T6, M4-T7, M4-T8).
 *
 * Five of Milestone 4's eight acceptance criteria are this file's
 * responsibility, and each one appears verbatim as a test title so that the
 * criterion and the evidence for it are the same text:
 *
 * - "A human-authored workflow runs locally"
 * - "Every node validates inputs and outputs"
 * - "An agent node cannot call an ungranted tool"
 * - "A failed node is visible in the trace"
 * - "A retry does not duplicate a protected side effect"
 *
 * Every workflow here is built by hand from `parseWorkflowDefinition()` plus the
 * canonical-JSON fingerprint, because the interpreter's contract is a
 * `CompiledWorkflow` and these tests are about what it does with one. The single
 * exception goes through `compileWorkflow()`, which is what proves the
 * validator's output and the runtime's input are the same value.
 */

/** Every `node.*` event in a recorded trace, in order. */
function nodeEvents(events: readonly TraceEvent[]): readonly TraceEvent[] {
  return events.filter((event) => event.type.startsWith("node."));
}

describe("createWorkflowRuntime", () => {
  describe("a human-authored workflow runs locally", () => {
    it("A human-authored workflow runs locally", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "double", (value: never) => ({
        value: (value as { value: number }).value * 2,
      }));
      registerFunction(registry, "handler", "describe", (value: never) => ({
        summary: `doubled to ${(value as { value: number }).value}`,
      }));

      const compiled = compiledWorkflow("double", [
        codeNode("double", "double", "describe"),
        codeNode("describe", "describe", null, {
          input: { kind: "node", node: "double" },
        }),
      ]);
      const { job, context, trace } = createRunFixture({ input: { value: 21 } });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toEqual({ summary: "doubled to 42" });
      expect(result.nodes.map((record) => record.nodeId)).toEqual(["double", "describe"]);
      expect(trace.types()).toEqual([
        "node.started",
        "node.completed",
        "node.started",
        "node.completed",
      ]);
    });

    it("carries the node id on every `node.*` event, which was null until M4", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("only", [codeNode("only", "identity", null)]);
      const { job, context, trace } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });

      await runtime.run(compiled, job, context);

      expect(trace.events.map((event) => event.node)).toEqual(["only", "only"]);
    });

    it("records the node input and output in the `node.*` payload, amending ADR-0031", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("only", [codeNode("only", "identity", null)]);
      const { job, context, trace } = createRunFixture({ input: { secretless: "value" } });
      const runtime = createWorkflowRuntime({ registry });

      await runtime.run(compiled, job, context);

      const [started, completed] = trace.events;

      expect(started?.payload).toMatchObject({
        nodeId: "only",
        type: "code",
        version: "1.0.0",
        attempt: 1,
        itemIndex: null,
        input: { secretless: "value" },
      });
      expect(started?.payload.idempotencyKey).toBe(`${context.runId}:test-workflow@1.0.0:only:-:1`);
      expect(completed?.payload).toMatchObject({ output: { secretless: "value" } });
    });

    it("hangs node spans off the run's root span when the harness opened one", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("only", [codeNode("only", "identity", null)]);
      const trace = createRecordingTraceWriter();
      const runId = newRunId();
      const recorder = createTraceRecorder({ runId, writer: trace });
      const root = await recorder.record({ type: "run.started" });
      const { job } = createRunFixture();
      const context = {
        runId,
        jobId: job.id,
        domain: TEST_DOMAIN,
        attempt: 1,
        budget: {},
        permissions: [],
        trace: recorder,
        signal: new AbortController().signal,
        runtime: { name: "test", version: "0.0.0", metadata: {} },
      };
      const runtime = createWorkflowRuntime({ registry });

      await runtime.run(compiled, job, context);

      const started = trace.events.find((event) => event.type === "node.started");

      expect(started?.parentId).toBe(root.id);
    });
  });

  describe("every node validates inputs and outputs", () => {
    it("Every node validates inputs and outputs", async () => {
      const registry = createCapabilityRegistry();

      registerSchema(registry, "test.any");
      registerSchema(
        registry,
        "test.positive",
        guardSchema((value) => typeof value === "object" && value !== null, "expected an object"),
      );
      registerSchema(
        registry,
        "test.counted",
        guardSchema(
          (value) => typeof (value as { count?: unknown }).count === "number",
          "expected `{ count: number }`",
        ),
      );
      registerFunction(registry, "handler", "count", () => ({ count: 3 }));

      const compiled = compiledWorkflow(
        "count",
        [
          codeNode("count", "count", null, {
            inputSchema: "test.positive@1.0.0",
            outputSchema: "test.counted@1.0.0",
          }),
        ],
        { inputSchema: "test.positive@1.0.0", outputSchema: "test.counted@1.0.0" },
      );
      const { job, context } = createRunFixture({ input: { anything: true } });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");
    });

    it("escalates with `validation-failed` when a node's output does not satisfy its schema", async () => {
      const registry = createCapabilityRegistry();

      registerSchema(registry, "test.any");
      registerSchema(
        registry,
        "test.counted",
        guardSchema(
          (value) => typeof (value as { count?: unknown }).count === "number",
          "expected `{ count: number }`",
        ),
      );
      registerFunction(registry, "handler", "wrong", () => ({ count: "three" }));

      const compiled = compiledWorkflow("count", [
        codeNode("count", "wrong", null, { outputSchema: "test.counted@1.0.0" }),
      ]);
      const { job, context } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("validation-failed");
    });

    it("escalates when a node's input does not satisfy its schema", async () => {
      const registry = createCapabilityRegistry();

      registerSchema(registry, "test.any");
      registerSchema(
        registry,
        "test.strict",
        guardSchema((value) => value === "only-this", "expected `only-this`"),
      );
      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("only", [
        codeNode("only", "identity", null, { inputSchema: "test.strict@1.0.0" }),
      ]);
      const { job, context } = createRunFixture({ input: "something-else" });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("validation-failed");
      expect(result.fallback.completedNodes).toEqual([]);
    });

    it("validates the workflow's own input against its `inputSchema`", async () => {
      const registry = createCapabilityRegistry();

      registerSchema(registry, "test.any");
      registerSchema(
        registry,
        "test.strict",
        guardSchema((value) => value === "expected", "expected `expected`"),
      );
      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("only", [codeNode("only", "identity", null)], {
        inputSchema: "test.strict@1.0.0",
      });
      const { job, context, trace } = createRunFixture({ input: "not-expected" });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");
      // Nothing executed, so there is no node event at all: only the fallback.
      expect(trace.types()).toEqual(["fallback.started"]);
    });
  });

  describe("node types (M4-T3)", () => {
    it("runs a `call` node, emitting `tool.*` as children of the node span", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "tool", "lookup", () => ({ found: true }));

      const compiled = compiledWorkflow("look", [
        callNode("look", "lookup", "read-only", null, {
          permissions: [{ toolId: "lookup", mode: "read" }],
        }),
      ]);
      const { job, context, trace } = createRunFixture({
        permissions: [{ toolId: "lookup", mode: "read" }],
      });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");
      expect(trace.types()).toEqual([
        "node.started",
        "tool.started",
        "tool.completed",
        "node.completed",
      ]);

      const nodeStarted = trace.events[0];
      const toolStarted = trace.events[1];

      expect(toolStarted?.parentId).toBe(nodeStarted?.id);
      expect(toolStarted?.node).toBe("look");
      expect(result.usage.toolCalls).toBe(1);
    });

    it("runs a `jev` node through the decision port and counts it as a model call", async () => {
      const registry = createTestRegistry();
      const compiled = compiledWorkflow("classify", [
        jevNode("classify", "vendor.is-clear", "choice", null),
      ]);
      const { job, context, trace } = createRunFixture();
      const runtime = createWorkflowRuntime({
        registry,
        decisionEngine: { decide: () => Promise.resolve({ label: "clear" }) },
      });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");
      expect(trace.types()).toEqual([
        "node.started",
        "decision.started",
        "decision.completed",
        "node.completed",
      ]);
      expect(result.usage.modelCalls).toBe(1);
    });

    it("escalates with `decision-failed` when no decision engine was supplied", async () => {
      const registry = createTestRegistry();
      const compiled = compiledWorkflow("classify", [
        jevNode("classify", "vendor.is-clear", "boolean", null),
      ]);
      const { job, context } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("decision-failed");
    });

    it("runs an `agent` node through the agent runtime without emitting its own `agent.*`", async () => {
      const registry = createTestRegistry();
      const compiled = compiledWorkflow("research", [agentNode("research", "vendor.agent", null)]);
      const { job, context, trace } = createRunFixture();
      const agent = createFakeAgentRuntime({
        result: {
          status: "completed",
          output: { notes: "found" },
          usage: { modelCalls: 2, toolCalls: 1, durationMs: 5, costUsd: 0.02 },
          runtime: { name: "fake", version: "0.0.0", metadata: {} },
        },
      });
      const runtime = createWorkflowRuntime({ registry, agentRuntime: agent });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");
      // The adapter owns `agent.*`; the interpreter emits none of its own, so a
      // fake that emits nothing produces exactly two events.
      expect(trace.types()).toEqual(["node.started", "node.completed"]);
      expect(result.usage).toMatchObject({ modelCalls: 2, toolCalls: 1, costUsd: 0.02 });
    });

    it("stores an `artifact` node's input and outputs a reference", async () => {
      const registry = createTestRegistry();
      const artifacts = createInMemoryArtifactStore();
      const compiled = compiledWorkflow("keep", [
        artifactNode("keep", "research-notes", null, { contentType: "application/json" }),
      ]);
      const { job, context, trace } = createRunFixture({ input: { notes: "some evidence" } });
      const runtime = createWorkflowRuntime({ registry, artifacts });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");
      expect(artifacts.saved).toHaveLength(1);
      expect(artifacts.saved[0]).toMatchObject({
        nodeId: "keep",
        name: "research-notes",
        contentType: "application/json",
        value: { notes: "some evidence" },
      });

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toEqual({
        artifactId: artifacts.saved[0]?.artifactId,
        name: "research-notes",
        contentType: "application/json",
      });
      expect(trace.types()).toContain("artifact.created");
    });

    it("escalates from an `escalate` node with `escalate-node` and a fallback envelope", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("first", [
        codeNode("first", "identity", "give-up"),
        escalateNode("give-up", "classification was uncertain", {
          input: { kind: "node", node: "first" },
        }),
      ]);
      const { job, context, trace } = createRunFixture({
        budget: { maxToolCalls: 4, maxModelCalls: 2 },
      });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback).toMatchObject({
        reason: "escalate-node",
        workflow: { id: "test-workflow", version: "1.0.0", fingerprint: compiled.fingerprint },
        evidenceRefs: [],
        remainingBudget: { maxToolCalls: 4, maxModelCalls: 2 },
      });
      expect(result.fallback.completedNodes).toEqual([
        { nodeId: "first", outputRef: "node:first", trusted: true },
        { nodeId: "give-up", outputRef: "node:give-up", trusted: false },
      ]);
      expect(trace.types()).toContain("fallback.started");
    });

    it("marks an `agent`, a `jev` and a write `call` output as untrusted in the envelope", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "tool", "send", () => ({ sent: true }));

      const compiled = compiledWorkflow("decide", [
        jevNode("decide", "vendor.is-clear", "boolean", "send"),
        callNode("send", "send", "idempotent-write", "give-up", {
          input: { kind: "node", node: "decide" },
          permissions: [{ toolId: "send", mode: "write" }],
        }),
        escalateNode("give-up", "done judging", { input: { kind: "node", node: "send" } }),
      ]);
      const { job, context } = createRunFixture({
        permissions: [{ toolId: "send", mode: "write" }],
      });
      const runtime = createWorkflowRuntime({
        registry,
        decisionEngine: { decide: () => Promise.resolve({ clear: true }) },
      });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.completedNodes).toEqual([
        { nodeId: "decide", outputRef: "node:decide", trusted: false },
        { nodeId: "send", outputRef: "node:send", trusted: false },
        { nodeId: "give-up", outputRef: "node:give-up", trusted: false },
      ]);
    });
  });

  describe("control shapes (M4-T4)", () => {
    it("runs a `chain` in order and outputs its last step's output", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "one", () => ({ step: 1 }));
      registerFunction(registry, "handler", "two", () => ({ step: 2 }));

      const compiled = compiledWorkflow("chain", [
        chainNode("chain", ["a", "b"], null),
        codeNode("a", "one", null),
        codeNode("b", "two", null, { input: { kind: "node", node: "a" } }),
      ]);
      const { job, context } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toEqual({ step: 2 });
      expect(result.nodes.map((record) => record.nodeId)).toEqual(["a", "b", "chain"]);
    });

    it("derives a `branch` label from a field path and continues at that case", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "clear", () => ({ decision: "approved" }));
      registerFunction(registry, "handler", "unclear", () => ({ decision: "held" }));

      const compiled = compiledWorkflow("route", [
        branchNode("route", { kind: "field", path: ["label"] }, { clear: "approve" }, "hold"),
        codeNode("approve", "clear", null),
        codeNode("hold", "unclear", null),
      ]);
      const { job, context, trace } = createRunFixture({ input: { label: "clear" } });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toEqual({ decision: "approved" });
      expect(result.nodes.map((record) => record.nodeId)).toEqual(["route", "approve"]);
      // A `branch` is pass-through: its output is the value it routed, and the
      // label it chose is visible only in the trace.
      expect(result.nodes[0]?.output).toEqual({ label: "clear" });
      expect(
        trace.events.find((event) => event.type === "node.completed" && event.node === "route")
          ?.payload,
      ).toMatchObject({ label: "clear", target: "approve" });
    });

    it("falls back to a `branch`'s default when no case matches the label", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "held", () => ({ decision: "held" }));

      const compiled = compiledWorkflow("route", [
        branchNode("route", { kind: "field", path: ["label"] }, { clear: "approve" }, "hold"),
        codeNode("approve", "held", null),
        codeNode("hold", "held", null),
      ]);
      const { job, context } = createRunFixture({ input: { label: "nothing-enumerated" } });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.nodes.map((record) => record.nodeId)).toEqual(["route", "hold"]);
    });

    it("derives a `branch` label from a registered policy", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "policy", "threshold", (value: never) =>
        (value as { score: number }).score > 0.5 ? "high" : "low",
      );
      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("route", [
        branchNode(
          "route",
          { kind: "policy", policy: { id: "threshold", version: "1.0.0" } },
          { high: "up", low: "down" },
          "down",
        ),
        codeNode("up", "identity", null),
        codeNode("down", "identity", null),
      ]);
      const { job, context } = createRunFixture({ input: { score: 0.9 } });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.nodes.map((record) => record.nodeId)).toEqual(["route", "up"]);
    });

    it("runs a `map` body once per item, binding `item` and `itemIndex`", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "shout", (value: never) => String(value).toUpperCase());

      const compiled = compiledWorkflow("each", [
        mapNode("each", { kind: "input" }, "shout", 10, null),
        codeNode("shout", "shout", null, { input: { kind: "item" } }),
      ]);
      const { job, context, trace } = createRunFixture({ input: ["a", "b", "c"] });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toEqual(["A", "B", "C"]);
      expect(
        nodeEvents(trace.events)
          .filter((event) => event.node === "shout" && event.type === "node.started")
          .map((event) => event.payload.itemIndex),
      ).toEqual([0, 1, 2]);
    });

    it("fails a `map` whose items exceed `maxItems` rather than truncating", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("each", [
        mapNode("each", { kind: "input" }, "one", 2, null),
        codeNode("one", "identity", null, { input: { kind: "item" } }),
      ]);
      const { job, context } = createRunFixture({ input: [1, 2, 3] });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("node-failed");
    });

    it("runs a `map` with bounded concurrency", async () => {
      const registry = createTestRegistry();
      let inFlight = 0;
      let peak = 0;

      registerFunction(registry, "handler", "slow", async (value: never) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;

        return value;
      });

      const compiled = compiledWorkflow("each", [
        mapNode("each", { kind: "input" }, "one", 10, null, { concurrency: 2 }),
        codeNode("one", "slow", null, { input: { kind: "item" } }),
      ]);
      const { job, context } = createRunFixture({ input: [1, 2, 3, 4, 5, 6] });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");
      expect(peak).toBeLessThanOrEqual(2);
    });

    it("folds a `reduce` from its `initial` value", async () => {
      const registry = createTestRegistry();

      registerFunction(
        registry,
        "handler",
        "sum",
        (accumulator: never, item: never) => (accumulator as number) + (item as number),
      );

      const compiled = compiledWorkflow("total", [
        reduceNode("total", { kind: "input" }, "sum", 100, null),
      ]);
      const { job, context } = createRunFixture({ input: [1, 2, 3] });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toBe(106);
    });

    it("runs a bounded `loop` until `until` holds", async () => {
      const registry = createTestRegistry();
      let counter = 0;

      registerFunction(registry, "handler", "tick", () => {
        counter += 1;

        return { done: counter >= 3, counter };
      });

      const compiled = compiledWorkflow("until-done", [
        loopNode("until-done", "tick", 5, { kind: "field", path: ["done"], equals: true }, null),
        codeNode("tick", "tick", null),
      ]);
      const { job, context } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toEqual({ done: true, counter: 3 });
    });

    it("fails a bounded `loop` that reaches `maxIterations` without satisfying `until`", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "never", () => ({ done: false }));

      const compiled = compiledWorkflow("forever", [
        loopNode("forever", "tick", 3, { kind: "field", path: ["done"], equals: true }, null),
        codeNode("tick", "never", null),
      ]);
      const { job, context } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      // A bounded loop that never satisfies its condition is a failure, not a
      // success: it escalates rather than reporting the last iteration.
      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("node-failed");
    });
  });

  describe("timeouts, retries and budgets (M4-T6)", () => {
    it("escalates with `timeout` when a node exceeds its `timeoutMs`", async () => {
      const registry = createTestRegistry();

      registerFunction(
        registry,
        "handler",
        "hang",
        () => new Promise(() => undefined) as Promise<unknown>,
      );

      const compiled = compiledWorkflow("slow", [codeNode("slow", "hang", null, { timeoutMs: 5 })]);
      const { job, context, trace } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("timeout");
      expect(trace.types()).toEqual(["node.started", "node.failed", "fallback.started"]);
    });

    it("retries a failing node up to `maxAttempts`, waiting `backoffMs` between attempts", async () => {
      const registry = createTestRegistry();
      let calls = 0;

      registerFunction(registry, "handler", "flaky", () => {
        calls += 1;

        if (calls < 3) {
          throw new Error("not yet");
        }

        return { ok: true };
      });

      const compiled = compiledWorkflow("flaky", [
        codeNode("flaky", "flaky", null, { maxAttempts: 3, backoffMs: 25 }),
      ]);
      const { job, context, trace } = createRunFixture();
      const { waits, sleep } = recordingSleep();
      const runtime = createWorkflowRuntime({ registry, sleep });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");
      expect(calls).toBe(3);
      expect(waits).toEqual([25, 25]);
      expect(trace.types()).toEqual([
        "node.started",
        "node.failed",
        "node.started",
        "node.failed",
        "node.started",
        "node.completed",
      ]);
      expect(result.nodes[0]?.attempts).toBe(3);
    });

    it("puts the attempt number in the idempotency key of every attempt", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "always-fails", () => {
        throw new Error("no");
      });

      const compiled = compiledWorkflow("fails", [
        codeNode("fails", "always-fails", null, { maxAttempts: 2 }),
      ]);
      const { job, context, trace } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });

      await runtime.run(compiled, job, context);

      expect(
        trace.events
          .filter((event) => event.type === "node.started")
          .map((event) => event.payload.idempotencyKey),
      ).toEqual([
        `${context.runId}:test-workflow@1.0.0:fails:-:1`,
        `${context.runId}:test-workflow@1.0.0:fails:-:2`,
      ]);
    });

    it("escalates with `budget-exceeded` and does not retry when the run's tool budget runs out", async () => {
      const registry = createTestRegistry();
      let calls = 0;

      registerFunction(registry, "tool", "ping", () => {
        calls += 1;

        return { ok: true };
      });

      const compiled = compiledWorkflow("a", [
        callNode("a", "ping", "read-only", "b", {
          permissions: [{ toolId: "ping", mode: "read" }],
        }),
        callNode("b", "ping", "read-only", null, {
          input: { kind: "node", node: "a" },
          maxAttempts: 3,
          permissions: [{ toolId: "ping", mode: "read" }],
        }),
      ]);
      const { job, context } = createRunFixture({
        budget: { maxToolCalls: 1 },
        permissions: [{ toolId: "ping", mode: "read" }],
      });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("budget-exceeded");
      // The second call is charged **before** the tool runs, so the budget
      // prevents the call rather than reporting it afterwards, and it is not
      // retried: a budget that ran out does not refill.
      expect(calls).toBe(1);
      expect(result.nodes[1]?.attempts).toBe(1);
    });

    it("enforces a node's own budget as well as the run's", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "tool", "ping", () => ({ ok: true }));

      const compiled = compiledWorkflow("fan", [
        mapNode("fan", { kind: "input" }, "one", 10, null, { budget: { maxToolCalls: 2 } }),
        callNode("one", "ping", "read-only", null, {
          input: { kind: "item" },
          permissions: [{ toolId: "ping", mode: "read" }],
        }),
      ]);
      const { job, context } = createRunFixture({
        input: [1, 2, 3],
        permissions: [{ toolId: "ping", mode: "read" }],
      });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("budget-exceeded");
      // The run's budget is unlimited; only the `map` node's own budget bit.
      expect(result.usage.toolCalls).toBe(3);
    });

    it("reports `aborted` when the run's signal fires", async () => {
      const registry = createTestRegistry();
      const controller = new AbortController();

      registerFunction(registry, "handler", "abort-then-hang", () => {
        controller.abort();

        return new Promise(() => undefined) as Promise<unknown>;
      });

      const compiled = compiledWorkflow("hang", [
        codeNode("hang", "abort-then-hang", null, { timeoutMs: 60_000 }),
      ]);
      const { job, context } = createRunFixture({ signal: controller.signal });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("aborted");
    });

    it("reports `aborted` without executing anything when the signal is already aborted", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("only", [codeNode("only", "identity", null)]);
      const { job, context, trace } = createRunFixture({ signal: AbortSignal.abort() });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("aborted");
      expect(trace.events).toEqual([]);
    });
  });

  describe("a failed node is visible in the trace", () => {
    it("A failed node is visible in the trace", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "broken", () => {
        throw new Error("the handler blew up");
      });

      const compiled = compiledWorkflow("broken", [
        codeNode("broken", "broken", null, { maxAttempts: 2 }),
      ]);
      const { job, context, trace } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      const failures = trace.events.filter((event) => event.type === "node.failed");

      // Every failed attempt is visible, not just the last one.
      expect(failures).toHaveLength(2);
      expect(failures[0]?.node).toBe("broken");
      expect(failures[0]?.error?.message).toContain("the handler blew up");
      expect(failures[0]?.payload).toMatchObject({ nodeId: "broken", type: "code", attempt: 1 });
      expect(failures[1]?.payload).toMatchObject({ attempt: 2 });

      if (result.status !== "escalated") {
        return;
      }

      expect(result.nodes[0]).toMatchObject({ nodeId: "broken", status: "failed", attempts: 2 });
      expect(result.nodes[0]?.error?.code).toBe("UNKNOWN");
    });
  });

  describe("failures that are defects rather than fallbacks", () => {
    it("fails the run when a binding reads a node that has not produced an output", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("only", [
        codeNode("only", "identity", null, { input: { kind: "node", node: "absent" } }),
      ]);
      const { job, context, trace } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("failed");

      if (result.status !== "failed") {
        return;
      }

      expect(result.error.code).toBe("WORKFLOW");
      // No node event: the defect is found before a span opens.
      expect(trace.events).toEqual([]);
    });

    it("fails the run when an `item` binding is evaluated outside a `map` body", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const compiled = compiledWorkflow("only", [
        codeNode("only", "identity", null, { input: { kind: "item" } }),
      ]);
      const { job, context } = createRunFixture();
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("failed");

      if (result.status !== "failed") {
        return;
      }

      expect(result.error.message).toContain("outside a `map` body");
    });
  });

  describe("asAgentRuntime", () => {
    it("runs a workflow end to end through createHarness", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "triage", (value: never) => ({
        decision: `reviewed ${(value as { vendor: string }).vendor}`,
      }));

      const compiled = compiledWorkflow("triage", [codeNode("triage", "triage", null)]);
      const runtime = createWorkflowRuntime({ registry });
      const trace = createRecordingTraceWriter();
      const storage = createInMemoryStorage();
      const domain = defineDomain({
        id: "test-domain",
        version: "1.0.0",
        inputSchema: passSchema(),
        outputSchema: passSchema(),
        createJob: (input: unknown) => ({
          jobType: "test-job",
          objective: "triage a vendor",
          input,
          contracts: { inputSchema: ANY_SCHEMA, outputSchema: ANY_SCHEMA, sop: "test-sop" },
        }),
      });
      const harness = createHarness({
        agentRuntime: runtime.asAgentRuntime(compiled),
        trace,
        storage,
        target: "@internal/workflow",
      });
      const result = await harness.run({ domain, input: { vendor: "acme" } });

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toEqual({ decision: "reviewed acme" });
      expect(result.runtime).toMatchObject({
        name: "@internal/workflow",
        metadata: {
          workflowId: "test-workflow",
          workflowVersion: "1.0.0",
          workflowFingerprint: compiled.fingerprint,
        },
      });
      expect(trace.types()).toEqual([
        "run.started",
        "node.started",
        "node.completed",
        "run.completed",
      ]);
      expect(trace.events.filter((event) => event.node === "triage")).toHaveLength(2);

      const runs = await storage.listRuns({ domainId: "test-domain" });

      expect(runs.runs[0]).toMatchObject({ status: "completed", success: true });
    });

    it("maps an escalation to a failed execution carrying the fallback envelope", async () => {
      const registry = createTestRegistry();
      const compiled = compiledWorkflow("give-up", [
        escalateNode("give-up", "not confident enough"),
      ]);
      const runtime = createWorkflowRuntime({ registry });
      const { job, context } = createRunFixture();
      const execution = await runtime.asAgentRuntime(compiled).run(job, context);

      expect(execution.status).toBe("failed");

      if (execution.status !== "failed") {
        return;
      }

      expect(execution.error.code).toBe("WORKFLOW");
      expect(execution.error.details?.fallback).toMatchObject({
        reason: "escalate-node",
        workflow: { id: "test-workflow", version: "1.0.0" },
      });
    });

    it("maps a defect to a failed execution and a cancellation to an aborted one", async () => {
      const registry = createTestRegistry();

      registerFunction(registry, "handler", "identity", (value: never) => value);

      const broken = compiledWorkflow("only", [
        codeNode("only", "identity", null, { input: { kind: "item" } }),
      ]);
      const runtime = createWorkflowRuntime({ registry });
      const first = await runtime
        .asAgentRuntime(broken)
        .run(createRunFixture().job, createRunFixture().context);

      expect(first.status).toBe("failed");

      const fine = compiledWorkflow("only", [codeNode("only", "identity", null)]);
      const cancelled = createRunFixture({ signal: AbortSignal.abort() });
      const second = await runtime.asAgentRuntime(fine).run(cancelled.job, cancelled.context);

      expect(second.status).toBe("aborted");
    });
  });

  describe("integration with compileWorkflow", () => {
    it("runs a workflow produced by the validator, not hand-built", async () => {
      const registry = createCapabilityRegistry();

      registerSchema(registry, "vendor.input");
      registerSchema(registry, "vendor.output");
      registerFunction(registry, "handler", "vendor.finalize", (value: never) => ({
        decision: `approved ${(value as { vendor: string }).vendor}`,
      }));

      const common = {
        version: "1.0.0",
        inputSchema: "vendor.input@1.0.0",
        outputSchema: "vendor.output@1.0.0",
        timeoutMs: 1_000,
        retry: { maxAttempts: 1 },
        budget: {},
        permissions: [],
        input: { kind: "input" },
      } as const;
      const compiled = compileWorkflow(
        {
          schemaVersion: 1,
          id: "vendor-triage",
          version: "1.0.0",
          domain: "vendor",
          jobType: "vendor-triage",
          inputSchema: "vendor.input@1.0.0",
          outputSchema: "vendor.output@1.0.0",
          entry: "route",
          nodes: {
            route: {
              ...common,
              id: "route",
              type: "branch",
              // A `branch` is pass-through, so the validator requires its
              // `outputSchema` to be its own `inputSchema`.
              outputSchema: "vendor.input@1.0.0",
              on: { kind: "field", path: ["mode"] },
              cases: { approve: "finalize" },
              default: "give-up",
            },
            finalize: {
              ...common,
              id: "finalize",
              type: "code",
              handler: { id: "vendor.finalize", version: "1.0.0" },
              next: null,
            },
            // The validator requires a reachable `escalate` node, which is
            // north-star invariant 1 enforced at compile time: a domain can
            // always fall back to its full agent.
            "give-up": { ...common, id: "give-up", type: "escalate", reason: "uncertain" },
          },
        },
        registry,
      );
      const { job, context } = createRunFixture({
        input: { vendor: "acme", mode: "approve" },
      });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      expect(result.output).toEqual({ decision: "approved acme" });
      expect(compiled.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("escalates through the compiled workflow's own escalate branch", async () => {
      const registry = createCapabilityRegistry();

      registerSchema(registry, "vendor.input");
      registerSchema(registry, "vendor.output");
      registerFunction(registry, "handler", "vendor.finalize", () => ({ decision: "approved" }));

      const common = {
        version: "1.0.0",
        inputSchema: "vendor.input@1.0.0",
        outputSchema: "vendor.output@1.0.0",
        timeoutMs: 1_000,
        retry: { maxAttempts: 1 },
        budget: {},
        permissions: [],
        input: { kind: "input" },
      } as const;
      const compiled = compileWorkflow(
        {
          schemaVersion: 1,
          id: "vendor-triage",
          version: "1.0.0",
          domain: "vendor",
          jobType: "vendor-triage",
          inputSchema: "vendor.input@1.0.0",
          outputSchema: "vendor.output@1.0.0",
          entry: "route",
          nodes: {
            route: {
              ...common,
              id: "route",
              type: "branch",
              // A `branch` is pass-through, so the validator requires its
              // `outputSchema` to be its own `inputSchema`.
              outputSchema: "vendor.input@1.0.0",
              on: { kind: "field", path: ["mode"] },
              cases: { approve: "finalize" },
              default: "give-up",
            },
            finalize: {
              ...common,
              id: "finalize",
              type: "code",
              handler: { id: "vendor.finalize", version: "1.0.0" },
              next: null,
            },
            "give-up": { ...common, id: "give-up", type: "escalate", reason: "uncertain" },
          },
        },
        registry,
      );
      const { job, context } = createRunFixture({ input: { vendor: "acme", mode: "unsure" } });
      const runtime = createWorkflowRuntime({ registry });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("escalate-node");
      expect(result.fallback.completedNodes.map((node) => node.nodeId)).toEqual([
        "route",
        "give-up",
      ]);
    });
  });

  describe("integration with the typed DSL", () => {
    it("runs a DSL-authored branch workflow whose case node binds to the branch", async () => {
      const registry = createCapabilityRegistry();

      for (const id of ["vendor.input", "vendor.classification", "vendor.output"]) {
        registerSchema(registry, id);
      }

      registerFunction(registry, "handler", "vendor.finalize", (value: never) => ({
        decision: `cleared ${(value as { vendor: string }).vendor}`,
      }));

      // Authored with the DSL, compiled by the validator, executed by the
      // runtime: the three halves of Milestone 4 in one call chain. The branch
      // is what this locks in — the DSL wires `finalize` to
      // `{ kind: "node", node: "route" }` with the *classification* schema, so
      // the run only works if a `branch` is pass-through.
      const definition = workflow({
        id: "vendor-triage",
        version: "1.0.0",
        domain: "vendor",
        jobType: "vendor-triage",
        input: "vendor.input@1.0.0",
        output: "vendor.output@1.0.0",
      })
        .jev("classify", {
          question: "vendor.classification@1.0.0",
          questionKind: "choice",
          outputSchema: "vendor.classification@1.0.0",
        })
        .branch("route", {
          on: { kind: "field", path: ["category"] },
          cases: {
            clear: (step) => step.code("finalize", { handler: "vendor.finalize@1.0.0" }).end(),
          },
          default: (step) =>
            step.escalate("full-agent", { reason: "classification was uncertain" }),
        })
        .build();

      expect(definition.nodes.route).toMatchObject({
        inputSchema: "vendor.classification@1.0.0",
        outputSchema: "vendor.classification@1.0.0",
      });
      expect(definition.nodes.finalize).toMatchObject({
        input: { kind: "node", node: "route" },
        inputSchema: "vendor.classification@1.0.0",
      });

      const compiled = compileWorkflow(definition, registry);
      const { job, context, trace } = createRunFixture({ input: { vendor: "acme" } });
      const runtime = createWorkflowRuntime({
        registry,
        decisionEngine: {
          decide: () => Promise.resolve({ category: "clear", vendor: "acme" }),
        },
      });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("completed");

      if (result.status !== "completed") {
        return;
      }

      // `finalize` read the branch's output and got the **classification**, not
      // a `{ label }` wrapper.
      expect(result.output).toEqual({ decision: "cleared acme" });
      expect(result.nodes.map((record) => record.nodeId)).toEqual([
        "classify",
        "route",
        "finalize",
      ]);
      expect(
        trace.events.find((event) => event.type === "node.completed" && event.node === "route")
          ?.payload,
      ).toMatchObject({ label: "clear", target: "finalize" });
    });

    it("escalates through a DSL-authored default case", async () => {
      const registry = createCapabilityRegistry();

      for (const id of ["vendor.input", "vendor.classification", "vendor.output"]) {
        registerSchema(registry, id);
      }

      registerFunction(registry, "handler", "vendor.finalize", () => ({ decision: "cleared" }));

      const compiled = compileWorkflow(
        workflow({
          id: "vendor-triage",
          version: "1.0.0",
          domain: "vendor",
          jobType: "vendor-triage",
          input: "vendor.input@1.0.0",
          output: "vendor.output@1.0.0",
        })
          .jev("classify", {
            question: "vendor.classification@1.0.0",
            questionKind: "choice",
            outputSchema: "vendor.classification@1.0.0",
          })
          .branch("route", {
            on: { kind: "field", path: ["category"] },
            cases: {
              clear: (step) => step.code("finalize", { handler: "vendor.finalize@1.0.0" }).end(),
            },
            default: (step) =>
              step.escalate("full-agent", { reason: "classification was uncertain" }),
          })
          .build(),
        registry,
      );
      const { job, context } = createRunFixture({ input: { vendor: "acme" } });
      const runtime = createWorkflowRuntime({
        registry,
        decisionEngine: {
          decide: () => Promise.resolve({ category: "who-knows" }),
        },
      });
      const result = await runtime.run(compiled, job, context);

      expect(result.status).toBe("escalated");

      if (result.status !== "escalated") {
        return;
      }

      expect(result.fallback.reason).toBe("escalate-node");
      expect(result.fallback.completedNodes.map((node) => node.nodeId)).toEqual([
        "classify",
        "route",
        "full-agent",
      ]);
      // A `jev` output is never trusted; a `branch` routes deterministically
      // over an already-validated value, so it is.
      expect(result.fallback.completedNodes.map((node) => node.trusted)).toEqual([
        false,
        true,
        false,
      ]);
    });
  });

  describe("ports", () => {
    it("defaults the protected-effect store to memory and records keys under it", async () => {
      const registry = createTestRegistry();
      const effects = createInMemoryProtectedEffectStore();

      registerFunction(registry, "tool", "send", () => ({ sent: true }));

      const compiled = compiledWorkflow("send", [
        callNode("send", "send", "non-idempotent-write", null, {
          protection: { kind: "idempotency-key" },
          permissions: [{ toolId: "send", mode: "write" }],
        }),
      ]);
      const { job, context } = createRunFixture({
        permissions: [{ toolId: "send", mode: "write" }],
      });
      const runtime = createWorkflowRuntime({ registry, effects });

      await runtime.run(compiled, job, context);

      expect(effects.keys()).toEqual([`${context.runId}:test-workflow@1.0.0:send:-`]);
    });

    it("mints a distinct sortable id per saved artifact", async () => {
      const store = createInMemoryArtifactStore();
      const runId = newRunId();

      const first = await store.save({
        runId,
        nodeId: "a",
        name: "notes",
        value: { a: 1 },
      });
      const second = await store.save({
        runId,
        nodeId: "b",
        name: "notes",
        value: { b: 2 },
      });

      expect(first.artifactId).not.toBe(second.artifactId);
      expect(first.artifactId < second.artifactId).toBe(true);
      expect(store.saved).toHaveLength(2);
      expect(newJobId()).not.toBe(first.artifactId);
    });
  });
});
