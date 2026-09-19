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
