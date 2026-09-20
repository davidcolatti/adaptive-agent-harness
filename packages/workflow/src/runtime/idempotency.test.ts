import { parseWorkflowDefinition } from "@internal/core";
import { describe, expect, it } from "vitest";
import {
  attemptIdempotencyKey,
  type IdempotencyCoordinates,
  NO_ITEM_INDEX,
  protectionIdempotencyKey,
} from "./idempotency.js";
import { createInMemoryProtectedEffectStore } from "./ports.js";
import {
  ANY_SCHEMA,
  callNode,
  codeNode,
  compiledWorkflow,
  createRunFixture,
  createTestRegistry,
  guardSchema,
  mapNode,
  registerFunction,
  registerSchema,
} from "./test-fixtures.js";
import { createWorkflowRuntime } from "./workflow-runtime.js";

/**
 * Idempotency (M4-T7): the two keys, and the Milestone 4 acceptance criterion
 * "a retry does not duplicate a protected side effect in tests".
 *
 * The criterion is only meaningful if the first attempt actually reaches the
 * world before it fails, so the protected test is written that way: the tool
 * records "sent" and returns a value the node's `outputSchema` rejects. Attempt
 * 1 therefore changes the world and then fails; attempt 2 finds the recorded
 * effect and does not call the tool again. A test where the tool threw before
 * doing anything would pass whether or not protection worked.
 */

const COORDINATES: IdempotencyCoordinates = {
  runId: "0192f1a0-0000-7000-8000-000000000001" as IdempotencyCoordinates["runId"],
  workflow: parseWorkflowDefinition({
    schemaVersion: 1,
    id: "vendor-triage",
    version: "2.3.4",
    domain: "vendor",
    jobType: "vendor-triage",
    inputSchema: ANY_SCHEMA,
    outputSchema: ANY_SCHEMA,
    entry: "only",
    nodes: {
      only: {
        id: "only",
        type: "code",
        version: "1.0.0",
        inputSchema: ANY_SCHEMA,
        outputSchema: ANY_SCHEMA,
        timeoutMs: 1_000,
        retry: { maxAttempts: 1 },
        budget: {},
        permissions: [],
        input: { kind: "input" },
        handler: { id: "identity", version: "1.0.0" },
        next: null,
      },
    },
  }),
  nodeId: "only",
  itemIndex: null,
};

describe("the two idempotency keys", () => {
  it("renders the build plan's formula, with `-` where there is no enclosing map", () => {
    expect(attemptIdempotencyKey(COORDINATES, 3)).toBe(
      `${COORDINATES.runId}:vendor-triage@2.3.4:only:${NO_ITEM_INDEX}:3`,
    );
  });

  it("renders the item index when the execution is inside a map body", () => {
    expect(attemptIdempotencyKey({ ...COORDINATES, itemIndex: 7 }, 1)).toBe(
      `${COORDINATES.runId}:vendor-triage@2.3.4:only:7:1`,
    );
  });

  it("makes the protection key the attempt key's prefix, without the attempt", () => {
    const protection = protectionIdempotencyKey(COORDINATES);

    expect(protection).toBe(`${COORDINATES.runId}:vendor-triage@2.3.4:only:-`);
    expect(attemptIdempotencyKey(COORDINATES, 2)).toBe(`${protection}:2`);
  });

  it("keeps the protection key stable across attempts, which is the whole point", () => {
    const first = attemptIdempotencyKey(COORDINATES, 1);
    const second = attemptIdempotencyKey(COORDINATES, 2);

    expect(first).not.toBe(second);
    expect(protectionIdempotencyKey(COORDINATES)).toBe(
      protectionIdempotencyKey({ ...COORDINATES }),
    );
  });

  it("parses back unambiguously, because no component may contain a colon", () => {
    const key = attemptIdempotencyKey(COORDINATES, 4);
    const parts = key.split(":");

    expect(parts).toHaveLength(5);
    expect(parts[1]).toBe("vendor-triage@2.3.4");
    expect(parts[2]).toBe("only");
    expect(parts[4]).toBe("4");
  });
});

