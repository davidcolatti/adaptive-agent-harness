import {
  canonicalWorkflowIr,
  isWorkflowDefinition,
  ValidationError,
  type WorkflowDefinition,
  workflowFingerprint,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { workflow } from "./builder.js";
import { DSL_NODE_DEFAULTS } from "./types.js";

/**
 * The typed DSL (M4-T5).
 *
 * These tests assert the *emitted IR*, field by field, rather than that the
 * builder "worked". That is the point of the task: the DSL has no semantics of
 * its own, so the only thing worth checking is the value it produces and whether
 * `parseWorkflowDefinition()` accepts it.
 */

/**
 * Assert that `build()` throws a `ValidationError` carrying an issue whose
 * message matches.
 *
 * `emit()` collects every problem and throws one error naming the workflow, so
 * the detail lives in `issues` rather than in the message. Reading it here is
 * what makes these tests check the message an author actually sees.
 */
function expectBuildIssue(build: () => unknown, pattern: RegExp): void {
  let thrown: unknown;
  try {
    build();
  } catch (error: unknown) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ValidationError);
  const issues = (thrown as ValidationError).issues;
  expect(issues.map((issue) => issue.message).join("\n")).toMatch(pattern);
}

/** The workflow options every test reuses, so a test states only what it varies. */
const BASE = {
  id: "vendor-triage",
  version: "1.2.3",
  domain: "vendor-triage",
  jobType: "triage",
  input: "vendor-triage.input@1.0.0",
  output: "vendor-triage.output@1.0.0",
} as const;

/** A two-node linear workflow: the smallest thing with a wired edge. */
function linear(): WorkflowDefinition {
  return workflow(BASE)
    .jev("classify", {
      question: "vendor.classification@1.0.0",
      questionKind: "choice",
      outputSchema: "vendor-triage.classification@1.0.0",
    })
    .code("finalize", { handler: "vendor.finalize@1.0.0" })
    .build();
}

describe("workflow()", () => {
  it("emits a parsed, deep-frozen definition", () => {
    const definition = linear();

    expect(isWorkflowDefinition(definition)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.nodes)).toBe(true);
    expect(Object.isFrozen(definition.nodes.classify)).toBe(true);
  });

  it("carries the workflow's own fields through unchanged", () => {
    const definition = linear();

    expect(definition.schemaVersion).toBe(1);
    expect(definition.id).toBe("vendor-triage");
    expect(definition.version).toBe("1.2.3");
    expect(definition.domain).toBe("vendor-triage");
    expect(definition.jobType).toBe("triage");
    expect(definition.inputSchema).toBe("vendor-triage.input@1.0.0");
    expect(definition.outputSchema).toBe("vendor-triage.output@1.0.0");
  });

  it("defaults the workflow version to 1.0.0", () => {
    const definition = workflow({
      id: "minimal",
      domain: "d",
      jobType: "t",
      input: "d.in@1.0.0",
      output: "d.out@1.0.0",
    })
      .code("only", { handler: "d.handler@1.0.0" })
      .build();

    expect(definition.version).toBe("1.0.0");
  });

  it("rejects a workflow with no nodes", () => {
    const builder = workflow(BASE);

    expect(() => builder.build()).toThrowError(ValidationError);
    expect(() => builder.build()).toThrowError(/has no nodes/u);
  });

  it("rejects an ill-formed capability reference at the call site", () => {
    expect(() => workflow(BASE).code("finalize", { handler: "vendor.finalize" })).toThrowError(
      ValidationError,
    );
    expect(() => workflow({ ...BASE, input: "not-a-ref" })).toThrowError(ValidationError);
  });

  it("accepts a capability reference in either form and stores the IR's form", () => {
    const definition = workflow(BASE)
      .code("a", {
        handler: { id: "vendor.finalize", version: "2.0.0" },
        outputSchema: { id: "vendor-triage.partial", version: "1.0.0" },
      })
      .code("b", { handler: "vendor.decide@1.0.0" })
      .build();

    const a = definition.nodes.a;
    expect(a).toMatchObject({
      handler: { id: "vendor.finalize", version: "2.0.0" },
      outputSchema: "vendor-triage.partial@1.0.0",
    });
  });
});

