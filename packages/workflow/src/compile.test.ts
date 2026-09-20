import {
  type CapabilityRegistry,
  canonicalWorkflowIr,
  createCapabilityRegistry,
  parseWorkflowDefinition,
  type Schema,
  ValidationError,
  type ValidationIssue,
  workflowFingerprint,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import { compileWorkflow } from "./compile.js";
import { validateWorkflow } from "./validate/index.js";

/**
 * A minimal Standard Schema, written by hand so that this package tests
 * validation rather than a schema library. `@internal/workflow` declares no
 * third-party dependency, and a fixture that needed `zod` would be the first.
 */
function fakeSchema(): Schema<unknown> {
  return {
    "~standard": { version: 1, vendor: "harness-test", validate: (value: unknown) => ({ value }) },
  };
}

const INPUT = "vendor.input@1.0.0";
const OUTPUT = "vendor.output@1.0.0";
const CLASSIFICATION = "vendor.classification@1.0.0";
const NOTES = "vendor.notes@1.0.0";

function registerSchema(registry: CapabilityRegistry, id: string): void {
  registry.register("schema", {
    id,
    version: "1.0.0",
    module: "src/schemas.ts",
    exportName: id,
    value: fakeSchema(),
  });
}

/**
 * The registry every test compiles against: six schemas, three handlers, two
 * tools, one agent and two policies.
 *
 * `vendor.is-clear`, the question the `jev` node names, is deliberately **not**
 * registered under any kind: a question is not a capability, M3 owns it, and
 * every positive test here would fail if validation tried to resolve it.
 */
function createTestRegistry(): CapabilityRegistry {
  const registry = createCapabilityRegistry();

  for (const id of [
    "vendor.input",
    "vendor.output",
    "vendor.classification",
    "vendor.notes",
    "vendor.item",
    "vendor.items",
  ]) {
    registerSchema(registry, id);
  }

  for (const id of ["vendor.finalize", "vendor.decide", "vendor.merge"]) {
    registry.register("handler", {
      id,
      version: "1.0.0",
      module: "src/handlers.ts",
      exportName: id,
      value: () => null,
    });
  }

  // The one capability that declares its own schemas, for the cross-check.
  registry.register("handler", {
    id: "vendor.strict",
    version: "1.0.0",
    module: "src/handlers.ts",
    exportName: "strict",
    inputSchema: { id: "vendor.classification", version: "1.0.0" },
    outputSchema: { id: "vendor.output", version: "1.0.0" },
    value: () => null,
  });

  for (const id of ["ticketing.create", "vendor.lookup"]) {
    registry.register("tool", {
      id,
      version: "1.0.0",
      module: "src/tools.ts",
      exportName: id,
      permissions: ["write"],
      value: () => null,
    });
  }

  registry.register("agent", {
    id: "vendor-researcher",
    version: "1.0.0",
    module: "src/agent.ts",
    exportName: "default",
    inputSchema: { id: "vendor.input", version: "1.0.0" },
    outputSchema: { id: "vendor.output", version: "1.0.0" },
    permissions: ["read"],
    value: { framework: "eve" },
  });

  for (const id of ["vendor.route", "vendor.is-done"]) {
    registry.register("policy", {
      id,
      version: "1.0.0",
      module: "src/policies.ts",
      exportName: id,
      value: () => "clear",
    });
  }

  return registry;
}

/** A mutable JSON object under construction in a test. */
type Draft = { [key: string]: unknown };

/**
 * The ten base fields every node carries, as data a test can spread and
 * override. Written as a literal rather than behind options, because most of
 * these tests are about one field being wrong and the wrong field should be
 * visible at the call site.
 */
function base(id: string): Draft {
  return {
    id,
    version: "1.0.0",
    inputSchema: CLASSIFICATION,
    outputSchema: OUTPUT,
    timeoutMs: 30_000,
    retry: { maxAttempts: 1 },
    budget: {},
    permissions: [],
    input: { kind: "node", node: "classify" },
  };
}

function codeNode(id: string, next: string | null = null): Draft {
  return {
    ...base(id),
    type: "code",
    handler: { id: "vendor.finalize", version: "1.0.0" },
    next,
  };
}

/**
 * The smallest valid workflow: classify, route, finalize or escalate.
 *
 * Every negative test starts from this and breaks exactly one thing, so an
 * assertion that a rule fired is not quietly satisfied by a second mistake.
 */
function baseWorkflow(): Draft {
  return {
    schemaVersion: 1,
    id: "vendor-triage",
    version: "1.0.0",
    domain: "vendor-triage",
    jobType: "triage",
    inputSchema: INPUT,
    outputSchema: OUTPUT,
    entry: "classify",
    nodes: {
      classify: {
        ...base("classify"),
        type: "jev",
        inputSchema: INPUT,
        outputSchema: CLASSIFICATION,
        input: { kind: "input" },
        question: { id: "vendor.is-clear", version: "1.0.0" },
        questionKind: "boolean",
        next: "route",
      },
      route: {
        ...base("route"),
        type: "branch",
        outputSchema: CLASSIFICATION,
        on: { kind: "field", path: ["label"] },
        cases: { clear: "finalize" },
        default: "give-up",
      },
      finalize: codeNode("finalize"),
      "give-up": { ...base("give-up"), type: "escalate", reason: "classification was uncertain" },
    },
  };
}

/** A workflow draft plus its `nodes` map, so a test can reach either. */
function draft(): { readonly workflow: Draft; readonly nodes: Draft } {
  const workflow = baseWorkflow();
  return { workflow, nodes: workflow.nodes as Draft };
}

function validate(workflow: unknown, registry = createTestRegistry()): readonly ValidationIssue[] {
  return validateWorkflow(parseWorkflowDefinition(workflow), registry);
}

/** Issues rendered as `path: message`, so a failing assertion is readable. */
function messagesOf(issues: readonly ValidationIssue[]): readonly string[] {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

function expectValid(workflow: unknown, registry = createTestRegistry()): void {
  expect(messagesOf(validate(workflow, registry))).toEqual([]);
}

function expectIssue(
  issues: readonly ValidationIssue[],
  path: readonly (string | number)[],
  fragment: string,
): void {
  const rendered = messagesOf(issues);
  const found = issues.some(
    (issue) => issue.path.join(".") === path.join(".") && issue.message.includes(fragment),
  );

  expect(
    found ? rendered : { expectedPath: path.join("."), expectedFragment: fragment, got: rendered },
  ).toEqual(rendered);
}

describe("compileWorkflow", () => {
  it("returns a frozen CompiledWorkflow for a valid workflow", () => {
    const workflow = baseWorkflow();
    const compiled = compileWorkflow(workflow, createTestRegistry());

    expect(Object.isFrozen(compiled)).toBe(true);
    expect(compiled.definition.id).toBe("vendor-triage");
    expect(Object.isFrozen(compiled.definition)).toBe(true);
    expect(compiled.canonicalJson).toBe(canonicalWorkflowIr(workflow));
    expect(compiled.fingerprint).toBe(workflowFingerprint(workflow));
    expect(compiled.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("produces the same fingerprint for the same IR", () => {
    const registry = createTestRegistry();

    expect(compileWorkflow(baseWorkflow(), registry).fingerprint).toBe(
      compileWorkflow(baseWorkflow(), registry).fingerprint,
    );
  });

  it("produces the same fingerprint when the same workflow is written in a different key order", () => {
    const { workflow } = draft();
    const reordered: Draft = {
      nodes: {
        "give-up": (workflow.nodes as Draft)["give-up"],
        finalize: (workflow.nodes as Draft).finalize,
        route: (workflow.nodes as Draft).route,
        classify: (workflow.nodes as Draft).classify,
      },
      entry: workflow.entry,
      outputSchema: workflow.outputSchema,
      inputSchema: workflow.inputSchema,
      jobType: workflow.jobType,
      domain: workflow.domain,
      version: workflow.version,
      id: workflow.id,
      schemaVersion: workflow.schemaVersion,
    };

    const registry = createTestRegistry();
    const first = compileWorkflow(workflow, registry);
    const second = compileWorkflow(reordered, registry);

    expect(second.canonicalJson).toBe(first.canonicalJson);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("lets a shape error from parseWorkflowDefinition propagate unchanged", () => {
    const { workflow } = draft();
    workflow.unexpected = true;

    expect(() => compileWorkflow(workflow, createTestRegistry())).toThrow(
      /parseWorkflowDefinition/u,
    );
  });

  it("throws one ValidationError carrying every graph and capability issue", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).handler = { id: "vendor.unknown", version: "1.0.0" };
    (nodes.route as Draft).cases = { clear: "nowhere" };

    let thrown: unknown;
    try {
      compileWorkflow(workflow, createTestRegistry());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    const issues = (thrown as ValidationError).issues;
    expect((thrown as ValidationError).message).toBe(
      "compileWorkflow: workflow definition is invalid",
    );
    expectIssue(issues, ["nodes", "route", "cases", "clear"], "names no node");
    expectIssue(issues, ["nodes", "finalize", "handler"], "no `handler` capability");
  });

  it("fails on a missing capability before any node could run", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).handler = { id: "vendor.unknown", version: "1.0.0" };

    expect(() => compileWorkflow(workflow, createTestRegistry())).toThrow(ValidationError);
    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "handler"],
      "no `handler` capability `vendor.unknown@1.0.0` is registered",
    );
  });
});

describe("validateWorkflow: the graph (M4-T4)", () => {
  it("accepts the base workflow", () => {
    expectValid(baseWorkflow());
  });

  it("rejects an `entry` that names no node", () => {
    const { workflow } = draft();
    workflow.entry = "nowhere";

    expectIssue(validate(workflow), ["entry"], "`nowhere` names no node");
  });

  it("rejects an edge that names no node", () => {
    const { workflow, nodes } = draft();
    (nodes.classify as Draft).next = "nowhere";

    expectIssue(validate(workflow), ["nodes", "classify", "next"], "names no node");
  });

  it("rejects a containment target that names no node", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "steps" };
    nodes.steps = { ...base("steps"), type: "chain", steps: ["nowhere"], next: null };

    expectIssue(validate(workflow), ["nodes", "steps", "steps", 0], "names no node");
  });

  it("rejects an unreachable node", () => {
    const { workflow, nodes } = draft();
    nodes.orphan = codeNode("orphan");

    expectIssue(validate(workflow), ["nodes", "orphan"], "unreachable");
  });

  it("rejects an intentional unbounded cycle", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).next = "classify";

    const issues = validate(workflow);

    expectIssue(
      issues,
      ["nodes", "finalize", "next"],
      "repetition must be a `loop` or `map` node, never a back edge",
    );
    expect(issues.some((issue) => issue.message.includes("cycle `classify`"))).toBe(true);
  });

  it("rejects a cycle that runs through containment", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "steps" };
    nodes.steps = { ...base("steps"), type: "chain", steps: ["stepA"], next: null };
    nodes.stepA = { ...codeNode("stepA"), next: "steps" };

    const issues = validate(workflow);
    expect(issues.some((issue) => issue.message.includes("repetition must be"))).toBe(true);
  });

  it("rejects the same node appearing as two container children", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "steps" };
    nodes.steps = { ...base("steps"), type: "chain", steps: ["stepA", "stepA"], next: null };
    nodes.stepA = codeNode("stepA");

    expectIssue(validate(workflow), ["nodes", "steps", "steps", 1], "a node has exactly one owner");
  });

  it("rejects a node that is both a container child and an edge target", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "steps", other: "stepA" };
    nodes.steps = { ...base("steps"), type: "chain", steps: ["stepA"], next: null };
    nodes.stepA = codeNode("stepA");

    expectIssue(validate(workflow), ["nodes", "steps", "steps", 0], "already owned by");
  });

  it("rejects a container child subgraph that continues into the outer graph", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "each" };
    nodes.each = {
      ...base("each"),
      type: "map",
      items: { kind: "node", node: "classify", path: ["candidates"] },
      body: "score",
      maxItems: 10,
      next: "finalize",
    };
    nodes.score = {
      ...codeNode("score"),
      input: { kind: "item" },
      outputSchema: NOTES,
      next: "finalize",
    };

    expectIssue(
      validate(workflow),
      ["nodes", "score", "next"],
      "a container child's subgraph must end with `next: null`",
    );
  });

  it("accepts a bounded `map` whose body ends its own subgraph", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "each" };
    nodes.each = {
      ...base("each"),
      type: "map",
      items: { kind: "node", node: "classify", path: ["candidates"] },
      body: "score",
      maxItems: 10,
      next: "finalize",
    };
    nodes.score = { ...codeNode("score"), input: { kind: "item" }, outputSchema: NOTES };

    expectValid(workflow);
  });

  it("accepts a bounded `loop`, which is how repetition is expressed", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "refine" };
    nodes.refine = {
      ...base("refine"),
      type: "loop",
      body: "polish",
      maxIterations: 3,
      until: { kind: "policy", policy: { id: "vendor.is-done", version: "1.0.0" } },
      next: "finalize",
    };
    nodes.polish = { ...codeNode("polish"), outputSchema: NOTES };

    expectValid(workflow);
  });

  it("accepts a `chain` whose steps run in sequence", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "steps" };
    delete nodes.finalize;
    nodes.steps = { ...base("steps"), type: "chain", steps: ["stepA", "stepB"], next: null };
    nodes.stepA = { ...codeNode("stepA"), outputSchema: NOTES };
    nodes.stepB = {
      ...codeNode("stepB"),
      input: { kind: "node", node: "stepA" },
      inputSchema: NOTES,
    };

    expectValid(workflow);
  });

  it("accepts a `reduce` over another node's output", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "fold" };
    delete nodes.finalize;
    nodes.fold = {
      ...base("fold"),
      type: "reduce",
      items: { kind: "node", node: "classify", path: ["scores"] },
      handler: { id: "vendor.merge", version: "1.0.0" },
      initial: { total: 0 },
      next: null,
    };

    expectValid(workflow);
  });
});

