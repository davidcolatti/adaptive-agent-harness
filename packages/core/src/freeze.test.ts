import { describe, expect, it } from "vitest";
import { deepFreeze } from "./freeze.js";

/**
 * Every module in this repository is an ES module and is therefore strict, so
 * assigning to a frozen object's property throws a `TypeError` rather than
 * failing silently. That is what makes deep immutability a guarantee a test can
 * assert rather than a convention.
 */

describe("deepFreeze", () => {
  it("returns the value it was given, not a copy", () => {
    const value = { a: 1 };

    expect(deepFreeze(value)).toBe(value);
  });

  it("freezes the top level", () => {
    const value = deepFreeze({ a: 1 });

    expect(Object.isFrozen(value)).toBe(true);
    expect(() => {
      value.a = 2;
    }).toThrow(TypeError);
  });

  it("freezes a nested object, which `Object.freeze` alone does not", () => {
    const shallow = Object.freeze({ budget: { maxCostUsd: 1 } });
    const deep = deepFreeze({ budget: { maxCostUsd: 1 } });

    // The reason this module exists: the shallow freeze permits exactly the
    // mutation that would widen what an execution may spend.
    shallow.budget.maxCostUsd = 1e9;
    expect(shallow.budget.maxCostUsd).toBe(1e9);

    expect(() => {
      deep.budget.maxCostUsd = 1e9;
    }).toThrow(TypeError);
  });

  it("freezes arrays and the objects inside them", () => {
    const value = deepFreeze({ permissions: [{ toolId: "lookup", mode: "read" }] });

    expect(Object.isFrozen(value.permissions)).toBe(true);
    expect(() => {
      value.permissions.push({ toolId: "deploy", mode: "write" });
    }).toThrow(TypeError);
    expect(() => {
      (value.permissions[0] as { mode: string }).mode = "write";
    }).toThrow(TypeError);
  });

  it("reaches arbitrary depth", () => {
    const value = deepFreeze({ a: { b: { c: [{ d: 1 }] } } });

    expect(() => {
      (value.a.b.c[0] as { d: number }).d = 2;
    }).toThrow(TypeError);
  });

  it("leaves a `Date` alone rather than pretending to freeze it", () => {
    const at = new Date(0);
    const value = deepFreeze({ at });

    // `Object.freeze` cannot stop `setTime`, because a `Date`'s state lives in
    // an internal slot rather than in a property. Freezing it would advertise
    // protection that is not there, so it is deliberately not frozen.
    expect(Object.isFrozen(value.at)).toBe(false);
    value.at.setTime(1000);
    expect(value.at.getTime()).toBe(1000);

    // The object holding it is still frozen: the reference cannot be replaced.
    expect(() => {
      value.at = new Date(2000);
    }).toThrow(TypeError);
  });

  it("leaves a class instance and a `Map` alone", () => {
    class Cache {
      value = 1;
    }

    const value = deepFreeze({ cache: new Cache(), map: new Map([["a", 1]]) });

    expect(Object.isFrozen(value.cache)).toBe(false);
    expect(Object.isFrozen(value.map)).toBe(false);
  });

  it("terminates on a cycle", () => {
    const value: { self?: unknown; a: number } = { a: 1 };
    value.self = value;

    expect(() => deepFreeze(value)).not.toThrow();
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("freezes a shared child once and still freezes it", () => {
    const shared = { n: 1 };
    const value = deepFreeze({ left: shared, right: shared });

    expect(Object.isFrozen(value.left)).toBe(true);
    expect(value.left).toBe(value.right);
  });

  it("descends into an already-frozen object, because its children may not be", () => {
    const value = deepFreeze({ outer: Object.freeze({ inner: { n: 1 } }) });

    expect(() => {
      value.outer.inner.n = 2;
    }).toThrow(TypeError);
  });

  it("accepts a primitive unchanged", () => {
    expect(deepFreeze(1)).toBe(1);
    expect(deepFreeze("a")).toBe("a");
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze(undefined)).toBe(undefined);
  });
});
