/**
 * The JSON value model every serializable harness contract is built on.
 *
 * The build plan types `Job.metadata` as `Record<string, JsonValue>` (section
 * 5) without defining `JsonValue`, so the harness owns the definition. It is
 * recursive and contains no `any`, which matters because `packages/core` is
 * the package where `any` is banned outright (AGENTS.md, "Architecture
 * boundaries and hard prohibitions").
 *
 * Everything that crosses a persistence, trace or manifest boundary is typed
 * with these, so a value that typechecks is a value `JSON.stringify` can
 * round-trip.
 *
 * The three guards at the bottom are the runtime half of the same model, added
 * by M2-T2 because `parseJob()` has to decide whether an untrusted `input` or
 * `metadata` read back from a database row is JSON at all. They answer the
 * question the types answer at compile time, for a value that arrived as
 * `unknown`.
 */

/** A JSON scalar. `undefined` is not one: it has no JSON representation. */
export type JsonPrimitive = string | number | boolean | null;

/** A JSON array. Readonly, because contract values are never mutated in place. */
export type JsonArray = readonly JsonValue[];

/**
 * A JSON object.
 *
 * The index signature admits `undefined` so that a type with optional
 * properties (for example {@link SerializedHarnessError}) is assignable to it.
 * That is faithful to `JSON.stringify`, which omits a property whose value is
 * `undefined` rather than emitting it. Reading a key always yields
 * `JsonValue | undefined` in any case, because the repository compiles with
 * `noUncheckedIndexedAccess`.
 */
export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

/** Any value that JSON can represent. */
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * True when `value` is a **plain** object: an object literal, or something
 * `JSON.parse` produced, rather than a class instance, a `Date`, a `Map`, an
 * array or a function.
 *
 * The test is the prototype, because that is the only thing that distinguishes
 * the two at runtime. `Object.prototype` covers an ordinary literal;
 * `null` covers `Object.create(null)`, which `JSON.parse` does not produce but
 * a caller legitimately might.
 *
 * It is shallow on purpose: it says what *this* object is, not what its
 * properties hold. {@link isJsonValue} is the recursive question, and
 * `deepFreeze` uses this one to decide what it may safely walk into.
 */
export function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;

  return prototype === Object.prototype || prototype === null;
}

/**
 * Walk `value`, answering whether JSON can represent it exactly.
 *
 * `seen` is the cycle guard, and an entry is removed on the way back out so
 * that the same object appearing twice in a tree is fine while the same object
 * appearing inside itself is not.
 */
function isJson(value: unknown, seen: WeakSet<object>): boolean {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      // `JSON.stringify` turns `NaN` and the infinities into `null`, so a value
      // containing one does not round-trip. This agrees with `canonicalJson`,
      // which rejects them for the same reason.
      return Number.isFinite(value);
    case "object":
      break;
    default:
      // `undefined`, a function, a `symbol` and a `bigint` have no JSON form.
      return false;
  }

  const object = value as object;

  if (seen.has(object)) {
    // A cycle. `JSON.stringify` throws on one rather than emitting anything.
    return false;
  }

  seen.add(object);

  let result: boolean;

  if (Array.isArray(object)) {
    result = object.every((item) => isJson(item, seen));
  } else if (isPlainObject(object)) {
    // A property whose value is `undefined` is allowed and is dropped by
    // `JSON.stringify`, which is what makes a type with optional properties
    // assignable to `JsonObject`. An `undefined` *array element* is not
    // allowed, because `JSON.stringify` silently turns it into `null`.
    result = Object.values(object).every((item) => item === undefined || isJson(item, seen));
  } else {
    // A `Date`, a `Map`, a class instance: `JSON.stringify` either drops it,
    // empties it, or silently calls a `toJSON` that produces something else.
    result = false;
  }

  seen.delete(object);

  return result;
}

/**
 * True when `value` is something JSON can represent exactly: a string, a finite
 * number, a boolean, `null`, an array of those, or a plain object of those.
 *
 * "Exactly" is the operative word, and it is stricter than
 * `JSON.stringify` not throwing. A `Date` stringifies to a string and a `NaN`
 * to `null`, so both survive `JSON.stringify` while meaning something different
 * afterwards; neither is a {@link JsonValue}, and neither passes here.
 *
 * ```ts
 * isJsonValue({ a: [1, "two", null] }); // true
 * isJsonValue({ at: new Date() });      // false
 * isJsonValue({ n: Number.NaN });       // false
 * ```
 */
export function isJsonValue(value: unknown): value is JsonValue {
  return isJson(value, new WeakSet<object>());
}

/**
 * True when `value` is a plain object every property of which is a
 * {@link JsonValue}.
 *
 * This is what a `metadata` field has to satisfy: free-form, domain-owned, and
 * still guaranteed to survive a round trip through a database column.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && isJsonValue(value);
}