describe("validateWorkflow: bindings", () => {
  it('rejects `{ kind: "item" }` outside a `map` body', () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).input = { kind: "item" };

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "input"],
      "valid only inside a `map` node's body",
    );
  });

  it('rejects `{ kind: "item" }` nested inside an `object` binding outside a map', () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).input = {
      kind: "object",
      fields: { current: { kind: "item" }, prior: { kind: "node", node: "classify" } },
    };

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "input", "fields", "current"],
      "valid only inside a `map` node's body",
    );
  });

  it("rejects a `node` binding that does not run on every path to the reader", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "stepA", other: "stepB" };
    nodes.stepA = { ...codeNode("stepA"), outputSchema: NOTES };
    nodes.stepB = {
      ...codeNode("stepB"),
      input: { kind: "node", node: "stepA" },
      inputSchema: NOTES,
    };

    expectIssue(
      validate(workflow),
      ["nodes", "stepB", "input", "node"],
      "does not run on every path to `stepB`",
    );
  });

  it("rejects a node binding to itself", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).input = { kind: "node", node: "finalize" };
    (nodes.finalize as Draft).inputSchema = OUTPUT;

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "input", "node"],
      "cannot read its own output",
    );
  });

  it("rejects a `node` binding that names no node", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).input = { kind: "node", node: "nowhere" };

    expectIssue(validate(workflow), ["nodes", "finalize", "input", "node"], "names no node");
  });
});

