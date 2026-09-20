import { describe, expect, it } from "vitest";
import { ValidationError, type ValidationIssue } from "./errors.js";
import {
  canonicalWorkflowIr,
  FALLBACK_REASONS,
  isWorkflowDefinition,
  parseWorkflowDefinition,
  WORKFLOW_SCHEMA_VERSION,
  type WorkflowDefinition,
  workflowFingerprint,
} from "./workflow-ir.js";
import {
  CALL_EFFECTS,
  CONTROL_NODE_TYPES,
  isNodeId,
  MAX_BINDING_DEPTH,
  NODE_TYPES,
  RESERVED_NODE_TYPES,
  type WorkflowNode,
} from "./workflow-nodes.js";

/**
 * The base fields every node carries, as a plain JSON object a test can spread.
 *
 * Written as data rather than built by a helper with options, because the point
 * of most of these tests is what happens when one field is wrong, and a literal
 * keeps the wrong field visible at the call site.
 */
function base(id: string): Record<string, unknown> {
  return {
    id,
    version: "1.0.0",
    inputSchema: "vendor-triage.input@1.0.0",
    outputSchema: "vendor-triage.output@1.0.0",
    timeoutMs: 30_000,
    retry: { maxAttempts: 1 },
    budget: {},
    permissions: [],
    input: { kind: "input" },
  };
}

/**
 * A workflow exercising all eleven node types, every binding kind and both
 * selector forms.
 *
 * It is not a *valid graph* — several edges point at nodes chosen for coverage
 * rather than for sense — and that is deliberate: `parseWorkflowDefinition` is a
 * shape boundary, and a fixture that also had to be a runnable workflow would
 * make these tests depend on rules the validator owns.
 */
function fullDefinition(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "vendor-triage",
    version: "1.2.3",
    domain: "vendor-triage",
    jobType: "triage",
    inputSchema: "vendor-triage.input@1.0.0",
    outputSchema: "vendor-triage.output@1.0.0",
    entry: "classify",
    nodes: {
      classify: {
        ...base("classify"),
        type: "jev",
        question: { id: "vendor.is-clear", version: "1.0.0" },
        questionKind: "boolean",
        next: "route",
      },
      route: {
        ...base("route"),
        type: "branch",
        on: { kind: "field", path: ["classification", "label"] },
        cases: { clear: "finalize", research: "research", uncertain: "give-up" },
        default: "give-up",
      },
      finalize: {
        ...base("finalize"),
        type: "code",
        handler: { id: "vendor.finalize", version: "2.0.0" },
        next: null,
      },
      research: {
        ...base("research"),
        type: "agent",
        agent: { id: "vendor-researcher", version: "1.0.0" },
        permissions: [{ toolId: "lookup_vendor_evidence", mode: "read" }],
        next: "record",
      },
      record: {
        ...base("record"),
        type: "artifact",
        name: "research-notes",
        contentType: "application/json",
        next: "file-ticket",
      },
      "file-ticket": {
        ...base("file-ticket"),
        type: "call",
        tool: { id: "ticketing.create", version: "3.1.0" },
        effect: "non-idempotent-write",
        protection: { kind: "idempotency-key" },
        permissions: [{ toolId: "ticketing.create", mode: "write", scope: "procurement" }],
        next: "steps",
      },
      steps: {
        ...base("steps"),
        type: "chain",
        steps: ["finalize", "record"],
        next: "each",
      },
      each: {
        ...base("each"),
        type: "map",
        items: { kind: "node", node: "research", path: ["candidates"] },
        body: "finalize",
        maxItems: 50,
        concurrency: 4,
        next: "fold",
      },
      fold: {
        ...base("fold"),
        type: "reduce",
        items: { kind: "literal", value: [1, 2, 3] },
        handler: { id: "vendor.merge", version: "1.0.0" },
        initial: { total: 0 },
        next: "refine",
      },
      refine: {
        ...base("refine"),
        type: "loop",
        input: {
          kind: "object",
          fields: { seed: { kind: "item" }, prior: { kind: "node", node: "fold" } },
        },
        body: "finalize",
        maxIterations: 5,
        until: { kind: "policy", policy: { id: "vendor.is-done", version: "1.0.0" } },
        next: null,
      },
      "give-up": {
        ...base("give-up"),
        type: "escalate",
        reason: "classification was uncertain",
      },
    },
  };
}