describe("the top-level chain", () => {
  it("wires each node to the next and ends the last one", () => {
    const definition = linear();

    expect(definition.entry).toBe("classify");
    expect(definition.nodes.classify).toMatchObject({ next: "finalize" });
    expect(definition.nodes.finalize).toMatchObject({ next: null });
  });

  it("defaults the first node's input to the job input and the rest to their predecessor", () => {
    const definition = linear();

    expect(definition.nodes.classify).toMatchObject({
      input: { kind: "input" },
      inputSchema: "vendor-triage.input@1.0.0",
    });
    expect(definition.nodes.finalize).toMatchObject({
      input: { kind: "node", node: "classify" },
      inputSchema: "vendor-triage.classification@1.0.0",
    });
  });

  it("gives the terminal node the workflow's output schema", () => {
    expect(linear().nodes.finalize).toMatchObject({
      outputSchema: "vendor-triage.output@1.0.0",
    });
  });

  it("honours an explicit input binding over the default", () => {
    const definition = workflow(BASE)
      .jev("classify", {
        question: "vendor.classification@1.0.0",
        questionKind: "choice",
        outputSchema: "vendor-triage.classification@1.0.0",
      })
      .code("finalize", {
        handler: "vendor.finalize@1.0.0",
        input: {
          kind: "object",
          fields: {
            candidate: { kind: "input" },
            prior: { kind: "node", node: "classify", path: ["label"] },
          },
        },
        inputSchema: "vendor-triage.finalize-input@1.0.0",
      })
      .build();

    expect(definition.nodes.finalize).toMatchObject({
      input: {
        kind: "object",
        fields: {
          candidate: { kind: "input" },
          prior: { kind: "node", node: "classify", path: ["label"] },
        },
      },
      inputSchema: "vendor-triage.finalize-input@1.0.0",
    });
  });

  it("reports a node whose input schema cannot be derived", () => {
    const builder = workflow(BASE).code("finalize", {
      handler: "vendor.finalize@1.0.0",
      input: { kind: "literal", value: { candidate: "acme" } },
    });

    expectBuildIssue(() => builder.build(), /input schema cannot be derived/u);
  });

  it("reports a node that is neither terminal nor carries an output schema", () => {
    const builder = workflow(BASE)
      .code("first", { handler: "vendor.first@1.0.0" })
      .code("second", { handler: "vendor.second@1.0.0" });

    expectBuildIssue(() => builder.build(), /does not end the workflow/u);
  });

  it("reports a binding that names a node the workflow does not have", () => {
    const builder = workflow(BASE).code("finalize", {
      handler: "vendor.finalize@1.0.0",
      // biome-ignore lint/suspicious/noExplicitAny: the point of the test is an id the types reject.
      input: { kind: "node", node: "nowhere" } as any,
    });

    expectBuildIssue(() => builder.build(), /`nowhere` is not a node of this workflow/u);
  });
});

describe("defaults", () => {
  it("applies the DSL's node defaults when nothing overrides them", () => {
    const node = linear().nodes.finalize;

    expect(node).toMatchObject({
      version: DSL_NODE_DEFAULTS.version,
      timeoutMs: DSL_NODE_DEFAULTS.timeoutMs,
      retry: { maxAttempts: 1 },
      budget: {},
      permissions: [],
    });
    expect(DSL_NODE_DEFAULTS.timeoutMs).toBe(60_000);
  });

  it("lets the workflow's `defaults` block override them for every node", () => {
    const definition = workflow({
      ...BASE,
      defaults: {
        timeoutMs: 5_000,
        retry: { maxAttempts: 3, backoffMs: 250 },
        budget: { maxCostUsd: 0.5 },
        version: "2.0.0",
      },
    })
      .code("only", { handler: "vendor.finalize@1.0.0" })
      .build();

    expect(definition.nodes.only).toMatchObject({
      timeoutMs: 5_000,
      retry: { maxAttempts: 3, backoffMs: 250 },
      budget: { maxCostUsd: 0.5 },
      version: "2.0.0",
    });
  });

  it("lets a node override the workflow's defaults", () => {
    const definition = workflow({ ...BASE, defaults: { timeoutMs: 5_000 } })
      .agent("only", {
        agent: "vendor-researcher@1.0.0",
        timeoutMs: 120_000,
        permissions: [{ toolId: "lookup", mode: "read", scope: "procurement" }],
      })
      .build();

    expect(definition.nodes.only).toMatchObject({
      timeoutMs: 120_000,
      permissions: [{ toolId: "lookup", mode: "read", scope: "procurement" }],
    });
  });

  /**
   * M4-T8 as a type rule rather than a validation rule.
   *
   * `permissions` is not part of the workflow's `defaults` block and not an
   * option on any node type but `agent` and `call`, so "a `code` node does not
   * inherit agent tools" is unwritable rather than rejected. These assertions are
   * about the *types*; each line below is a compile error without the
   * `@ts-expect-error`, which is what makes the test meaningful.
   */
  it("offers `permissions` only on `agent` and `call` nodes", () => {
    const builder = workflow(BASE);

    // @ts-expect-error a `code` node uses no tools and inherits none (M4-T8).
    expect(() => builder.code("a", { handler: "h@1.0.0", permissions: [] })).toBeTypeOf("function");
    // @ts-expect-error the workflow-level block must not grant anything either.
    expect(() => workflow({ ...BASE, defaults: { permissions: [] } })).toBeTypeOf("function");
  });

  it("grants nothing to a node that cannot carry grants", () => {
    const definition = workflow({ ...BASE, defaults: { timeoutMs: 5_000 } })
      .jev("classify", {
        question: "vendor.classification@1.0.0",
        questionKind: "choice",
        outputSchema: "vendor-triage.classification@1.0.0",
      })
      .code("finalize", { handler: "vendor.finalize@1.0.0" })
      .build();

    expect(definition.nodes.classify).toMatchObject({ permissions: [] });
    expect(definition.nodes.finalize).toMatchObject({ permissions: [] });
  });
});