describe("validateWorkflow: node rules (M4-T7, M4-T8)", () => {
  it("rejects tool grants on a `code` node", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).permissions = [{ toolId: "vendor.lookup", mode: "read" }];

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "permissions"],
      "it does not inherit an agent's tools",
    );
  });

  it("rejects tool grants on a node that uses no tools", () => {
    const { workflow, nodes } = draft();
    (nodes.classify as Draft).permissions = [{ toolId: "vendor.lookup", mode: "read" }];

    expectIssue(
      validate(workflow),
      ["nodes", "classify", "permissions"],
      "only `agent` and `call` nodes carry grants",
    );
  });

  it("rejects a `branch` with no `default`", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "finalize", uncertain: "give-up" };
    delete (nodes.route as Draft).default;

    expectIssue(validate(workflow), ["nodes", "route", "default"], "must declare a `default`");
  });

  it("rejects a workflow with no reachable `escalate` node", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).default = "finalize";
    delete nodes["give-up"];

    expectIssue(validate(workflow), ["nodes"], "at least one `escalate` node reachable");
  });

  it("rejects a `non-idempotent-write` call with no protection", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "file" };
    nodes.file = {
      ...base("file"),
      type: "call",
      tool: { id: "ticketing.create", version: "1.0.0" },
      effect: "non-idempotent-write",
      permissions: [{ toolId: "ticketing.create", mode: "write" }],
      next: null,
    };

    expectIssue(
      validate(workflow),
      ["nodes", "file", "protection"],
      "must declare explicit protection",
    );
  });

  it("accepts a `non-idempotent-write` call that declares protection", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "file" };
    delete nodes.finalize;
    nodes.file = {
      ...base("file"),
      type: "call",
      tool: { id: "ticketing.create", version: "1.0.0" },
      effect: "non-idempotent-write",
      protection: { kind: "idempotency-key" },
      permissions: [{ toolId: "ticketing.create", mode: "write" }],
      next: null,
    };

    expectValid(workflow);
  });

  it("rejects a `call` node with no grant for the tool it calls", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "file" };
    nodes.file = {
      ...base("file"),
      type: "call",
      tool: { id: "ticketing.create", version: "1.0.0" },
      effect: "read-only",
      permissions: [],
      next: null,
    };

    expectIssue(validate(workflow), ["nodes", "file", "permissions"], "no grant for");
  });

  it("rejects a write call granted only `read`", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "file" };
    nodes.file = {
      ...base("file"),
      type: "call",
      tool: { id: "ticketing.create", version: "1.0.0" },
      effect: "idempotent-write",
      permissions: [{ toolId: "ticketing.create", mode: "read" }],
      next: null,
    };

    expectIssue(
      validate(workflow),
      ["nodes", "file", "permissions"],
      'a write needs a grant with `mode: "write"`',
    );
  });

  it("accepts a read-only call granted `read`", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "file" };
    delete nodes.finalize;
    nodes.file = {
      ...base("file"),
      type: "call",
      tool: { id: "ticketing.create", version: "1.0.0" },
      effect: "read-only",
      permissions: [{ toolId: "ticketing.create", mode: "read" }],
      next: null,
    };

    expectValid(workflow);
  });

  it("rejects a `call` grant naming an unregistered tool", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "file" };
    nodes.file = {
      ...base("file"),
      type: "call",
      tool: { id: "ticketing.create", version: "1.0.0" },
      effect: "read-only",
      permissions: [
        { toolId: "ticketing.create", mode: "read" },
        { toolId: "load_skill", mode: "read" },
      ],
      next: null,
    };

    expectIssue(
      validate(workflow),
      ["nodes", "file", "permissions", 1, "toolId"],
      "a `call` node's grants must resolve",
    );
  });

  it("accepts an `agent` grant naming an unregistered framework tool", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "research" };
    delete nodes.finalize;
    nodes.research = {
      ...base("research"),
      type: "agent",
      agent: { id: "vendor-researcher", version: "1.0.0" },
      inputSchema: INPUT,
      input: { kind: "input" },
      permissions: [
        { toolId: "vendor.lookup", mode: "read" },
        { toolId: "load_skill", mode: "read" },
      ],
      next: null,
    };

    expectValid(workflow);
  });
});