/** The issues a rejected value produced, so a test can assert on paths. */
function issuesOf(value: unknown): readonly ValidationIssue[] {
  try {
    parseWorkflowDefinition(value);
  } catch (error) {
    if (error instanceof ValidationError) {
      return error.issues;
    }
    throw error;
  }

  throw new Error("expected parseWorkflowDefinition to throw");
}

/**
 * One node of a parsed definition, by id.
 *
 * `noUncheckedIndexedAccess` types every lookup into `nodes` as possibly
 * `undefined`, which is correct for real code and only noise in a test that
 * knows the fixture. Failing loudly here keeps the assertion that follows
 * meaningful.
 */
function nodeOf(definition: WorkflowDefinition, id: string): WorkflowNode {
  const node = definition.nodes[id];

  if (node === undefined) {
    throw new Error(`the fixture has no node \`${id}\``);
  }

  return node;
}

/** Replace one node of the full fixture, keeping everything else. */
function withNode(id: string, node: Record<string, unknown>): Record<string, unknown> {
  const definition = fullDefinition();
  const nodes = definition.nodes as Record<string, unknown>;

  return { ...definition, nodes: { ...nodes, [id]: node } };
}

describe("parseWorkflowDefinition", () => {
  it("round-trips a definition covering every node type", () => {
    const parsed = parseWorkflowDefinition(fullDefinition());

    expect(parsed.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
    expect(parsed.id).toBe("vendor-triage");
    expect(parsed.version).toBe("1.2.3");
    expect(parsed.entry).toBe("classify");
    expect(Object.keys(parsed.nodes).sort()).toEqual(
      [
        "classify",
        "each",
        "file-ticket",
        "finalize",
        "fold",
        "give-up",
        "record",
        "refine",
        "research",
        "route",
        "steps",
      ].sort(),
    );
    // Every node type appears exactly once, so the fixture cannot quietly stop
    // covering one.
    expect(
      Object.values(parsed.nodes)
        .map((node) => node.type)
        .sort(),
    ).toEqual([...NODE_TYPES].sort());
  });

  it("survives a JSON round trip unchanged", () => {
    const parsed = parseWorkflowDefinition(fullDefinition());
    const reparsed = parseWorkflowDefinition(JSON.parse(JSON.stringify(parsed)));

    expect(reparsed).toEqual(parsed);
    expect(canonicalWorkflowIr(reparsed)).toBe(canonicalWorkflowIr(parsed));
  });

  it("deep-freezes the definition it returns", () => {
    const parsed = parseWorkflowDefinition(fullDefinition());
    const node = nodeOf(parsed, "classify");

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.nodes)).toBe(true);
    expect(Object.isFrozen(node)).toBe(true);
    // The depth that matters: a nested retry policy, budget and grant.
    expect(() => {
      (node as { retry: { maxAttempts: number } }).retry.maxAttempts = 99;
    }).toThrow(TypeError);
    const grants = nodeOf(parsed, "research").permissions as unknown as { mode: string }[];

    expect(() => {
      grants[0] = { mode: "write" };
    }).toThrow(TypeError);
    expect(Object.isFrozen(grants[0])).toBe(true);
  });

  it("drops nothing and adds nothing: the result is the fields it validated", () => {
    const parsed = parseWorkflowDefinition(fullDefinition());

    expect(Object.keys(parsed).sort()).toEqual([
      "domain",
      "entry",
      "id",
      "inputSchema",
      "jobType",
      "nodes",
      "outputSchema",
      "schemaVersion",
      "version",
    ]);
    // An absent optional stays absent rather than becoming `undefined`, which is
    // what keeps the canonical bytes a function of the contract.
    expect("protection" in nodeOf(parsed, "finalize")).toBe(false);
    expect("concurrency" in nodeOf(parsed, "fold")).toBe(false);
  });

  describe("unknown fields", () => {
    it("rejects one at the top level, with its path", () => {
      const issues = issuesOf({ ...fullDefinition(), createdAt: "2026-09-20" });

      expect(issues).toContainEqual({ path: ["createdAt"], message: "unknown field" });
    });

    it("rejects one on a node, with its path", () => {
      const issues = issuesOf(
        withNode("finalize", {
          ...base("finalize"),
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: null,
          cache: true,
        }),
      );

      expect(issues).toContainEqual({
        path: ["nodes", "finalize", "cache"],
        message: "unknown field",
      });
    });

    it("rejects one on a retry policy, with its path", () => {
      const issues = issuesOf(
        withNode("finalize", {
          ...base("finalize"),
          retry: { maxAttempts: 2, jitterMs: 10 },
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: null,
        }),
      );

      expect(issues).toContainEqual({
        path: ["nodes", "finalize", "retry", "jitterMs"],
        message: "unknown field",
      });
    });

    it("rejects one on a binding, with its path", () => {
      const issues = issuesOf(
        withNode("finalize", {
          ...base("finalize"),
          input: { kind: "node", node: "classify", path: ["label"], fallback: null },
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: null,
        }),
      );

      expect(issues).toContainEqual({
        path: ["nodes", "finalize", "input", "fallback"],
        message: "unknown field",
      });
    });

    it("rejects one nested inside an object binding, with its path", () => {
      const issues = issuesOf(
        withNode("finalize", {
          ...base("finalize"),
          input: {
            kind: "object",
            fields: { seed: { kind: "literal", value: 1, coerce: true } },
          },
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: null,
        }),
      );

      expect(issues).toContainEqual({
        path: ["nodes", "finalize", "input", "fields", "seed", "coerce"],
        message: "unknown field",
      });
    });

    it("rejects a field a different node type owns", () => {
      // `effect` belongs to `call`, not to `code`: a node may not borrow another
      // type's fields, which is what makes the union closed in fact.
      const issues = issuesOf(
        withNode("finalize", {
          ...base("finalize"),
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: null,
          effect: "read-only",
        }),
      );

      expect(issues).toContainEqual({
        path: ["nodes", "finalize", "effect"],
        message: "unknown field",
      });
    });

    it("rejects `next` on the two types that do not have one", () => {
      const escalate = issuesOf(
        withNode("give-up", {
          ...base("give-up"),
          type: "escalate",
          reason: "uncertain",
          next: null,
        }),
      );
      const branch = issuesOf(
        withNode("route", {
          ...base("route"),
          type: "branch",
          on: { kind: "field", path: ["label"] },
          cases: { clear: "finalize" },
          default: "give-up",
          next: "finalize",
        }),
      );

      expect(escalate).toContainEqual({
        path: ["nodes", "give-up", "next"],
        message: "unknown field",
      });
      expect(branch).toContainEqual({ path: ["nodes", "route", "next"], message: "unknown field" });
    });
  });

  describe("reserved node types", () => {
    for (const type of RESERVED_NODE_TYPES) {
      it(`rejects \`${type}\` with the reserved message`, () => {
        const issues = issuesOf(withNode("finalize", { ...base("finalize"), type }));

        expect(issues).toEqual([
          {
            path: ["nodes", "finalize", "type"],
            message: `\`${type}\` is reserved for a later milestone and cannot be used yet`,
          },
        ]);
      });
    }

    it("rejects an unrecognized type with a different message", () => {
      const issues = issuesOf(withNode("finalize", { ...base("finalize"), type: "sql" }));

      expect(issues[0]?.message).toContain("expected one of");
      expect(issues[0]?.message).not.toContain("reserved");
    });
  });

  describe("required fields per node type", () => {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, readonly string[]]> = [
      ["code", { type: "code", next: null }, ["handler"]],
      ["call", { type: "call", tool: { id: "t", version: "1.0.0" }, next: null }, ["effect"]],
      [
        "jev",
        { type: "jev", question: { id: "q", version: "1.0.0" }, next: null },
        ["questionKind"],
      ],
      ["agent", { type: "agent", next: null }, ["agent"]],
      ["artifact", { type: "artifact", next: null }, ["name"]],
      ["escalate", { type: "escalate" }, ["reason"]],
      ["chain", { type: "chain", next: null }, ["steps"]],
      ["branch", { type: "branch", cases: { a: "finalize" } }, ["on"]],
      ["map", { type: "map", body: "finalize", maxItems: 1, next: null }, ["items"]],
      [
        "reduce",
        { type: "reduce", items: { kind: "input" }, initial: null, next: null },
        ["handler"],
      ],
      ["loop", { type: "loop", body: "finalize", maxIterations: 2, next: null }, ["until"]],
    ];

    for (const [name, node, missing] of cases) {
      it(`rejects a \`${name}\` node missing ${missing.join(", ")}`, () => {
        const issues = issuesOf(withNode("finalize", { ...base("finalize"), ...node }));

        for (const field of missing) {
          expect(issues.some((issue) => issue.path.at(-1) === field)).toBe(true);
        }
      });
    }

    it("accepts every effect a `call` node may declare", () => {
      for (const effect of CALL_EFFECTS) {
        const parsed = parseWorkflowDefinition(
          withNode("file-ticket", {
            ...base("file-ticket"),
            type: "call",
            tool: { id: "ticketing.create", version: "3.1.0" },
            effect,
            next: null,
          }),
        );

        expect(parsed.nodes["file-ticket"]).toMatchObject({ type: "call", effect });
      }
    });

    it("rejects a protection that is not an idempotency key", () => {
      const issues = issuesOf(
        withNode("file-ticket", {
          ...base("file-ticket"),
          type: "call",
          tool: { id: "ticketing.create", version: "3.1.0" },
          effect: "non-idempotent-write",
          protection: { kind: "two-phase-commit" },
          next: null,
        }),
      );

      expect(issues).toContainEqual({
        path: ["nodes", "file-ticket", "protection"],
        message: 'expected `{ kind: "idempotency-key" }`',
      });
    });

    it("rejects an empty `steps`, `cases` or non-positive bound", () => {
      expect(
        issuesOf(withNode("steps", { ...base("steps"), type: "chain", steps: [], next: null })),
      ).toContainEqual({
        path: ["nodes", "steps", "steps"],
        message: "expected at least one step",
      });

      expect(
        issuesOf(
          withNode("route", {
            ...base("route"),
            type: "branch",
            on: { kind: "field", path: ["label"] },
            cases: {},
          }),
        ),
      ).toContainEqual({
        path: ["nodes", "route", "cases"],
        message: "expected at least one case",
      });

      expect(
        issuesOf(
          withNode("refine", {
            ...base("refine"),
            type: "loop",
            body: "finalize",
            maxIterations: 0,
            until: { kind: "field", path: ["done"], equals: true },
            next: null,
          }),
        ),
      ).toContainEqual({
        path: ["nodes", "refine", "maxIterations"],
        message: "expected a whole number >= 1",
      });
    });

    it("rejects a fractional timeout and a zero `maxAttempts`", () => {
      const issues = issuesOf(
        withNode("finalize", {
          ...base("finalize"),
          timeoutMs: 1.5,
          retry: { maxAttempts: 0 },
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: null,
        }),
      );

      expect(issues).toContainEqual({
        path: ["nodes", "finalize", "timeoutMs"],
        message: "expected a whole number >= 1",
      });
      expect(issues).toContainEqual({
        path: ["nodes", "finalize", "retry", "maxAttempts"],
        message: "expected a whole number >= 1",
      });
    });
  });

  describe("node keys and ids", () => {
    it("rejects a node whose `id` differs from its key", () => {
      const definition = fullDefinition();
      const nodes = definition.nodes as Record<string, Record<string, unknown>>;
      const issues = issuesOf({
        ...definition,
        nodes: { ...nodes, finalize: { ...nodes.finalize, id: "something-else" } },
      });

      expect(issues).toContainEqual({
        path: ["nodes", "finalize", "id"],
        message: "expected `finalize`, matching this node's key in `nodes`",
      });
    });

    it("rejects a key that is not a well-formed node id", () => {
      const definition = fullDefinition();
      const nodes = definition.nodes as Record<string, unknown>;
      const issues = issuesOf({ ...definition, nodes: { ...nodes, "not a node id": {} } });

      expect(issues.some((issue) => issue.path.at(-1) === "not a node id")).toBe(true);
    });

    it("rejects an empty `nodes` map", () => {
      const issues = issuesOf({ ...fullDefinition(), nodes: {} });

      expect(issues).toEqual([{ path: ["nodes"], message: "expected at least one node" }]);
    });
  });

  describe("top-level fields", () => {
    it("rejects a `schemaVersion` other than 1", () => {
      const issues = issuesOf({ ...fullDefinition(), schemaVersion: 2 });

      expect(issues).toContainEqual({
        path: ["schemaVersion"],
        message: "expected 1, the only workflow IR format this version understands",
      });
    });

    it("rejects a non-exact `version`", () => {
      for (const version of ["^1.0.0", "1.0", "1.0.0-beta.1", "latest", 1]) {
        expect(
          issuesOf({ ...fullDefinition(), version }).some(
            (issue) => issue.path.at(-1) === "version",
          ),
        ).toBe(true);
      }
    });

    it("rejects a schema reference that is not `id@version`", () => {
      for (const reference of ["vendor-triage.input", "a@b@c", "vendor@^1.0.0", 7]) {
        expect(
          issuesOf({ ...fullDefinition(), inputSchema: reference }).some(
            (issue) => issue.path.at(-1) === "inputSchema",
          ),
        ).toBe(true);
      }
    });

    it("rejects a malformed `id`, `domain`, `jobType` or `entry`", () => {
      for (const field of ["id", "domain", "jobType", "entry"] as const) {
        const issues = issuesOf({ ...fullDefinition(), [field]: "not valid!" });

        expect(issues.some((issue) => issue.path.at(-1) === field)).toBe(true);
      }
    });

    it("reports every problem at once rather than only the first", () => {
      const issues = issuesOf({
        ...fullDefinition(),
        schemaVersion: 2,
        version: "nope",
        entry: "",
      });

      expect(issues.length).toBeGreaterThanOrEqual(3);
    });

    it("rejects a value that is not an object at all", () => {
      for (const value of [null, 7, "workflow", [], undefined]) {
        expect(issuesOf(value)).toEqual([
          { path: [], message: "expected a workflow definition object" },
        ]);
      }
    });
  });

  describe("JSON representability", () => {
    it("rejects a `Date`, a non-finite number and a cycle", () => {
      const withDate = withNode("finalize", {
        ...base("finalize"),
        input: { kind: "literal", value: new Date() },
        type: "code",
        handler: { id: "vendor.finalize", version: "2.0.0" },
        next: null,
      });

      const cyclic = fullDefinition();
      (cyclic as Record<string, unknown>).nodes = cyclic.nodes;
      (cyclic.nodes as Record<string, unknown>).self = cyclic;

      for (const value of [withDate, { ...fullDefinition(), extra: Number.NaN }, cyclic]) {
        expect(issuesOf(value)[0]?.message).toContain("expected a JSON value");
      }
    });

    it("rejects a binding literal that is not JSON", () => {
      const issues = issuesOf(
        withNode("finalize", {
          ...base("finalize"),
          input: { kind: "literal", value: Number.POSITIVE_INFINITY },
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: null,
        }),
      );

      // The whole-value guard catches it first, which is correct: a non-finite
      // number anywhere makes the definition uncanonicalizable.
      expect(issues[0]?.message).toContain("expected a JSON value");
    });

    it("bounds binding nesting rather than overflowing the stack", () => {
      let input: unknown = { kind: "input" };

      for (let depth = 0; depth <= MAX_BINDING_DEPTH + 1; depth += 1) {
        input = { kind: "object", fields: { nested: input } };
      }

      const issues = issuesOf(
        withNode("finalize", {
          ...base("finalize"),
          input,
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: null,
        }),
      );

      expect(
        issues.some((issue) => issue.message.includes("binding nesting exceeds the limit")),
      ).toBe(true);
    });
  });
});