describe("duplicate ids", () => {
  it("throws at definition time, naming the offending id", () => {
    expect(() =>
      workflow(BASE)
        .code("finalize", {
          handler: "vendor.finalize@1.0.0",
          outputSchema: "vendor-triage.partial@1.0.0",
        })
        .code("finalize", { handler: "vendor.finalize@1.0.0" }),
    ).toThrowError(/duplicate node id `finalize`/u);
  });

  it("catches a collision between a sub-graph and the top level", () => {
    expect(() =>
      workflow(BASE)
        .jev("classify", {
          question: "vendor.classification@1.0.0",
          questionKind: "choice",
          outputSchema: "vendor-triage.classification@1.0.0",
        })
        .branch("route", {
          on: { kind: "field", path: ["label"] },
          cases: { clear: (b) => b.code("classify", { handler: "vendor.finalize@1.0.0" }).end() },
          default: (b) => b.escalate("give-up", { reason: "uncertain" }),
        }),
    ).toThrowError(/duplicate node id `classify`/u);
  });
});

describe("branch", () => {
  /** A branch whose two cases rejoin at a node declared after it. */
  function rejoining(): WorkflowDefinition {
    return workflow(BASE)
      .jev("classify", {
        question: "vendor.classification@1.0.0",
        questionKind: "choice",
        outputSchema: "vendor-triage.classification@1.0.0",
      })
      .branch("route", {
        on: { kind: "field", path: ["label"] },
        cases: {
          clear: (b) => b.goto("finalize"),
          research: (b) =>
            b
              .agent("research", {
                agent: "vendor-researcher@1.0.0",
                outputSchema: "vendor-triage.evidence@1.0.0",
              })
              .goto("finalize"),
        },
        default: (b) => b.escalate("give-up", { reason: "classification was uncertain" }),
      })
      .code("finalize", {
        handler: "vendor.finalize@1.0.0",
        input: { kind: "node", node: "classify" },
      })
      .build();
  }

  it("has no `next` and points each case at its sub-graph's head", () => {
    const definition = rejoining();
    const route = definition.nodes.route;

    expect(route).toMatchObject({
      type: "branch",
      on: { kind: "field", path: ["label"] },
      cases: { clear: "finalize", research: "research" },
      default: "give-up",
    });
    expect(route).not.toHaveProperty("next");
  });

  it("passes its input schema through to its output schema", () => {
    expect(rejoining().nodes.route).toMatchObject({
      inputSchema: "vendor-triage.classification@1.0.0",
      outputSchema: "vendor-triage.classification@1.0.0",
    });
  });

  it("lets a case rejoin the main graph with `goto`", () => {
    const definition = rejoining();

    expect(definition.nodes.research).toMatchObject({ next: "finalize" });
    expect(definition.nodes.finalize).toMatchObject({
      next: null,
      input: { kind: "node", node: "classify" },
      outputSchema: "vendor-triage.output@1.0.0",
    });
  });

  it("defaults a case head's input to the branch's output", () => {
    expect(rejoining().nodes.research).toMatchObject({
      input: { kind: "node", node: "route" },
      inputSchema: "vendor-triage.classification@1.0.0",
    });
  });

  it("lets a case bind to the branch itself by name", () => {
    const definition = workflow(BASE)
      .branch("route", {
        on: { kind: "field", path: ["label"] },
        cases: {
          clear: (b) =>
            b
              .code("finalize", {
                handler: "vendor.finalize@1.0.0",
                // The container's own id is in scope inside its sub-graph, so
                // this is typo-checked rather than only checked at `build()`.
                input: { kind: "node", node: "route" },
              })
              .end(),
        },
        default: (b) => b.escalate("give-up", { reason: "unmatched label" }),
      })
      .build();

    expect(definition.nodes.finalize).toMatchObject({ input: { kind: "node", node: "route" } });
  });

  it("accepts a policy selector", () => {
    const definition = workflow(BASE)
      .branch("route", {
        on: { kind: "policy", policy: "vendor.routing-policy@2.1.0" },
        cases: { clear: (b) => b.code("finalize", { handler: "vendor.finalize@1.0.0" }).end() },
        default: (b) => b.escalate("give-up", { reason: "unmatched label" }),
      })
      .build();

    expect(definition.nodes.route).toMatchObject({
      on: { kind: "policy", policy: { id: "vendor.routing-policy", version: "2.1.0" } },
    });
  });

  it("makes a case that ends with `end()` a terminal of the workflow", () => {
    const definition = workflow(BASE)
      .branch("route", {
        on: { kind: "field", path: ["label"] },
        cases: { clear: (b) => b.code("finalize", { handler: "vendor.finalize@1.0.0" }).end() },
        default: (b) => b.escalate("give-up", { reason: "unmatched label" }),
      })
      .build();

    expect(definition.nodes.finalize).toMatchObject({
      next: null,
      outputSchema: "vendor-triage.output@1.0.0",
    });
  });

  it("rejects a branch with no cases", () => {
    expect(() =>
      workflow(BASE).branch("route", {
        on: { kind: "field", path: ["label"] },
        cases: {},
        default: (b) => b.escalate("give-up", { reason: "unmatched label" }),
      }),
    ).toThrowError(/has no cases/u);
  });

  it("rejects an empty case sub-graph", () => {
    expect(() =>
      workflow(BASE).branch("route", {
        on: { kind: "field", path: ["label"] },
        cases: { clear: (b) => b.end() },
        default: (b) => b.escalate("give-up", { reason: "unmatched label" }),
      }),
    ).toThrowError(/is empty/u);
  });

  it("reports a `goto` target that does not exist", () => {
    const builder = workflow(BASE).branch("route", {
      on: { kind: "field", path: ["label"] },
      cases: {
        clear: (b) => b.code("finalize", { handler: "vendor.finalize@1.0.0" }).goto("nope"),
      },
      default: (b) => b.escalate("give-up", { reason: "unmatched label" }),
    });

    expectBuildIssue(() => builder.build(), /`nope` is not a node of this workflow/u);
  });

  it("requires a node added after a branch to state its own input", () => {
    const builder = workflow(BASE)
      .branch("route", {
        on: { kind: "field", path: ["label"] },
        cases: { clear: (b) => b.goto("finalize") },
        default: (b) => b.escalate("give-up", { reason: "unmatched label" }),
      })
      .code("finalize", { handler: "vendor.finalize@1.0.0" });

    expectBuildIssue(() => builder.build(), /has no unique predecessor/u);
  });
});

