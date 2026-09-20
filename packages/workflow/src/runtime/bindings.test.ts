import type { NodeId } from "@internal/core";
import { WorkflowError } from "@internal/core";
import { describe, expect, it } from "vitest";
import {
  asJsonValue,
  type BindingScope,
  evaluateBinding,
  readPath,
  traceValue,
} from "./bindings.js";

/**
 * The binding evaluator (M4-T6's "evaluate the node's input").
 *
 * `docs/contracts/workflow-ir.md` fixes the shape of a binding; what these tests
 * pin down is the runtime's answer to the questions the contract leaves open —
 * what a missing key yields, what an `item` binding outside a `map` does, and
 * what an `object` binding does with a field that resolved to nothing.
 */

const EMPTY: BindingScope = { input: null, nodes: new Map() };

function scope(overrides: Partial<BindingScope> = {}): BindingScope {
  return { ...EMPTY, ...overrides };
}

const NODE: NodeId = "consumer";

describe("readPath", () => {
  it("narrows through nested objects", () => {
    expect(readPath({ a: { b: { c: 1 } } }, ["a", "b", "c"])).toBe(1);
  });

  it("returns the value unchanged for an empty path", () => {
    expect(readPath({ a: 1 }, [])).toEqual({ a: 1 });
  });

  it("yields undefined for an absent key", () => {
    expect(readPath({ a: 1 }, ["b"])).toBeUndefined();
  });

  it("yields undefined when narrowing through anything that is not a plain object", () => {
    expect(readPath("text", ["length"])).toBeUndefined();
    expect(readPath([1, 2, 3], ["0"])).toBeUndefined();
    expect(readPath(null, ["a"])).toBeUndefined();
    expect(readPath({ a: null }, ["a", "b"])).toBeUndefined();
  });
});

describe("evaluateBinding", () => {
  it("reads the whole job input", () => {
    expect(evaluateBinding({ kind: "input" }, scope({ input: { v: 1 } }), NODE)).toEqual({ v: 1 });
  });

  it("reads a literal, which the fingerprint covers", () => {
    expect(evaluateBinding({ kind: "literal", value: { fixed: true } }, EMPTY, NODE)).toEqual({
      fixed: true,
    });
  });

  it("reads another node's whole output", () => {
    const nodes = new Map<NodeId, unknown>([["classify", { label: "clear" }]]);

    expect(evaluateBinding({ kind: "node", node: "classify" }, scope({ nodes }), NODE)).toEqual({
      label: "clear",
    });
  });

  it("narrows another node's output by path", () => {
    const nodes = new Map<NodeId, unknown>([["classify", { label: "clear" }]]);

    expect(
      evaluateBinding({ kind: "node", node: "classify", path: ["label"] }, scope({ nodes }), NODE),
    ).toBe("clear");
  });

  it("yields undefined for a path into a node output that has no such key", () => {
    const nodes = new Map<NodeId, unknown>([["classify", { label: "clear" }]]);

    expect(
      evaluateBinding(
        { kind: "node", node: "classify", path: ["missing"] },
        scope({ nodes }),
        NODE,
      ),
    ).toBeUndefined();
  });

  it("distinguishes a node whose output is undefined from one that never ran", () => {
    const nodes = new Map<NodeId, unknown>([["ran", undefined]]);

    expect(evaluateBinding({ kind: "node", node: "ran" }, scope({ nodes }), NODE)).toBeUndefined();
    expect(() => evaluateBinding({ kind: "node", node: "never" }, scope({ nodes }), NODE)).toThrow(
      WorkflowError,
    );
  });

  it("reads the current map element", () => {
    expect(evaluateBinding({ kind: "item" }, scope({ item: { value: "a", index: 0 } }), NODE)).toBe(
      "a",
    );
  });

  it("refuses an `item` binding outside a map body, which is a graph defect", () => {
    expect(() => evaluateBinding({ kind: "item" }, EMPTY, NODE)).toThrow(
      /`item` binding was evaluated outside a `map` body/,
    );
  });

  it("assembles an object from other bindings", () => {
    const nodes = new Map<NodeId, unknown>([["classify", { label: "clear" }]]);

    expect(
      evaluateBinding(
        {
          kind: "object",
          fields: {
            candidate: { kind: "input" },
            prior: { kind: "node", node: "classify", path: ["label"] },
            fixed: { kind: "literal", value: 7 },
          },
        },
        scope({ input: { vendor: "acme" }, nodes }),
        NODE,
      ),
    ).toEqual({ candidate: { vendor: "acme" }, prior: "clear", fixed: 7 });
  });

  it("omits an object field whose binding resolved to nothing", () => {
    const nodes = new Map<NodeId, unknown>([["classify", {}]]);
    const assembled = evaluateBinding(
      {
        kind: "object",
        fields: {
          present: { kind: "literal", value: 1 },
          absent: { kind: "node", node: "classify", path: ["nope"] },
        },
      },
      scope({ nodes }),
      NODE,
    );

    // Omitted rather than written as `undefined`, so the in-memory value and
    // its serialized form agree before the node's schema sees it.
    expect(Object.keys(assembled as object)).toEqual(["present"]);
  });

  it("nests object bindings", () => {
    expect(
      evaluateBinding(
        {
          kind: "object",
          fields: { outer: { kind: "object", fields: { inner: { kind: "literal", value: 1 } } } },
        },
        EMPTY,
        NODE,
      ),
    ).toEqual({ outer: { inner: 1 } });
  });
});

describe("asJsonValue", () => {
  it("returns a JSON value unchanged", () => {
    expect(asJsonValue({ a: [1, "two", null] }, NODE, "input")).toEqual({ a: [1, "two", null] });
  });

  it("refuses a value JSON cannot represent, naming the node", () => {
    expect(() => asJsonValue(() => 1, NODE, "input")).toThrow(WorkflowError);
    expect(() => asJsonValue(new Date(), NODE, "input")).toThrow(/not JSON-representable/);
  });
});

describe("traceValue", () => {
  it("passes a JSON value through", () => {
    expect(traceValue({ a: 1 })).toEqual({ a: 1 });
  });

  it("describes a non-JSON value rather than failing the trace event", () => {
    expect(traceValue(() => 1)).toEqual({ unserializable: "function" });
    expect(traceValue(undefined)).toBeNull();
  });
});