describe("validateWorkflow: schema compatibility", () => {
  it("rejects a node reading the whole job input whose `inputSchema` is not the workflow's", () => {
    const { workflow, nodes } = draft();
    (nodes.classify as Draft).inputSchema = CLASSIFICATION;

    expectIssue(
      validate(workflow),
      ["nodes", "classify", "inputSchema"],
      "the workflow's `inputSchema`",
    );
  });

  it("rejects a node reading another node's whole output under a different schema", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).inputSchema = NOTES;

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "inputSchema"],
      "the `outputSchema` of `classify`",
    );
  });

  it("rejects a top-level terminal node whose `outputSchema` is not the workflow's", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).outputSchema = NOTES;

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "outputSchema"],
      "because this node ends the top-level graph",
    );
  });

  it("accepts a `branch` whose two schemas are the same, because it is pass-through", () => {
    expectValid(baseWorkflow());
  });

  it("rejects a `branch` whose `outputSchema` is not its own `inputSchema`", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).outputSchema = NOTES;

    expectIssue(
      validate(workflow),
      ["nodes", "route", "outputSchema"],
      "because a `branch` is pass-through and outputs the value it routed",
    );
  });

  it("rejects a `chain` whose `outputSchema` is not its last step's", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "steps" };
    nodes.steps = { ...base("steps"), type: "chain", steps: ["stepA"], next: null };
    nodes.stepA = { ...codeNode("stepA"), outputSchema: NOTES };

    expectIssue(
      validate(workflow),
      ["nodes", "steps", "outputSchema"],
      "the `outputSchema` of its last step `stepA`",
    );
  });

  it("does not check a binding narrowed by `path`", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).input = { kind: "node", node: "classify", path: ["label"] };
    (nodes.finalize as Draft).inputSchema = NOTES;

    expectValid(workflow);
  });
});

