import {
  type CapabilityRegistry,
  createCapabilityRegistry,
  type Schema,
  type WorkflowDefinition,
  workflowFingerprint,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { compileWorkflow } from "../compile.js";
import { workflow } from "./builder.js";

/**
 * The vendor-triage shape from M4-T10, authored with the DSL and asserted node
 * by node.
 *
 * ```text
 * Jev classify
 *     |
 *     +-- clear -> code finalize
 *     |
 *     +-- research -> agent research -> Jev verify -> code decide
 *     |
 *     +-- uncertain -> full-agent escalation
 * ```
 *
 * It is here rather than in `builder.test.ts` because it is a different kind of
 * test: the other file checks one rule at a time, and this one checks that the
 * rules *compose* into the workflow the milestone actually asks for. M4-T10
 * authors the real fixture against a capability registry; this is the same graph
 * with placeholder capability references, and it is what tells that task the DSL
 * can express the shape before it starts.
 *
 * Nothing here states an `input` binding or an `inputSchema`. That is the point:
 * every edge in this workflow is the common case, so the builder derives all of
 * it, and the only schemas written down are the ones a node genuinely
 * introduces.
 */
function vendorTriage(): WorkflowDefinition {
  return workflow({
    id: "vendor-triage-v1",
    version: "1.0.0",
    domain: "vendor-triage",
    jobType: "vendor-triage",
    input: "vendor-triage.input@1.0.0",
    output: "vendor-triage.output@1.0.0",
  })
    .jev("classify", {
      question: "vendor.classification@1.0.0",
      questionKind: "choice",
      outputSchema: "vendor-triage.classification@1.0.0",
    })
    .branch("route", {
      on: { kind: "field", path: ["category"] },
      cases: {
        clear: (b) => b.code("finalize", { handler: "vendor.finalize@1.0.0" }).end(),
        research: (b) =>
          b
            .agent("research", {
              agent: "vendor-researcher@1.0.0",
              permissions: [{ toolId: "lookup_vendor_evidence", mode: "read" }],
              outputSchema: "vendor-triage.evidence@1.0.0",
              timeoutMs: 120_000,
            })
            .jev("verify", {
              question: "vendor.evidence-supports@1.0.0",
              questionKind: "boolean",
              outputSchema: "vendor-triage.verification@1.0.0",
            })
            .code("decide", { handler: "vendor.decide@1.0.0" })
            .end(),
      },
      default: (b) => b.escalate("full-agent", { reason: "classification was uncertain" }),
    })
    .build();
}

describe("the M4-T10 vendor-triage shape", () => {
  it("starts at the classification and declares seven nodes", () => {
    const definition = vendorTriage();

    expect(definition.entry).toBe("classify");
    expect(Object.keys(definition.nodes).sort()).toStrictEqual([
      "classify",
      "decide",
      "finalize",
      "full-agent",
      "research",
      "route",
      "verify",
    ]);
  });

  it("emits the `jev` classification reading the job input", () => {
    expect(vendorTriage().nodes.classify).toStrictEqual({
      id: "classify",
      type: "jev",
      version: "1.0.0",
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.classification@1.0.0",
      timeoutMs: 60_000,
      retry: { maxAttempts: 1 },
      budget: {},
      permissions: [],
      input: { kind: "input" },
      question: { id: "vendor.classification", version: "1.0.0" },
      questionKind: "choice",
      next: "route",
    });
  });

  it("emits the three-way `branch` with no `next` of its own", () => {
    expect(vendorTriage().nodes.route).toStrictEqual({
      id: "route",
      type: "branch",
      version: "1.0.0",
      inputSchema: "vendor-triage.classification@1.0.0",
      outputSchema: "vendor-triage.classification@1.0.0",
      timeoutMs: 60_000,
      retry: { maxAttempts: 1 },
      budget: {},
      permissions: [],
      input: { kind: "node", node: "classify" },
      on: { kind: "field", path: ["category"] },
      cases: { clear: "finalize", research: "research" },
      default: "full-agent",
    });
  });

  it("ends the `clear` case at a `code` node carrying the workflow's output schema", () => {
    expect(vendorTriage().nodes.finalize).toStrictEqual({
      id: "finalize",
      type: "code",
      version: "1.0.0",
      inputSchema: "vendor-triage.classification@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      timeoutMs: 60_000,
      retry: { maxAttempts: 1 },
      budget: {},
      permissions: [],
      input: { kind: "node", node: "route" },
      handler: { id: "vendor.finalize", version: "1.0.0" },
      next: null,
    });
  });

  it("chains the `research` case through agent, jev and code", () => {
    const nodes = vendorTriage().nodes;

    expect(nodes.research).toStrictEqual({
      id: "research",
      type: "agent",
      version: "1.0.0",
      inputSchema: "vendor-triage.classification@1.0.0",
      outputSchema: "vendor-triage.evidence@1.0.0",
      timeoutMs: 120_000,
      retry: { maxAttempts: 1 },
      budget: {},
      permissions: [{ toolId: "lookup_vendor_evidence", mode: "read" }],
      input: { kind: "node", node: "route" },
      agent: { id: "vendor-researcher", version: "1.0.0" },
      next: "verify",
    });

    expect(nodes.verify).toMatchObject({
      type: "jev",
      inputSchema: "vendor-triage.evidence@1.0.0",
      outputSchema: "vendor-triage.verification@1.0.0",
      input: { kind: "node", node: "research" },
      question: { id: "vendor.evidence-supports", version: "1.0.0" },
      questionKind: "boolean",
      next: "decide",
    });

    expect(nodes.decide).toMatchObject({
      type: "code",
      inputSchema: "vendor-triage.verification@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      input: { kind: "node", node: "verify" },
      handler: { id: "vendor.decide", version: "1.0.0" },
      next: null,
    });
  });

  it("escalates on the default label, terminally and with no `next`", () => {
    const node = vendorTriage().nodes["full-agent"];

    expect(node).toStrictEqual({
      id: "full-agent",
      type: "escalate",
      version: "1.0.0",
      inputSchema: "vendor-triage.classification@1.0.0",
      outputSchema: "vendor-triage.classification@1.0.0",
      timeoutMs: 60_000,
      retry: { maxAttempts: 1 },
      budget: {},
      permissions: [],
      input: { kind: "node", node: "route" },
      reason: "classification was uncertain",
    });
    expect(node).not.toHaveProperty("next");
  });

  it("grants a tool to the agent node and to nothing else", () => {
    const nodes = vendorTriage().nodes;
    const granted = Object.values(nodes)
      .filter((node) => node.permissions.length > 0)
      .map((node) => node.id);

    expect(granted).toStrictEqual(["research"]);
  });

  it("is deterministic and fingerprints identically across builds", () => {
    expect(vendorTriage()).toStrictEqual(vendorTriage());
    expect(workflowFingerprint(vendorTriage())).toBe(workflowFingerprint(vendorTriage()));
  });
});

/**
 * The smallest Standard Schema a registry accepts, hand written.
 *
 * No `zod`: `@internal/workflow` declares no third-party dependency, and a
 * schema is only a `~standard` object with a `validate` function
 * (`packages/core/src/schema.ts`). Nothing in this test validates a value; the
 * registry needs a schema capability to exist, not to be exercised.
 */
function anySchema(): Schema<unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value }),
    },
  };
}