describe("the other control shapes", () => {
  it("emits a `chain` whose steps are contained and individually terminal", () => {
    const definition = workflow(BASE)
      .chain("prepare", {
        steps: (b) =>
          b
            .code("normalize", {
              handler: "vendor.normalize@1.0.0",
              outputSchema: "vendor-triage.normalized@1.0.0",
            })
            .code("enrich", {
              handler: "vendor.enrich@1.0.0",
              outputSchema: "vendor-triage.enriched@1.0.0",
            })
            .end(),
        outputSchema: "vendor-triage.enriched@1.0.0",
      })
      .build();

    expect(definition.nodes.prepare).toMatchObject({
      type: "chain",
      steps: ["normalize", "enrich"],
      next: null,
    });
    expect(definition.nodes.normalize).toMatchObject({
      next: null,
      input: { kind: "node", node: "prepare" },
    });
    expect(definition.nodes.enrich).toMatchObject({
      next: null,
      input: { kind: "node", node: "normalize" },
    });
  });

  it("emits a `map` whose body head reads the current item", () => {
    const definition = workflow(BASE)
      .map("each", {
        items: { kind: "input" },
        maxItems: 50,
        concurrency: 4,
        body: (b) =>
          b
            .code("score", {
              handler: "vendor.score@1.0.0",
              inputSchema: "vendor-triage.candidate@1.0.0",
              outputSchema: "vendor-triage.score@1.0.0",
            })
            .end(),
      })
      .build();

    expect(definition.nodes.each).toMatchObject({
      type: "map",
      items: { kind: "input" },
      body: "score",
      maxItems: 50,
      concurrency: 4,
      next: null,
    });
    expect(definition.nodes.score).toMatchObject({
      input: { kind: "item" },
      inputSchema: "vendor-triage.candidate@1.0.0",
      next: null,
    });
  });

  it("emits a `loop` with both bounds and a body that returns to it", () => {
    const definition = workflow(BASE)
      .loop("refine", {
        maxIterations: 5,
        until: { kind: "field", path: ["done"], equals: true },
        body: (b) =>
          b
            .code("step", {
              handler: "vendor.refine@1.0.0",
              outputSchema: "vendor-triage.draft@1.0.0",
            })
            .end(),
      })
      .build();

    expect(definition.nodes.refine).toMatchObject({
      type: "loop",
      body: "step",
      maxIterations: 5,
      until: { kind: "field", path: ["done"], equals: true },
      next: null,
    });
    expect(definition.nodes.step).toMatchObject({
      input: { kind: "node", node: "refine" },
      next: null,
    });
  });

  it("emits a `reduce` with its handler and initial accumulator", () => {
    const definition = workflow(BASE)
      .reduce("total", {
        items: { kind: "input" },
        handler: "vendor.accumulate@1.0.0",
        initial: { count: 0 },
      })
      .build();

    expect(definition.nodes.total).toMatchObject({
      type: "reduce",
      items: { kind: "input" },
      handler: { id: "vendor.accumulate", version: "1.0.0" },
      initial: { count: 0 },
      next: null,
    });
  });

  it("rejects `goto` from a container body", () => {
    expect(() =>
      workflow(BASE).map("each", {
        items: { kind: "input" },
        maxItems: 10,
        body: (b) =>
          b
            .code("score", {
              handler: "vendor.score@1.0.0",
              inputSchema: "vendor-triage.candidate@1.0.0",
              outputSchema: "vendor-triage.score@1.0.0",
            })
            .goto("somewhere"),
      }),
    ).toThrowError(/cannot use `goto`/u);
  });
});