describe("validateWorkflow: capability resolution (M4-T9)", () => {
  it("rejects an unregistered workflow-level schema", () => {
    const { workflow } = draft();
    workflow.inputSchema = "vendor.missing@1.0.0";

    expectIssue(validate(workflow), ["inputSchema"], "no `schema` capability");
  });

  it("rejects an unregistered node schema", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).outputSchema = "vendor.missing@1.0.0";

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "outputSchema"],
      "no `schema` capability",
    );
  });

  it("resolves exact versions only", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).handler = { id: "vendor.finalize", version: "2.0.0" };

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "handler"],
      "no `handler` capability `vendor.finalize@2.0.0` is registered",
    );
  });

  it("rejects a `branch` naming an unregistered policy", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).on = {
      kind: "policy",
      policy: { id: "vendor.missing", version: "1.0.0" },
    };

    expectIssue(validate(workflow), ["nodes", "route", "on", "policy"], "no `policy` capability");
  });

  it("rejects a `loop` naming an unregistered policy", () => {
    const { workflow, nodes } = draft();
    (nodes.route as Draft).cases = { clear: "refine" };
    nodes.refine = {
      ...base("refine"),
      type: "loop",
      body: "polish",
      maxIterations: 3,
      until: { kind: "policy", policy: { id: "vendor.missing", version: "1.0.0" } },
      next: "finalize",
    };
    nodes.polish = { ...codeNode("polish"), outputSchema: NOTES };

    expectIssue(
      validate(workflow),
      ["nodes", "refine", "until", "policy"],
      "no `policy` capability",
    );
  });

  it("rejects a node whose schemas contradict the ones its capability declares", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).handler = { id: "vendor.strict", version: "1.0.0" };
    (nodes.finalize as Draft).input = { kind: "node", node: "classify", path: ["label"] };
    (nodes.finalize as Draft).inputSchema = NOTES;

    expectIssue(
      validate(workflow),
      ["nodes", "finalize", "inputSchema"],
      "the `inputSchema` the `handler` capability `vendor.strict@1.0.0` declares",
    );
  });

  it("accepts a node whose schemas match the ones its capability declares", () => {
    const { workflow, nodes } = draft();
    (nodes.finalize as Draft).handler = { id: "vendor.strict", version: "1.0.0" };

    expectValid(workflow);
  });

  it("does not try to resolve a `jev` node's question", () => {
    const registry = createTestRegistry();

    expect(registry.has("policy", "vendor.is-clear@1.0.0")).toBe(false);
    expectValid(baseWorkflow(), registry);
  });
});

