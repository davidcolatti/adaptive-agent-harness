/**
 * A minimal JSON-Schema-shaped value generator.
 *
 * The fixture agent has to satisfy whatever `outputSchema` a caller's turn asks
 * for, without knowing which domain it is standing in for. Building a value
 * from the schema is what makes the fixture domain-agnostic: the same agent
 * serves `EveAgentRuntime`'s contract tests and `pnpm example:run:mock`, whose
 * schema is the real vendor-triage one.
 *
 * It is not a general JSON Schema implementation and is not trying to be. It
 * covers the subset `zod@4.6.5` emits for an ordinary domain schema, verified
 * against `vendorTriageOutputSchema`: nested objects with `required` and
 * `additionalProperties: false`, arrays with `minItems`, strings with
 * `minLength`, integers with bounds, and enums. Anything it does not recognize
 * falls back to a string, which the eve server then rejects loudly rather than
 * silently accepting a wrong-shaped fixture.
 *
 * Only required properties are produced. An optional property that is absent is
 * valid, and generating one would only risk violating a constraint nothing asked
 * for.
 */

/** A JSON value, for the fixture's own use. */
export type FixtureJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly FixtureJsonValue[]
  | { readonly [key: string]: FixtureJsonValue };

type SchemaNode = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(node: SchemaNode, key: string): number | undefined {
  const value = node[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringList(node: SchemaNode, key: string): readonly string[] {
  const value = node[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * A readable placeholder for a string leaf.
 *
 * The property name is used so an example run prints something a human can
 * follow back to the schema, and `minLength` is honoured by padding rather than
 * by emitting a wall of filler.
 */
function fixtureString(path: readonly string[], node: SchemaNode): string {
  const label = path.length === 0 ? "fixture" : `fixture:${path.join(".")}`;
  const minLength = readNumber(node, "minLength") ?? 0;

  return label.length >= minLength ? label : label.padEnd(minLength, ".");
}

function chooseBranch(node: SchemaNode): SchemaNode | undefined {
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const branches = node[key];

    if (Array.isArray(branches)) {
      const first = branches.find(isRecord);

      if (first !== undefined) {
        return first;
      }
    }
  }

  return undefined;
}

/** Build one value that satisfies `schema`, as far as this subset goes. */
export function valueForJsonSchema(
  schema: unknown,
  path: readonly string[] = [],
): FixtureJsonValue {
  if (!isRecord(schema)) {
    return fixtureString(path, {});
  }

  if ("const" in schema) {
    return (schema.const ?? null) as FixtureJsonValue;
  }

  const enumValues = schema.enum;

  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return (enumValues[0] ?? null) as FixtureJsonValue;
  }

  const branch = chooseBranch(schema);

  if (branch !== undefined && schema.type === undefined && schema.properties === undefined) {
    return valueForJsonSchema(branch, path);
  }

  const declared = schema.type;
  const type =
    typeof declared === "string"
      ? declared
      : Array.isArray(declared)
        ? declared.find((entry): entry is string => typeof entry === "string" && entry !== "null")
        : undefined;

  switch (type) {
    case "object":
      return objectForJsonSchema(schema, path);

    case "array": {
      const minItems = readNumber(schema, "minItems") ?? 0;
      const items: FixtureJsonValue[] = [];

      for (let index = 0; index < minItems; index += 1) {
        items.push(valueForJsonSchema(schema.items, [...path, String(index)]));
      }

      return items;
    }

    case "integer":
    case "number": {
      const minimum = readNumber(schema, "minimum");
      const maximum = readNumber(schema, "maximum");
      const candidate = minimum !== undefined && minimum > 0 ? minimum : 1;

      return maximum !== undefined && candidate > maximum ? maximum : candidate;
    }

    case "boolean":
      return true;

    case "null":
      return null;

    default:
      // Includes `type: "string"` and an absent `type`. A bare `{}` accepts
      // anything, so a string is a safe answer for both.
      return fixtureString(path, schema);
  }
}

function objectForJsonSchema(schema: SchemaNode, path: readonly string[]): FixtureJsonValue {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = readStringList(schema, "required");
  const value: Record<string, FixtureJsonValue> = {};

  for (const key of required) {
    value[key] = valueForJsonSchema(properties[key], [...path, key]);
  }

  return value;
}
