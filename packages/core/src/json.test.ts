import { describe, expectTypeOf, it } from "vitest";
import type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from "./json.js";

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