/** Every capability the vendor workflow names, except the Jev questions. */
function vendorRegistry(): CapabilityRegistry {
  const registry = createCapabilityRegistry();

  for (const id of [
    "vendor-triage.input",
    "vendor-triage.output",
    "vendor-triage.classification",
    "vendor-triage.evidence",
    "vendor-triage.verification",
  ]) {
    registry.register("schema", {
      id,
      version: "1.0.0",
      module: "@test/vendor-triage",
      exportName: id,
      value: anySchema(),
    });
  }

  for (const id of ["vendor.finalize", "vendor.decide"]) {
    registry.register("handler", {
      id,
      version: "1.0.0",
      module: "@test/vendor-triage",
      exportName: id,
      value: () => undefined,
    });
  }

  registry.register("agent", {
    id: "vendor-researcher",
    version: "1.0.0",
    module: "@test/vendor-triage",
    exportName: "vendorResearcher",
    value: { name: "vendor-researcher" },
  });

  registry.register("tool", {
    id: "lookup_vendor_evidence",
    version: "1.0.0",
    module: "@test/vendor-triage",
    exportName: "lookupVendorEvidence",
    value: () => undefined,
  });

  return registry;
}

describe("the DSL's output as a compiled workflow", () => {
  /**
   * The acceptance criterion this file exists for: a human-authored workflow is
   * graph-valid and every reference resolves, without the author having stated a
   * single edge, binding or derived schema.
   *
   * It exercises `compileWorkflow()` (M4-T4/M4-T9), which the DSL deliberately
   * does not call itself. That is the division of labour: the builder produces a
   * well-formed definition and the compiler decides whether it is a valid
   * workflow, so this test is the only place the two meet.
   */
  it("compiles against a registry with no issues", () => {
    const compiled = compileWorkflow(vendorTriage(), vendorRegistry());

    expect(compiled.fingerprint).toBe(workflowFingerprint(vendorTriage()));
    expect(compiled.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(compiled.definition.entry).toBe("classify");
  });
});
