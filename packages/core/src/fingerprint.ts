import { createHash } from "node:crypto";
import { ValidationError } from "./errors.js";
import type { JsonValue } from "./json.js";

/**
 * Canonical JSON and the fingerprint scheme built on it.
 *
 * North-star invariant 4 is "every behavior-affecting version is
 * fingerprinted", and a fingerprint is only useful if two runs that mean the
 * same thing produce the same string. `JSON.stringify` does not give that:
 * it emits properties in insertion order, so `{ a: 1, b: 2 }` and
 * `{ b: 2, a: 1 }` hash differently while describing the same capability.
 *
 * AD-016 names "canonical JSON encoding used for fingerprints" as exactly the
 * kind of unprescribed internal choice that must be recorded rather than
 * implied. **ADR-0029** records it.
 *
 * This module is the whole of the harness's hashing surface. `node:crypto` is
 * a Node built-in, not a third-party dependency, so `@internal/core` keeps its
 * zero-dependency rule.
 */

/**
 * The algorithm prefix every {@link fingerprint} carries.
 *
 * It exists so the algorithm can change without every stored fingerprint
 * becoming ambiguous: a future `blake3:` value is distinguishable from an
 * `sha256:` one on sight, and a comparison between the two is obviously not a
 * match rather than silently one.
 */
export const FINGERPRINT_ALGORITHM_PREFIX = "sha256:";

/**
 * Order two object keys the way RFC 8785 section 3.2.3 requires: by UTF-16 code
 * units, which is what `<` and `>` compare strings by in ECMAScript.
 * `localeCompare` is deliberately not used, because its result depends on the
 * host's locale and a fingerprint may not.
 */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function fail(path: readonly (string | number)[], message: string): never {
  throw new ValidationError("canonicalJson: value is not canonicalizable JSON", {
    issues: [{ path: [...path], message }],
  });
}

function canonicalizeNumber(value: number, path: readonly (string | number)[]): string {
  if (!Number.isFinite(value)) {
    // `JSON.stringify` turns these into `null`, which would make `NaN` and
    // `null` hash identically. A fingerprint may not quietly conflate two
    // different values, so this is an error rather than a coercion.
    fail(path, `expected a finite number, received ${String(value)}`);
  }

  // RFC 8785 specifies ECMAScript's own number-to-string algorithm, which is
  // what both `String(value)` and `JSON.stringify(value)` use for a finite
  // number. `-0` is normalized to `0` because JSON cannot express the
  // difference and a round-trip would not preserve it.
  return JSON.stringify(Object.is(value, -0) ? 0 : value);
}

function canonicalize(value: unknown, path: readonly (string | number)[]): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return canonicalizeNumber(value, path);
    case "string":
      // `JSON.stringify` on a string produces the shortest escaping JSON
      // allows, which is what RFC 8785 section 3.2.2.2 requires.
      return JSON.stringify(value);
    case "object":
      break;
    default:
      fail(path, `expected a JSON value, received ${typeof value}`);
  }

  if (Array.isArray(value)) {
    // Array order is significant and is preserved: a list is data, not a set.
    const items = value.map((item, index) => canonicalize(item, [...path, index]));
    return `[${items.join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    // A property whose value is `undefined` is dropped, faithfully to
    // `JSON.stringify`, which omits it rather than emitting it. That is what
    // lets a type with optional properties be fingerprinted at all.
    .filter(([, propertyValue]) => propertyValue !== undefined)
    // RFC 8785 section 3.2.3 sorts keys by their UTF-16 code units, which is
    // exactly what `Array.prototype.sort()` does by default for strings.
    .sort(([left], [right]) => compareCodeUnits(left, right));

  const members = entries.map(
    ([key, propertyValue]) =>
      `${JSON.stringify(key)}:${canonicalize(propertyValue, [...path, key])}`,
  );

  return `{${members.join(",")}}`;
}

/**
 * Serialize `value` to canonical JSON: an RFC 8785-style encoding with object
 * keys sorted, no insignificant whitespace, arrays left in order, and
 * `undefined` properties dropped.
 *
 * The same value always produces the same string, on any platform and in any
 * property order, which is what makes a fingerprint comparable across
 * processes and across time.
 *
 * ```ts
 * canonicalJson({ b: 2, a: [1, { d: 4, c: 3 }] });
 * // '{"a":[1,{"c":3,"d":4}],"b":2}'
 * ```
 *
 * @throws {ValidationError} if `value` contains anything JSON cannot represent
 * exactly: a non-finite number, a function, a `symbol`, a `bigint`, or
 * `undefined` anywhere other than as a dropped object property. Failing is
 * deliberate: silently coercing `NaN` to `null` the way `JSON.stringify` does
 * would make two different values share a fingerprint.
 */
export function canonicalJson(value: JsonValue): string {
  return canonicalize(value, []);
}

/**
 * Hash `value`'s canonical JSON form with SHA-256 and return it as
 * `sha256:<hex>`.
 *
 * ```ts
 * fingerprint({ kind: "tool", id: "lookup_vendor_evidence" });
 * // "sha256:…64 hex characters…"
 * ```
 *
 * **What goes in is the caller's decision, and it matters more than the hash.**
 * The rule the build plan sets (M2-T8) is to hash behavior-affecting inputs and
 * nothing else: never a timestamp, never a run ID, never irrelevant metadata,
 * because a fingerprint that changes when nothing about the behavior changed
 * cannot be used to decide that two things behave the same.
 *
 * **M2-T8 extends this** to agent instructions, SOPs, loaded skills, tool
 * definition versions, model configuration, schemas, workflow IR and policy
 * thresholds. This function is the primitive all of those will use; only the
 * choice of input grows.
 *
 * @throws {ValidationError} for anything {@link canonicalJson} rejects.
 */
export function fingerprint(value: JsonValue): string {
  return (
    FINGERPRINT_ALGORITHM_PREFIX +
    createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")
  );
}
