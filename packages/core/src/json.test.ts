import { describe, expect, expectTypeOf, it } from "vitest";
import type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "./json.js";
import { isJsonObject, isJsonValue, isPlainObject } from "./json.js";

/**
 * These assertions are checked by `tsc --noEmit`, because
 * `packages/core/tsconfig.json` includes co-located tests. Vitest runs them as
 * a no-op at runtime; the value is that a change to the JSON model that breaks
 * an invariant below fails `pnpm typecheck`, not just review.
 */
describe("the JSON value model", () => {
  it("admits every JSON shape", () => {
    expectTypeOf<JsonPrimitive>().toExtend<JsonValue>();
    expectTypeOf<JsonArray>().toExtend<JsonValue>();
    expectTypeOf<JsonObject>().toExtend<JsonValue>();
    expectTypeOf<string | number | boolean | null>().toEqualTypeOf<JsonPrimitive>();
  });

  it("nests without losing precision", () => {
    expectTypeOf<{ a: { b: readonly [1, "two", true, null] } }>().toExtend<JsonValue>();
    expectTypeOf<readonly JsonObject[]>().toExtend<JsonValue>();
  });

  it("rejects values JSON cannot represent", () => {
    expectTypeOf<undefined>().not.toExtend<JsonValue>();
    expectTypeOf<() => void>().not.toExtend<JsonValue>();
    expectTypeOf<Date>().not.toExtend<JsonValue>();
    expectTypeOf<{ a: bigint }>().not.toExtend<JsonValue>();
  });

  it("accepts an object type with optional properties", () => {
    // The reason `JsonObject`'s index signature admits `undefined`: a type with
    // optional properties has to be storable in a metadata or details field.
    expectTypeOf<{ present: string; absent?: number }>().toExtend<JsonObject>();
  });

  it("reads back as possibly absent", () => {
    // `noUncheckedIndexedAccess` is on, so callers must handle a missing key.
    const object: JsonObject = { a: 1 };
    expectTypeOf(object.a).toEqualTypeOf<JsonValue | undefined>();
  });
});

/**
 * The runtime half of the model (M2-T2). These do run: they are what
 * `parseJob()` leans on to decide that an untrusted `input` or `metadata` is
 * JSON at all.
 */
describe("isPlainObject", () => {
  it("accepts an object literal and a null-prototype object", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null) as object)).toBe(true);
    expect(isPlainObject(JSON.parse('{"a":1}'))).toBe(true);
  });

  it("rejects everything that is not one", () => {
    class Instance {}

    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("a")).toBe(false);
    expect(isPlainObject(1)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject(new Map())).toBe(false);
    expect(isPlainObject(new Instance())).toBe(false);
    expect(isPlainObject(() => undefined)).toBe(false);
  });
});

describe("isJsonValue", () => {
  it("accepts every JSON shape", () => {
    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue("a")).toBe(true);
    expect(isJsonValue(0)).toBe(true);
    expect(isJsonValue(-1.5)).toBe(true);
    expect(isJsonValue(true)).toBe(true);
    expect(isJsonValue([])).toBe(true);
    expect(isJsonValue({})).toBe(true);
    expect(isJsonValue({ a: [1, "two", null, { b: false }] })).toBe(true);
  });

  it("accepts an object property that is `undefined`, which `JSON.stringify` drops", () => {
    expect(isJsonValue({ present: 1, absent: undefined })).toBe(true);
  });

  it("rejects an `undefined` array element, which `JSON.stringify` turns into `null`", () => {
    expect(isJsonValue([undefined])).toBe(false);
  });

  it("rejects values JSON cannot represent exactly", () => {
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue(() => undefined)).toBe(false);
    expect(isJsonValue(Symbol("s"))).toBe(false);
    expect(isJsonValue(1n)).toBe(false);
    expect(isJsonValue(Number.NaN)).toBe(false);
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    // A `Date` survives `JSON.stringify` as a string, which is a different
    // value; "round-trips" is the test, not "does not throw".
    expect(isJsonValue(new Date())).toBe(false);
    expect(isJsonValue(new Map())).toBe(false);
    expect(isJsonValue({ nested: { bad: new Date() } })).toBe(false);
  });

  it("rejects a cycle rather than recursing forever", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(isJsonValue(cyclic)).toBe(false);
  });

  it("accepts the same object appearing twice, which is not a cycle", () => {
    const shared = { n: 1 };

    expect(isJsonValue({ left: shared, right: shared })).toBe(true);
    expect(isJsonValue([shared, shared])).toBe(true);
  });
});

describe("isJsonObject", () => {
  it("accepts a plain object of JSON values", () => {
    expect(isJsonObject({ a: 1, b: [null] })).toBe(true);
    expect(isJsonObject({})).toBe(true);
  });

  it("rejects an array, a scalar and an object holding a non-JSON value", () => {
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject("a")).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject({ at: new Date() })).toBe(false);
  });
});
