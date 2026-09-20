import type { ExecutionContext, Job } from "@internal/core";
import { PermissionDeniedError } from "@internal/core";
import { createFakeAgentRuntime } from "@internal/testing";
import { describe, expect, it } from "vitest";
import { assertGrantsWithinJob, assertToolGranted, requiredMode } from "./grants.js";
import {
  agentNode,
  callNode,
  codeNode,
  compiledWorkflow,
  createRunFixture,
  createTestRegistry,
  registerFunction,
} from "./test-fixtures.js";
import { createWorkflowRuntime } from "./workflow-runtime.js";

/**
 * Tool grants (M4-T8), including the Milestone 4 acceptance criterion "an agent
 * node cannot call an ungranted tool".
 *
 * The criterion has two halves and both are tested here, because the IR
 * expresses the rule as data and the runtime enforces it in two places:
 *
 * 1. an `agent` node's sub-run receives **only** the node's own grants, never
 *    the job's wider list, so the adapter that enforces permissions is told a
 *    narrower truth than the job carries;
 * 2. a `call` node for a tool its own grants do not cover is refused **before**
 *    the tool is resolved and before any `tool.started` event exists.
 */

describe("requiredMode", () => {
  it("maps a read-only call to `read` and either write to `write`", () => {
    expect(requiredMode("read-only")).toBe("read");
    expect(requiredMode("idempotent-write")).toBe("write");
    expect(requiredMode("non-idempotent-write")).toBe("write");
  });
});

describe("assertToolGranted", () => {
  it("accepts a matching grant and a write grant standing in for a read", () => {
    expect(() =>
      assertToolGranted("n", [{ toolId: "send", mode: "read" }], "send", "read"),
    ).not.toThrow();
    expect(() =>
      assertToolGranted("n", [{ toolId: "send", mode: "write" }], "send", "read"),
    ).not.toThrow();
  });

  it("refuses a write request backed only by a read grant", () => {
    expect(() =>
      assertToolGranted("n", [{ toolId: "send", mode: "read" }], "send", "write"),
    ).toThrow(PermissionDeniedError);
  });

  it("refuses a tool no grant names, because absence is denial", () => {
    expect(() => assertToolGranted("n", [], "send", "read")).toThrow(PermissionDeniedError);
  });
});

describe("assertGrantsWithinJob", () => {
  it("accepts a node whose grants the job already covers", () => {
    const node = callNode("send", "send", "idempotent-write", null, {
      permissions: [{ toolId: "send", mode: "write" }],
    });

    expect(() => assertGrantsWithinJob(node, [{ toolId: "send", mode: "write" }])).not.toThrow();
  });

  it("refuses a node that widens the job's mode", () => {
    const node = callNode("send", "send", "idempotent-write", null, {
      permissions: [{ toolId: "send", mode: "write" }],
    });

    expect(() => assertGrantsWithinJob(node, [{ toolId: "send", mode: "read" }])).toThrow(
      PermissionDeniedError,
    );
  });

  it("refuses a node that names a tool the job does not grant at all", () => {
    const node = agentNode("research", "vendor.agent", null, {
      permissions: [{ toolId: "search", mode: "read" }],
    });

    expect(() => assertGrantsWithinJob(node, [{ toolId: "lookup", mode: "read" }])).toThrow(
      PermissionDeniedError,
    );
  });

  it("treats an unnarrowed job grant as covering any node scope, and a narrowed one as exact", () => {
    const scoped = callNode("send", "send", "read-only", null, {
      permissions: [{ toolId: "send", mode: "read", scope: "acme" }],
    });

    expect(() => assertGrantsWithinJob(scoped, [{ toolId: "send", mode: "read" }])).not.toThrow();
    expect(() =>
      assertGrantsWithinJob(scoped, [{ toolId: "send", mode: "read", scope: "acme" }]),
    ).not.toThrow();
    expect(() =>
      assertGrantsWithinJob(scoped, [{ toolId: "send", mode: "read", scope: "other" }]),
    ).toThrow(PermissionDeniedError);
  });

  it("accepts a node with no grants at all, whatever the job grants", () => {
    const node = codeNode("pure", "identity", null);

    expect(() => assertGrantsWithinJob(node, [])).not.toThrow();
  });
});