describe("the executable node types", () => {
  it("emits a `call` with its effect and protection", () => {
    const definition = workflow(BASE)
      .call("file-ticket", {
        tool: "ticketing.create@3.1.0",
        effect: "non-idempotent-write",
        protection: { kind: "idempotency-key" },
        permissions: [{ toolId: "ticketing.create", mode: "write", scope: "procurement" }],
      })
      .build();

    expect(definition.nodes["file-ticket"]).toMatchObject({
      type: "call",
      tool: { id: "ticketing.create", version: "3.1.0" },
      effect: "non-idempotent-write",
      protection: { kind: "idempotency-key" },
      permissions: [{ toolId: "ticketing.create", mode: "write", scope: "procurement" }],
      next: null,
    });
  });

  it("omits `protection` when none was declared", () => {
    const definition = workflow(BASE)
      .call("lookup", { tool: "vendor.lookup@1.0.0", effect: "read-only" })
      .build();

    expect(definition.nodes.lookup).not.toHaveProperty("protection");
  });

  it("grants a `call` node its own tool at the mode its effect needs", () => {
    const definition = workflow(BASE)
      .call("lookup", {
        tool: "vendor.lookup@1.0.0",
        effect: "read-only",
        outputSchema: "vendor-triage.evidence@1.0.0",
      })
      .call("record", { tool: "vendor.record@1.0.0", effect: "idempotent-write" })
      .build();

    expect(definition.nodes.lookup).toMatchObject({
      permissions: [{ toolId: "vendor.lookup", mode: "read" }],
    });
    expect(definition.nodes.record).toMatchObject({
      permissions: [{ toolId: "vendor.record", mode: "write" }],
    });
  });

  it("uses a `call` node's stated grants instead of deriving one", () => {
    const definition = workflow(BASE)
      .call("lookup", {
        tool: "vendor.lookup@1.0.0",
        effect: "read-only",
        permissions: [{ toolId: "vendor.lookup", mode: "read", scope: "procurement" }],
      })
      .build();

    expect(definition.nodes.lookup).toMatchObject({
      permissions: [{ toolId: "vendor.lookup", mode: "read", scope: "procurement" }],
    });
  });

  it("emits an `artifact` with its role name and content type", () => {
    const definition = workflow(BASE)
      .artifact("record", { name: "research-notes", contentType: "application/json" })
      .build();

    expect(definition.nodes.record).toMatchObject({
      type: "artifact",
      name: "research-notes",
      contentType: "application/json",
      next: null,
    });
  });

  it("emits a terminal `escalate` with no `next` at all", () => {
    const definition = workflow(BASE)
      .escalate("full-agent", { reason: "classification was uncertain" })
      .build();

    const node = definition.nodes["full-agent"];
    expect(node).toMatchObject({ type: "escalate", reason: "classification was uncertain" });
    expect(node).not.toHaveProperty("next");
    expect(node).toMatchObject({
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.input@1.0.0",
    });
  });
});