describe("a retry does not duplicate a protected side effect", () => {
  it("A retry does not duplicate a protected side effect", async () => {
    const registry = createTestRegistry();
    const sent: string[] = [];

    registerSchema(
      registry,
      "test.receipt",
      // The tool returns `{ ok: true }`, which this rejects: the *call*
      // succeeds and the node then fails on its output contract, so attempt 1
      // has already changed the world when attempt 2 starts.
      guardSchema(
        (value) => typeof (value as { receiptId?: unknown }).receiptId === "string",
        "expected `{ receiptId: string }`",
      ),
    );
    registerFunction(registry, "tool", "send-invoice", (value: never) => {
      sent.push((value as { vendor: string }).vendor);

      return { ok: true };
    });

    const compiled = compiledWorkflow("send", [
      callNode("send", "send-invoice", "non-idempotent-write", null, {
        protection: { kind: "idempotency-key" },
        permissions: [{ toolId: "send-invoice", mode: "write" }],
        outputSchema: "test.receipt@1.0.0",
        maxAttempts: 2,
      }),
    ]);
    const { job, context, trace } = createRunFixture({
      input: { vendor: "acme" },
      permissions: [{ toolId: "send-invoice", mode: "write" }],
    });
    const runtime = createWorkflowRuntime({ registry });
    const result = await runtime.run(compiled, job, context);

    // Both attempts failed, so the run escalates; the point is what happened to
    // the world in between.
    expect(result.status).toBe("escalated");
    expect(sent).toEqual(["acme"]);
    expect(result.usage.toolCalls).toBe(1);

    const toolStarts = trace.events.filter((event) => event.type === "tool.started");

    expect(toolStarts).toHaveLength(2);
    expect(toolStarts[0]?.payload.replayed).toBeUndefined();
    // The second attempt's span says the effect was replayed rather than made.
    expect(toolStarts[1]?.payload.replayed).toBe(true);
    expect(toolStarts[1]?.payload.idempotencyKey).toBe(
      `${context.runId}:test-workflow@1.0.0:send:-`,
    );
  });

  it("re-executes an unprotected read-only call on retry", async () => {
    const registry = createTestRegistry();
    let calls = 0;

    registerFunction(registry, "tool", "lookup", () => {
      calls += 1;

      if (calls === 1) {
        throw new Error("transient");
      }

      return { found: true };
    });

    const compiled = compiledWorkflow("look", [
      callNode("look", "lookup", "read-only", null, {
        permissions: [{ toolId: "lookup", mode: "read" }],
        maxAttempts: 2,
      }),
    ]);
    const { job, context } = createRunFixture({
      permissions: [{ toolId: "lookup", mode: "read" }],
    });
    const runtime = createWorkflowRuntime({ registry });
    const result = await runtime.run(compiled, job, context);

    expect(result.status).toBe("completed");
    // A read-only call may be repeated freely: it observed the world and
    // changed nothing, so retrying it is exactly what retries are for.
    expect(calls).toBe(2);
    expect(result.usage.toolCalls).toBe(2);
  });

  it("returns the recorded result rather than calling again, and validates it the same way", async () => {
    const registry = createTestRegistry();
    let calls = 0;

    registerFunction(registry, "tool", "charge", () => {
      calls += 1;

      if (calls === 1) {
        return { receiptId: "r-1" };
      }

      return { receiptId: "r-2" };
    });

    const effects = createInMemoryProtectedEffectStore();
    const compiled = compiledWorkflow("charge", [
      callNode("charge", "charge", "non-idempotent-write", null, {
        protection: { kind: "idempotency-key" },
        permissions: [{ toolId: "charge", mode: "write" }],
      }),
    ]);
    const { job, context } = createRunFixture({
      permissions: [{ toolId: "charge", mode: "write" }],
    });
    const runtime = createWorkflowRuntime({ registry, effects });
    const first = await runtime.run(compiled, job, context);

    expect(first.status).toBe("completed");

    // A second run of the **same** run id and node finds the recorded effect.
    const second = await runtime.run(compiled, job, context);

    expect(calls).toBe(1);
    expect(second.status).toBe("completed");

    if (second.status !== "completed") {
      return;
    }

    expect(second.output).toEqual({ receiptId: "r-1" });
    expect(second.usage.toolCalls).toBe(0);
  });

  it("keys protection per item inside a map, so each element is protected separately", async () => {
    const registry = createTestRegistry();
    const effects = createInMemoryProtectedEffectStore();

    registerFunction(registry, "tool", "notify", (value: never) => ({ notified: value }));

    const compiled = compiledWorkflow("fan", [
      mapNode("fan", { kind: "input" }, "one", 5, null),
      callNode("one", "notify", "non-idempotent-write", null, {
        input: { kind: "item" },
        protection: { kind: "idempotency-key" },
        permissions: [{ toolId: "notify", mode: "write" }],
      }),
    ]);
    const { job, context } = createRunFixture({
      input: ["a", "b", "c"],
      permissions: [{ toolId: "notify", mode: "write" }],
    });
    const runtime = createWorkflowRuntime({ registry, effects });
    const result = await runtime.run(compiled, job, context);

    expect(result.status).toBe("completed");
    expect(effects.keys()).toEqual([
      `${context.runId}:test-workflow@1.0.0:one:0`,
      `${context.runId}:test-workflow@1.0.0:one:1`,
      `${context.runId}:test-workflow@1.0.0:one:2`,
    ]);
  });

  it("does not consult the effect store for a call that declares no protection", async () => {
    const registry = createTestRegistry();
    const effects = createInMemoryProtectedEffectStore();

    registerFunction(registry, "tool", "lookup", () => ({ found: true }));

    const compiled = compiledWorkflow("look", [
      callNode("look", "lookup", "read-only", null, {
        permissions: [{ toolId: "lookup", mode: "read" }],
      }),
    ]);
    const { job, context } = createRunFixture({
      permissions: [{ toolId: "lookup", mode: "read" }],
    });
    const runtime = createWorkflowRuntime({ registry, effects });

    await runtime.run(compiled, job, context);

    expect(effects.keys()).toEqual([]);
  });

  it("puts the attempt in the per-attempt key and not in the protection key", async () => {
    const registry = createTestRegistry();
    let calls = 0;

    registerFunction(registry, "handler", "flaky", () => {
      calls += 1;

      if (calls < 2) {
        throw new Error("again");
      }

      return { ok: true };
    });

    const compiled = compiledWorkflow("flaky", [
      codeNode("flaky", "flaky", null, { maxAttempts: 2 }),
    ]);
    const { job, context, trace } = createRunFixture();
    const runtime = createWorkflowRuntime({ registry });

    await runtime.run(compiled, job, context);

    const keys = trace.events
      .filter((event) => event.type === "node.started")
      .map((event) => event.payload.idempotencyKey);

    expect(keys).toEqual([
      `${context.runId}:test-workflow@1.0.0:flaky:-:1`,
      `${context.runId}:test-workflow@1.0.0:flaky:-:2`,
    ]);
  });
});