/**
 * The shape M4-T10 will author for real, compiled here against a registry built
 * the way `apps/example-agent` builds its own.
 *
 * The registry is rebuilt rather than imported: `packages/*` may not depend on
 * `apps/*`, so the test registers the same capability ids the example does plus
 * the four this workflow additionally needs.
 */
function createVendorTriageRegistry(): CapabilityRegistry {
  const registry = createCapabilityRegistry();

  for (const id of [
    "vendor-triage.input",
    "vendor-triage.output",
    "vendor-triage.classification",
    "vendor-triage.verification",
  ]) {
    registerSchema(registry, id);
  }

  registry.register("agent", {
    id: "vendor-triage-agent",
    version: "1.0.0",
    module: "apps/example-agent/agent/agent.ts",
    exportName: "default",
    inputSchema: { id: "vendor-triage.input", version: "1.0.0" },
    outputSchema: { id: "vendor-triage.output", version: "1.0.0" },
    permissions: ["read"],
    value: { framework: "eve" },
  });

  registry.register("tool", {
    id: "lookup_vendor_evidence",
    version: "1.0.0",
    module: "apps/example-agent/agent/tools/lookup_vendor_evidence.ts",
    exportName: "default",
    permissions: ["read"],
    value: () => null,
  });

  for (const id of ["detect-payment-detail-change", "vendor-triage.decide"]) {
    registry.register("handler", {
      id,
      version: "1.0.0",
      module: "apps/example-agent/src/handlers.ts",
      exportName: id,
      value: () => null,
    });
  }

  registry.register("policy", {
    id: "no-proceed-with-open-risk-flags",
    version: "1.0.0",
    module: "apps/example-agent/src/policies/no-proceed-with-open-risk-flags.ts",
    exportName: "noProceedWithOpenRiskFlags",
    value: () => "clear",
  });

  return registry;
}