describe("determinism", () => {
  it("builds deep-equal IR twice", () => {
    expect(linear()).toStrictEqual(linear());
  });

  it("gives the same fingerprint to two builds of the same workflow", () => {
    expect(workflowFingerprint(linear())).toBe(workflowFingerprint(linear()));
  });

  it("is unaffected by the order independent settings were written in", () => {
    const a = workflow(BASE)
      .jev("classify", {
        question: "vendor.classification@1.0.0",
        questionKind: "choice",
        outputSchema: "vendor-triage.classification@1.0.0",
        timeoutMs: 10_000,
        retry: { maxAttempts: 2 },
      })
      .branch("route", {
        on: { kind: "field", path: ["label"] },
        cases: {
          clear: (b) => b.goto("finalize"),
          research: (b) => b.goto("finalize"),
        },
        default: (b) => b.escalate("give-up", { reason: "uncertain" }),
      })
      .code("finalize", {
        handler: "vendor.finalize@1.0.0",
        input: { kind: "node", node: "classify" },
      })
      .build();

    const b = workflow(BASE)
      .jev("classify", {
        retry: { maxAttempts: 2 },
        timeoutMs: 10_000,
        outputSchema: "vendor-triage.classification@1.0.0",
        questionKind: "choice",
        question: { id: "vendor.classification", version: "1.0.0" },
      })
      .branch("route", {
        on: { kind: "field", path: ["label"] },
        cases: {
          research: (nested) => nested.goto("finalize"),
          clear: (nested) => nested.goto("finalize"),
        },
        default: (nested) => nested.escalate("give-up", { reason: "uncertain" }),
      })
      .code("finalize", {
        input: { kind: "node", node: "classify" },
        handler: { id: "vendor.finalize", version: "1.0.0" },
      })
      .build();

    expect(workflowFingerprint(a)).toBe(workflowFingerprint(b));
    expect(canonicalWorkflowIr(a)).toBe(canonicalWorkflowIr(b));
  });

  it("changes the fingerprint when a node's configuration changes", () => {
    const slower = workflow(BASE)
      .jev("classify", {
        question: "vendor.classification@1.0.0",
        questionKind: "choice",
        outputSchema: "vendor-triage.classification@1.0.0",
      })
      .code("finalize", { handler: "vendor.finalize@1.0.0", timeoutMs: 90_000 })
      .build();

    expect(workflowFingerprint(slower)).not.toBe(workflowFingerprint(linear()));
  });

  it("survives a JSON round trip, which is the acceptance criterion", () => {
    const definition = linear();
    const roundTripped: unknown = JSON.parse(JSON.stringify(definition));

    expect(isWorkflowDefinition(roundTripped)).toBe(true);
    expect(workflowFingerprint(roundTripped)).toBe(workflowFingerprint(definition));
    expect(canonicalWorkflowIr(roundTripped)).toBe(canonicalWorkflowIr(definition));
  });
});

describe("toIr()", () => {
  it("returns the same IR, unparsed and unfrozen", () => {
    const builder = workflow(BASE)
      .jev("classify", {
        question: "vendor.classification@1.0.0",
        questionKind: "choice",
        outputSchema: "vendor-triage.classification@1.0.0",
      })
      .code("finalize", { handler: "vendor.finalize@1.0.0" });

    const raw = builder.toIr();

    expect(Object.isFrozen(raw)).toBe(false);
    expect(raw).toStrictEqual(linear());
    expect(isWorkflowDefinition(raw)).toBe(true);
  });
});
