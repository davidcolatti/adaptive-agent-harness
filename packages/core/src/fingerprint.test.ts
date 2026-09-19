import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ValidationError } from "./errors.js";
import { canonicalJson, FINGERPRINT_ALGORITHM_PREFIX, fingerprint } from "./fingerprint.js";
import type { JsonValue } from "./json.js";

describe("canonicalJson", () => {
  it("sorts object keys, so property order cannot change a fingerprint", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it("sorts nested object keys too", () => {
    expect(canonicalJson({ b: { d: 4, c: 3 }, a: [1, { f: 6, e: 5 }] })).toBe(
      '{"a":[1,{"e":5,"f":6}],"b":{"c":3,"d":4}}',
    );
  });

  it("preserves array order, because a list is data and not a set", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalJson({ a: [1, 2], b: { c: "d" } })).toBe('{"a":[1,2],"b":{"c":"d"}}');
  });

  it("sorts keys by UTF-16 code unit, not by locale", () => {
    // Uppercase sorts before lowercase by code unit; a locale-aware comparison
    // would interleave them, and a fingerprint may not depend on a locale.
    expect(canonicalJson({ a: 1, B: 2, A: 3 })).toBe('{"A":3,"B":2,"a":1}');
  });

  it("round-trips unicode and escapes it the way JSON does", () => {
    const value = { κλειδί: "τιμή", emoji: "🔐", quote: 'a "b" c', newline: "a\nb" };
    expect(JSON.parse(canonicalJson(value))).toEqual(value);
    expect(canonicalJson({ a: "🔐" })).toBe('{"a":"🔐"}');
  });

  it("drops `undefined` properties, faithfully to JSON.stringify", () => {
    const value: JsonValue = { a: 1, b: undefined, c: 3 };
    expect(canonicalJson(value)).toBe('{"a":1,"c":3}');
  });

  it("normalizes -0 to 0, because JSON cannot express the difference", () => {
    expect(canonicalJson({ a: -0 })).toBe('{"a":0}');
  });

  it("rejects NaN and Infinity rather than coercing them to null", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => canonicalJson({ a: bad } as unknown as JsonValue)).toThrow(ValidationError);
    }

    try {
      canonicalJson({ nested: [{ value: Number.NaN }] } as unknown as JsonValue);
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues[0]?.path).toEqual(["nested", 0, "value"]);
    }
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => canonicalJson((() => 1) as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalJson(Symbol("k") as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalJson(1n as unknown as JsonValue)).toThrow(ValidationError);
    expect(() => canonicalJson(undefined as unknown as JsonValue)).toThrow(ValidationError);
  });

  it("handles the scalar cases", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
    expect(canonicalJson(1.5)).toBe("1.5");
    expect(canonicalJson("x")).toBe('"x"');
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });
});

describe("fingerprint", () => {
  it("is the SHA-256 of the canonical form, prefixed with its algorithm", () => {
    const value = { b: 2, a: 1 };
    const expected = `sha256:${createHash("sha256").update('{"a":1,"b":2}', "utf8").digest("hex")}`;

    expect(fingerprint(value)).toBe(expected);
    expect(fingerprint(value).startsWith(FINGERPRINT_ALGORITHM_PREFIX)).toBe(true);
  });

  it("matches a fixed expected hex, so the scheme cannot change silently", () => {
    // `{"a":1,"b":2}` hashed with SHA-256. Pinned by hand: if this value ever
    // changes, either the canonical encoding or the algorithm changed, and both
    // are decisions that need ADR-0029 revisited rather than a test update.
    expect(fingerprint({ b: 2, a: 1 })).toBe(
      "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
    expect(fingerprint({})).toBe(
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });

  it("is stable across property order and unstable across content", () => {
    expect(fingerprint({ a: 1, b: [2, 3] })).toBe(fingerprint({ b: [2, 3], a: 1 }));
    expect(fingerprint({ a: 1, b: [2, 3] })).not.toBe(fingerprint({ a: 1, b: [3, 2] }));
  });

  it("produces 64 hex characters after the prefix", () => {
    expect(fingerprint({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects what canonicalJson rejects", () => {
    expect(() => fingerprint({ a: Number.NaN } as unknown as JsonValue)).toThrow(ValidationError);
  });
});