describe("a vendor-triage-shaped workflow", () => {
  const vendorTriage = (): Draft => {
    const node = (id: string, inputSchema: string, outputSchema: string): Draft => ({
      id,
      version: "1.0.0",
      inputSchema,
      outputSchema,
      timeoutMs: 30_000,
      retry: { maxAttempts: 2, backoffMs: 250 },
      budget: {},
      permissions: [],
      input: { kind: "node", node: "classify" },
    });

    return {
      schemaVersion: 1,
      id: "vendor-triage",
      version: "1.0.0",
      domain: "vendor-triage",
      jobType: "triage",
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      entry: "classify",
      nodes: {
        classify: {
          ...node("classify", "vendor-triage.input@1.0.0", "vendor-triage.classification@1.0.0"),
          type: "jev",
          input: { kind: "input" },
          question: { id: "vendor.initial-classification", version: "1.0.0" },
          questionKind: "choice",
          next: "route",
        },
        route: {
          ...node(
            "route",
            "vendor-triage.classification@1.0.0",
            "vendor-triage.classification@1.0.0",
          ),
          type: "branch",
          on: {
            kind: "policy",
            policy: { id: "no-proceed-with-open-risk-flags", version: "1.0.0" },
          },
          cases: { clear: "finalize", research: "research", uncertain: "full-agent" },
          default: "full-agent",
        },
        finalize: {
          ...node("finalize", "vendor-triage.classification@1.0.0", "vendor-triage.output@1.0.0"),
          type: "code",
          handler: { id: "detect-payment-detail-change", version: "1.0.0" },
          next: null,
        },
        research: {
          ...node("research", "vendor-triage.input@1.0.0", "vendor-triage.output@1.0.0"),
          type: "agent",
          agent: { id: "vendor-triage-agent", version: "1.0.0" },
          input: { kind: "input" },
          permissions: [
            { toolId: "lookup_vendor_evidence", mode: "read" },
            { toolId: "load_skill", mode: "read" },
          ],
          next: "verify",
        },
        verify: {
          ...node("verify", "vendor-triage.output@1.0.0", "vendor-triage.verification@1.0.0"),
          type: "jev",
          input: { kind: "node", node: "research" },
          question: { id: "vendor.verify-evidence", version: "1.0.0" },
          questionKind: "boolean",
          next: "decide",
        },
        decide: {
          ...node("decide", "vendor-triage.verification@1.0.0", "vendor-triage.output@1.0.0"),
          type: "code",
          handler: { id: "vendor-triage.decide", version: "1.0.0" },
          input: { kind: "node", node: "verify" },
          next: null,
        },
        "full-agent": {
          ...node("full-agent", "vendor-triage.classification@1.0.0", "vendor-triage.output@1.0.0"),
          type: "escalate",
          reason: "classification was uncertain",
        },
      },
    };
  };

  it("compiles against a registry built the way the example domain builds its own", () => {
    const registry = createVendorTriageRegistry();

    expect(messagesOf(validateWorkflow(parseWorkflowDefinition(vendorTriage()), registry))).toEqual(
      [],
    );

    const compiled = compileWorkflow(vendorTriage(), registry);

    expect(compiled.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.keys(compiled.definition.nodes)).toHaveLength(7);
  });

  it("fails before execution when one capability is missing from the registry", () => {
    const registry = createVendorTriageRegistry();
    const workflow = vendorTriage();
    ((workflow.nodes as Draft).research as Draft).agent = {
      id: "vendor-triage-agent",
      version: "9.9.9",
    };

    expect(() => compileWorkflow(workflow, registry)).toThrow(ValidationError);
  });
});
