import { describe, expect, it } from "vitest";
import { z } from "zod";
import { valueForJsonSchema } from "./json-schema-value.js";

/**
 * The generator's real acceptance criterion is "the eve server accepts what it
 * builds", which the contract tests and `pnpm example:run:mock` check. This
 * file checks the pieces that would be tedious to debug through a server: that
 * each JSON Schema keyword the subset covers is honoured, and that a schema
 * lowered from `zod` the way eve lowers one round-trips back through `zod`.
 */

/** Lower a zod schema exactly as eve's client does, via Standard JSON Schema. */
function lower(schema: z.ZodType): unknown {
  const props = schema["~standard"] as unknown as {
    readonly jsonSchema: { readonly output: (o: { target: string }) => Record<string, unknown> };
  };

  return props.jsonSchema.output({ target: "draft-07" });
}

describe("valueForJsonSchema", () => {
  it("builds only the required properties of an object", () => {
    const value = valueForJsonSchema({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a"],
      additionalProperties: false,
    });

    expect(value).toEqual({ a: "fixture:a" });
  });

  it("honours minLength by padding rather than truncating the label", () => {
    const value = valueForJsonSchema({ type: "string", minLength: 40 });

    expect(typeof value).toBe("string");
    expect(String(value)).toHaveLength(40);
  });

  it("produces exactly minItems array entries, and none when there is no minimum", () => {
    expect(valueForJsonSchema({ type: "array", items: { type: "string" } })).toEqual([]);
    expect(
      valueForJsonSchema({ type: "array", minItems: 2, items: { type: "string" } }),
    ).toHaveLength(2);
  });

  it("takes the first member of an enum and the value of a const", () => {
    expect(valueForJsonSchema({ type: "string", enum: ["escalate", "proceed"] })).toBe("escalate");
    expect(valueForJsonSchema({ const: 7 })).toBe(7);
  });

  it("keeps a number inside its declared bounds", () => {
    expect(valueForJsonSchema({ type: "integer", minimum: 5 })).toBe(5);
    expect(valueForJsonSchema({ type: "integer", maximum: 0 })).toBe(0);
  });

  it("falls back to a string for an unrecognized node, rather than throwing", () => {
    expect(typeof valueForJsonSchema({ type: "totally-unknown" })).toBe("string");
    expect(typeof valueForJsonSchema(undefined)).toBe("string");
  });

  it("builds a value a zod schema accepts, through eve's own lowering", () => {
    const schema = z.object({
      category: z.string().min(1),
      riskFlags: z.array(z.object({ clause: z.string().min(1) })),
      recommendation: z.object({
        decision: z.enum(["proceed", "escalate"]),
        rationale: z.string().min(1),
        conditions: z.array(z.string().min(1)).optional(),
      }),
      evidence: z.array(z.object({ claim: z.string().min(1) })).min(1),
    });

    const value = valueForJsonSchema(lower(schema));
    const parsed = schema.safeParse(value);

    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.evidence).toHaveLength(1);
    expect(parsed.data?.recommendation.decision).toBe("proceed");
    // An optional property is left out, not invented.
    expect(parsed.data?.recommendation.conditions).toBeUndefined();
  });
});