describe("what parse deliberately leaves to the validator", () => {
  // These are well-formed *values* and invalid *workflows*. Each one is a rule
  // `compileWorkflow()` (M4-T4, M4-T9) enforces, and pinning them here is what
  // stops someone adding a graph check to the parse boundary by accident.
  it("accepts an `entry` that names no node", () => {
    expect(() =>
      parseWorkflowDefinition({ ...fullDefinition(), entry: "nonexistent" }),
    ).not.toThrow();
  });

  it("accepts a `next` pointing at no node", () => {
    expect(() =>
      parseWorkflowDefinition(
        withNode("finalize", {
          ...base("finalize"),
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          next: "nonexistent",
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a `code` node carrying tool grants", () => {
    expect(() =>
      parseWorkflowDefinition(
        withNode("finalize", {
          ...base("finalize"),
          type: "code",
          handler: { id: "vendor.finalize", version: "2.0.0" },
          permissions: [{ toolId: "ticketing.create", mode: "write" }],
          next: null,
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a `non-idempotent-write` call with no protection", () => {
    expect(() =>
      parseWorkflowDefinition(
        withNode("file-ticket", {
          ...base("file-ticket"),
          type: "call",
          tool: { id: "ticketing.create", version: "3.1.0" },
          effect: "non-idempotent-write",
          next: null,
        }),
      ),
    ).not.toThrow();
  });

  it("accepts a `branch` with no `default`", () => {
    expect(() =>
      parseWorkflowDefinition(
        withNode("route", {
          ...base("route"),
          type: "branch",
          on: { kind: "field", path: ["label"] },
          cases: { clear: "finalize" },
        }),
      ),
    ).not.toThrow();
  });

  it("accepts an unregistered capability reference", () => {
    expect(() =>
      parseWorkflowDefinition(
        withNode("finalize", {
          ...base("finalize"),
          type: "code",
          handler: { id: "nothing.registered.under.this", version: "9.9.9" },
          next: null,
        }),
      ),
    ).not.toThrow();
  });
});

describe("isWorkflowDefinition", () => {
  it("agrees with parseWorkflowDefinition on every case", () => {
    const cases: readonly unknown[] = [
      fullDefinition(),
      { ...fullDefinition(), schemaVersion: 2 },
      { ...fullDefinition(), createdAt: "2026-09-20" },
      { ...fullDefinition(), nodes: {} },
      withNode("finalize", { ...base("finalize"), type: "human" }),
      null,
      "workflow",
      7,
    ];

    for (const value of cases) {
      let parsed = true;
      try {
        parseWorkflowDefinition(value);
      } catch {
        parsed = false;
      }

      expect(isWorkflowDefinition(value)).toBe(parsed);
    }
  });

  it("freezes nothing", () => {
    const definition = fullDefinition();

    expect(isWorkflowDefinition(definition)).toBe(true);
    expect(Object.isFrozen(definition)).toBe(false);
  });
});

describe("canonicalWorkflowIr and workflowFingerprint", () => {
  /** The same workflow with every object literal's keys in a different order. */
  function reordered(): Record<string, unknown> {
    const definition = fullDefinition();
    const nodes = definition.nodes as Record<string, Record<string, unknown>>;
    const flipped: Record<string, unknown> = {};

    // Reverse the key order of the `nodes` map and of every node in it.
    for (const key of Object.keys(nodes).reverse()) {
      const node = nodes[key] ?? {};
      const flippedNode: Record<string, unknown> = {};

      for (const field of Object.keys(node).reverse()) {
        flippedNode[field] = node[field];
      }

      flipped[key] = flippedNode;
    }

    return {
      nodes: flipped,
      entry: definition.entry,
      outputSchema: definition.outputSchema,
      inputSchema: definition.inputSchema,
      jobType: definition.jobType,
      domain: definition.domain,
      version: definition.version,
      id: definition.id,
      schemaVersion: definition.schemaVersion,
    };
  }

  it("is independent of key order", () => {
    expect(canonicalWorkflowIr(reordered())).toBe(canonicalWorkflowIr(fullDefinition()));
    expect(workflowFingerprint(reordered())).toBe(workflowFingerprint(fullDefinition()));
  });

  it("produces a `sha256:`-prefixed digest of the canonical bytes", () => {
    const digest = workflowFingerprint(fullDefinition());

    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("changes when any one field changes", () => {
    const baseline = workflowFingerprint(fullDefinition());

    const variants: readonly Record<string, unknown>[] = [
      { ...fullDefinition(), version: "1.2.4" },
      { ...fullDefinition(), jobType: "retriage" },
      withNode("finalize", {
        ...base("finalize"),
        timeoutMs: 30_001,
        type: "code",
        handler: { id: "vendor.finalize", version: "2.0.0" },
        next: null,
      }),
      // Narrowing a node's permissions is a behavior change (invariant 4).
      withNode("research", {
        ...base("research"),
        type: "agent",
        agent: { id: "vendor-researcher", version: "1.0.0" },
        permissions: [],
        next: "record",
      }),
    ];

    for (const variant of variants) {
      expect(workflowFingerprint(variant)).not.toBe(baseline);
    }
  });

  it("is stable across a JSON round trip", () => {
    const parsed = parseWorkflowDefinition(fullDefinition());

    expect(workflowFingerprint(JSON.parse(JSON.stringify(parsed)))).toBe(
      workflowFingerprint(fullDefinition()),
    );
  });

  it("refuses to canonicalize or fingerprint an invalid workflow", () => {
    expect(() => canonicalWorkflowIr({ ...fullDefinition(), schemaVersion: 2 })).toThrow(
      ValidationError,
    );
    expect(() => workflowFingerprint({ ...fullDefinition(), createdAt: "x" })).toThrow(
      ValidationError,
    );
  });

  it("emits canonical bytes with sorted keys", () => {
    const canonical = canonicalWorkflowIr(fullDefinition());

    expect(canonical.startsWith('{"domain":')).toBe(true);
    expect(JSON.parse(canonical)).toEqual(JSON.parse(JSON.stringify(fullDefinition())));
  });
});

describe("the IR's closed vocabularies", () => {
  it("lists eleven node types, of which five are control shapes", () => {
    expect(NODE_TYPES).toHaveLength(11);
    expect(CONTROL_NODE_TYPES).toHaveLength(5);
    expect(NODE_TYPES).toEqual(expect.arrayContaining([...CONTROL_NODE_TYPES]));
  });

  it("reserves exactly `human` and `subworkflow`", () => {
    expect([...RESERVED_NODE_TYPES]).toEqual(["human", "subworkflow"]);
    for (const reserved of RESERVED_NODE_TYPES) {
      expect(NODE_TYPES).not.toContain(reserved);
    }
  });

  it("names six fallback reasons", () => {
    expect(FALLBACK_REASONS).toHaveLength(6);
    expect(FALLBACK_REASONS).toContain("escalate-node");
  });

  it("accepts the node ids a workflow actually uses", () => {
    expect(isNodeId("initial-classification")).toBe(true);
    expect(isNodeId("node_1.a")).toBe(true);
    expect(isNodeId("")).toBe(false);
    expect(isNodeId("-leading")).toBe(false);
    expect(isNodeId("has space")).toBe(false);
    expect(isNodeId("has@at")).toBe(false);
  });
});
