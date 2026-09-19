import { describe, expect, expectTypeOf, it } from "vitest";
import { ValidationError } from "./errors.js";
import {
  assertIsSchema,
  type InferSchemaOutput,
  isSchema,
  type Schema,
  type SchemaResult,
  validateWith,
} from "./schema.js";

/**
 * Every schema in this file is hand-written rather than produced by a library.
 * That is the point: `@internal/core` has no dependencies, so its own tests
 * must prove the boundary works against the published Standard Schema shape,
 * not against one vendor's implementation of it. `zod` is exercised against
 * these same types in `apps/example-agent/src/domain/domain.test.ts`.
 */

function schemaOf<T>(
  validate: (value: unknown) => SchemaResult<T> | Promise<SchemaResult<T>>,
  vendor = "harness-test",
): Schema<T> {
  return { "~standard": { version: 1, vendor, validate } };
}

const stringSchema = schemaOf<string>((value) =>
  typeof value === "string" ? { value } : { issues: [{ message: "expected a string" }] },
);

describe("isSchema", () => {
  it("accepts a well-formed Standard Schema", () => {
    expect(isSchema(stringSchema)).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not a schema"],
    ["an object with no `~standard`", {}],
    ["a `~standard` that is not an object", { "~standard": 1 }],
    ["the wrong spec version", { "~standard": { version: 2, vendor: "x", validate: () => ({}) } }],
    ["a missing vendor", { "~standard": { version: 1, validate: () => ({}) } }],
    [
      "a `validate` that is not callable",
      { "~standard": { version: 1, vendor: "x", validate: 1 } },
    ],
  ])("rejects %s", (_label, value) => {
    expect(isSchema(value)).toBe(false);
  });
});

describe("assertIsSchema", () => {
  it("returns for a schema", () => {
    expect(() => {
      assertIsSchema(stringSchema);
    }).not.toThrow();
  });

  it("throws a ValidationError naming the root, not a TypeError", () => {
    try {
      assertIsSchema({}, { label: "inputSchema" });
      expect.unreachable("expected assertIsSchema to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validation = error as ValidationError;
      expect(validation.message).toBe("inputSchema is not a Standard Schema");
      expect(validation.issues).toHaveLength(1);
      expect(validation.issues[0]?.path).toEqual([]);
    }
  });
});

describe("validateWith", () => {
  it("returns the parsed value", async () => {
    await expect(validateWith(stringSchema, "ok")).resolves.toBe("ok");
  });

  it("returns the value the schema produced, not the one it was given", async () => {
    const trimmed = schemaOf<string>((value) => ({ value: String(value).trim() }));

    await expect(validateWith(trimmed, "  padded  ")).resolves.toBe("padded");
  });

  it("awaits an asynchronous validate, which the specification permits", async () => {
    const asyncSchema = schemaOf<number>((value) => Promise.resolve({ value: Number(value) }));

    await expect(validateWith(asyncSchema, "41")).resolves.toBe(41);
  });

  it("throws a ValidationError carrying every issue", async () => {
    const failing = schemaOf<string>(() => ({
      issues: [{ message: "first" }, { message: "second" }],
    }));

    await expect(validateWith(failing, 1)).rejects.toBeInstanceOf(ValidationError);
    await expect(validateWith(failing, 1, { label: "job input" })).rejects.toThrow(
      "job input failed validation",
    );

    const error = await validateWith(failing, 1).catch((thrown: unknown) => thrown);
    expect((error as ValidationError).issues.map((issue) => issue.message)).toEqual([
      "first",
      "second",
    ]);
  });

  it("normalizes both path forms the specification allows", async () => {
    const failing = schemaOf<string>(() => ({
      issues: [
        { message: "bare keys", path: ["vendor", 0, "name"] },
        { message: "object keys", path: [{ key: "vendor" }, { key: 0 }, { key: "name" }] },
        { message: "mixed", path: ["vendor", { key: 2 }] },
        { message: "no path at all" },
      ],
    }));

    const error = (await validateWith(failing, {}).catch(
      (thrown: unknown) => thrown,
    )) as ValidationError;

    expect(error.issues.map((issue) => issue.path)).toEqual([
      ["vendor", 0, "name"],
      ["vendor", 0, "name"],
      ["vendor", 2],
      [],
    ]);
  });

  it("keeps a symbol segment's position in the path rather than dropping it", async () => {
    const failing = schemaOf<string>(() => ({
      issues: [{ message: "symbol key", path: ["outer", Symbol("inner"), "leaf"] }],
    }));

    const error = (await validateWith(failing, {}).catch(
      (thrown: unknown) => thrown,
    )) as ValidationError;

    // A symbol cannot survive `JSON.stringify`, so it is rendered as a string.
    // Dropping it would silently point the path at a different field.
    expect(error.issues[0]?.path).toEqual(["outer", "Symbol(inner)", "leaf"]);
  });

  it("turns a schema that throws into a ValidationError keeping the cause", async () => {
    const boom = new Error("schema exploded");
    const throwing = schemaOf<string>(() => {
      throw boom;
    });

    const error = (await validateWith(throwing, "x", { label: "output" }).catch(
      (thrown: unknown) => thrown,
    )) as ValidationError;

    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe("output could not be validated: the schema threw");
    expect(error.cause).toBe(boom);
  });

  it("rejects a value that is not a schema at all", async () => {
    const notASchema = {} as Schema<string>;

    await expect(validateWith(notASchema, "x")).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("Schema types", () => {
  it("infers the validated type", () => {
    const typed = schemaOf<{ a: number }>((value) => ({ value: value as { a: number } }));

    expectTypeOf(validateWith(typed, {})).toEqualTypeOf<Promise<{ a: number }>>();
  });

  it("reads the published types when a schema declares them", () => {
    type Declared = Schema<{ a: number }, { a: string }>;

    expectTypeOf<InferSchemaOutput<Declared>>().toEqualTypeOf<{ a: number }>();
  });
});
