import { AgentExecutionError, type Schema } from "@internal/core";
import type { SendTurnInput } from "eve/client";

/**
 * Lowering a harness {@link Schema} to the JSON Schema `eve` wants on a turn.
 *
 * `docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md` §2 reads
 * eve's docs as "the client also accepts Standard Schema implementations such
 * as Zod", and concludes the harness can hand its own `Schema<T>` straight to
 * `SendTurnOptions.outputSchema`. **The installed types are narrower than that
 * sentence.** The field is declared
 *
 * ```ts
 * readonly outputSchema?: StandardJSONSchemaV1<unknown, TOutput> | JsonObject;
 * ```
 *
 * (`eve/dist/src/client/types.d.ts`) and `StandardJSONSchemaV1`
 * (`eve/dist/src/compiled/@standard-schema/spec/index.d.ts`) requires
 * `~standard.jsonSchema`, a `{ input, output }` converter pair. ADR-0027's
 * `Schema<T>` is Standard **Schema** v1, which declares only `~standard.validate`.
 * The two are siblings in the same specification family, not the same interface.
 *
 * eve's runtime agrees with its types: `serializeOutputSchema`
 * (`eve/dist/src/tools/schema.js`) reads `~standard.jsonSchema.output` and, when
 * it is missing, throws `Zod 3 cannot emit an output JSON Schema` for a `zod`
 * vendor and `does not support JSON Schema conversion` for anything else.
 *
 * So the adapter lowers the schema itself and sends a plain JSON Schema object,
 * which the same field accepts as `JsonObject`. `zod@4.6.5` publishes the
 * converter (verified: `~standard` carries `validate`, `vendor`, `version` and
 * `jsonSchema`), so a domain authored per ADR-0027 works unchanged.
 */

/**
 * Whatever `SendTurnOptions.outputSchema` accepts, derived from the public
 * type rather than restated.
 *
 * It is derived because eve's own `JsonObject` (`eve/dist/src/shared/json.d.ts`)
 * and `@internal/core`'s differ by exactly one thing: core's index signature
 * admits `undefined`, so that a type with optional properties stays assignable
 * to it, and eve's does not. Neither is wrong and neither is assignable to the
 * other, so the conversion happens here, once, instead of at every call site.
 */
export type EveOutputSchema = NonNullable<SendTurnInput<unknown>["outputSchema"]>;

/** The `StandardJSONSchemaV1` converter, as the specification declares it. */
interface JsonSchemaConverter {
  readonly output: (options: { readonly target: string }) => Record<string, unknown>;
}

/**
 * The JSON Schema draft the converter is asked for.
 *
 * `draft-07` because that is what eve itself requests in
 * `serializeOutputSchema` (`i({ target: "draft-07" })`), and the specification
 * says a library may throw for a target it does not support. Matching eve keeps
 * the harness inside the subset eve has already proven it can consume.
 */
const JSON_SCHEMA_TARGET = "draft-07";

function readConverter(schema: Schema<unknown>): JsonSchemaConverter | undefined {
  // The harness's own `Schema` type does not declare `jsonSchema`, so reading it
  // is a structural probe at the adapter boundary rather than a property access.
  const props: unknown = schema["~standard"];

  if (typeof props !== "object" || props === null) {
    return undefined;
  }

  const converter: unknown = (props as { readonly jsonSchema?: unknown }).jsonSchema;

  if (typeof converter !== "object" || converter === null) {
    return undefined;
  }

  const output: unknown = (converter as { readonly output?: unknown }).output;

  return typeof output === "function" ? (converter as JsonSchemaConverter) : undefined;
}

/**
 * Lower a domain output schema to the JSON Schema object `eve` accepts.
 *
 * `$schema` is stripped, matching eve's own canonical form ("canonical JSON
 * Schema data (no `$schema` key)", `eve/dist/src/tools/schema.d.ts`).
 *
 * @throws {AgentExecutionError} if the schema publishes no Standard JSON Schema
 * converter, or if the converter throws. Both are configuration problems the
 * caller can fix, and neither is something to discover halfway through a turn.
 */
export function toEveOutputSchema(schema: Schema<unknown>, label: string): EveOutputSchema {
  const converter = readConverter(schema);

  if (converter === undefined) {
    throw new AgentExecutionError(
      `${label} cannot be sent to eve: its schema publishes no Standard JSON Schema converter (\`~standard.jsonSchema\`). Author the domain's \`outputSchema\` with a library that implements Standard JSON Schema v1, such as zod 4.`,
      { details: { label } },
    );
  }

  let lowered: Record<string, unknown>;

  try {
    lowered = converter.output({ target: JSON_SCHEMA_TARGET });
  } catch (cause) {
    throw new AgentExecutionError(
      `${label} could not be lowered to JSON Schema (target ${JSON_SCHEMA_TARGET})`,
      { cause, details: { label, target: JSON_SCHEMA_TARGET } },
    );
  }

  const { $schema: _ignored, ...rest } = lowered;

  // The converter's declared return is `Record<string, unknown>`; eve's own
  // `serializeOutputSchema` takes the same value and calls it JSON Schema data.
  // The narrowing is a claim about the schema library, not about this code.
  return rest as EveOutputSchema;
}