describe("an agent node cannot call an ungranted tool", () => {
  it("An agent node cannot call an ungranted tool", async () => {
    const registry = createTestRegistry();
    let seen: ExecutionContext | undefined;
    let seenJob: Job | undefined;

    const agent = createFakeAgentRuntime({
      handler: (job, context) => {
        seen = context;
        seenJob = job;

        return {
          status: "completed",
          output: { notes: "done" },
          usage: { modelCalls: 1, toolCalls: 0, durationMs: 1 },
          runtime: { name: "fake", version: "0.0.0", metadata: {} },
        };
      },
    });
    const compiled = compiledWorkflow("research", [
      agentNode("research", "vendor.agent", null, {
        // The node grants exactly one of the job's two tools.
        permissions: [{ toolId: "search", mode: "read" }],
      }),
    ]);
    const { job, context } = createRunFixture({
      permissions: [
        { toolId: "search", mode: "read" },
        { toolId: "wire-transfer", mode: "write" },
      ],
    });
    const runtime = createWorkflowRuntime({ registry, agentRuntime: agent });
    const result = await runtime.run(compiled, job, context);

    expect(result.status).toBe("completed");
    // The sub-run is told only what the node granted. `wire-transfer` is in the
    // job's list and not in the agent's, so the adapter that enforces
    // permissions has no grant to find for it.
    expect(seen?.permissions).toEqual([{ toolId: "search", mode: "read" }]);
    expect(seenJob?.permissions).toEqual([{ toolId: "search", mode: "read" }]);
  });

  it("refuses a `call` node for a tool its own grants do not cover, with no `tool.started`", async () => {
    const registry = createTestRegistry();
    let called = 0;

    registerFunction(registry, "tool", "wire-transfer", () => {
      called += 1;

      return { sent: true };
    });

    const compiled = compiledWorkflow("pay", [
      // The job grants `wire-transfer`; the node does not grant it to itself.
      callNode("pay", "wire-transfer", "idempotent-write", null, { permissions: [] }),
    ]);
    const { job, context, trace } = createRunFixture({
      permissions: [{ toolId: "wire-transfer", mode: "write" }],
    });
    const runtime = createWorkflowRuntime({ registry });
    const result = await runtime.run(compiled, job, context);

    expect(result.status).toBe("escalated");
    expect(called).toBe(0);
    expect(trace.types()).not.toContain("tool.started");
    expect(trace.types()).toEqual(["node.started", "node.failed", "fallback.started"]);

    const failure = trace.events.find((event) => event.type === "node.failed");

    expect(failure?.error?.code).toBe("PERMISSION_DENIED");
  });

  it("does not retry a permission denial, because asking again does not grant it", async () => {
    const registry = createTestRegistry();

    registerFunction(registry, "tool", "wire-transfer", () => ({ sent: true }));

    const compiled = compiledWorkflow("pay", [
      callNode("pay", "wire-transfer", "idempotent-write", null, {
        permissions: [],
        maxAttempts: 5,
      }),
    ]);
    const { job, context, trace } = createRunFixture({
      permissions: [{ toolId: "wire-transfer", mode: "write" }],
    });
    const runtime = createWorkflowRuntime({ registry });
    const result = await runtime.run(compiled, job, context);

    expect(result.status).toBe("escalated");
    expect(trace.types().filter((type) => type === "node.started")).toHaveLength(1);

    if (result.status !== "escalated") {
      return;
    }

    expect(result.nodes[0]?.attempts).toBe(1);
  });

  it("refuses a node whose grants exceed the job's before the node runs at all", async () => {
    const registry = createTestRegistry();

    registerFunction(registry, "tool", "send", () => ({ sent: true }));

    const compiled = compiledWorkflow("send", [
      callNode("send", "send", "idempotent-write", null, {
        permissions: [{ toolId: "send", mode: "write" }],
      }),
    ]);
    // The job grants only `read`, so the node's `write` grant is a widening.
    const { job, context, trace } = createRunFixture({
      permissions: [{ toolId: "send", mode: "read" }],
    });
    const runtime = createWorkflowRuntime({ registry });
    const result = await runtime.run(compiled, job, context);

    expect(result.status).toBe("failed");
    // Refused before any attempt opens a span: there is no node event at all.
    expect(trace.events).toEqual([]);

    if (result.status !== "failed") {
      return;
    }

    expect(result.error.code).toBe("PERMISSION_DENIED");
  });

  it("gives a `code` node its input and nothing else", async () => {
    const registry = createTestRegistry();
    let argumentCount = -1;

    registerFunction(registry, "handler", "count-args", (...args: never[]) => {
      argumentCount = args.length;

      return { ok: true };
    });

    const compiled = compiledWorkflow("pure", [codeNode("pure", "count-args", null)]);
    const { job, context } = createRunFixture({
      permissions: [{ toolId: "send", mode: "write" }],
    });
    const runtime = createWorkflowRuntime({ registry });

    await runtime.run(compiled, job, context);

    // M4-T8: "a `code` node does not inherit agent tools". It receives one
    // argument, its validated input, and has nothing to reach through.
    expect(argumentCount).toBe(1);
  });
});
