import { ValidationError, type ValidationIssue } from "./errors.js";

/**
 * The schema boundary.
 *
 * `packages/core` declares no dependency and must keep none, but a domain has
 * to describe its input and output with something. The Standard Schema
 * specification exists for exactly this: it is a set of properties a schema
 * library publishes under a single `~standard` key so that a consumer can
 * validate with any of them without importing one.
 *
 * The interfaces below are a harness-owned copy of **Standard Schema v1**
 * (<https://standardschema.dev>, spec version `1`), renamed to the harness's
 * own vocabulary and otherwise structurally identical. Copying rather than
 * depending is what keeps this package at zero dependencies; because the match
 * is structural, any library that implements the spec satisfies these types
 * with no adapter. `zod@4.6.5` does: every `$ZodType` declares
 * `"~standard": $ZodStandardSchema<this>`
 * (`zod/v4/core/schemas.d.ts`, and the spec copy zod ships in
 * `zod/v4/core/standard-schema.d.ts` is identical to the published one).
 *
 * See ADR-0027 for why this is the mechanism rather than a dependency on zod,
 * per-library adapter functions, or JSON Schema strings.
 */

/**
 * The inferred types a schema publishes.
 *
 * The harness names the validated type first, because that is the one a domain
 * cares about: `Schema<VendorTriageInput>` reads as "a schema that produces a
 * `VendorTriageInput`". The specification orders its own parameters
 * `<Input, Output>`; that difference is naming only and does not affect
 * structural compatibility, because the property names inside are the spec's.
 */
export interface SchemaTypes<TOutput, TInput> {
  /** What the schema accepts before parsing. */
  readonly input: TInput;
  /** What the schema produces after parsing. */
  readonly output: TOutput;
}

/**
 * A path segment expressed as an object.
 *
 * The specification allows an issue's path to hold either a bare `PropertyKey`
 * or an object with a `key`. Both forms are accepted here and normalized by
 * {@link validateWith}.
 */
export interface SchemaPathSegment {
  /** The key this segment represents. */
  readonly key: PropertyKey;
}

/** One problem a schema found, in the specification's shape. */
export interface SchemaIssue {
  /** What is wrong, in one sentence. */
  readonly message: string;
  /** Where it is wrong. Absent means the root of the validated value. */
  readonly path?: readonly (PropertyKey | SchemaPathSegment)[] | undefined;
}

/** A successful validation. The absence of `issues` is what marks success. */
export interface SchemaSuccessResult<TOutput> {
  /** The parsed value. */
  readonly value: TOutput;
  /** Always absent on success. */
  readonly issues?: undefined;
}

/** A failed validation. */
export interface SchemaFailureResult {
  /** Every problem found, never empty. */
  readonly issues: readonly SchemaIssue[];
}

/** What a schema's `validate` resolves to. */
export type SchemaResult<TOutput> = SchemaSuccessResult<TOutput> | SchemaFailureResult;

/** The properties a schema publishes under `~standard`. */
export interface SchemaProps<TOutput, TInput> {
  /** The specification version. Only `1` exists. */
  readonly version: 1;
  /** The schema library's own name, e.g. `zod`. */
  readonly vendor: string;
  /**
   * The inferred types. Optional in the specification, and carried only in the
   * type system: it never has a value at runtime.
   */
  readonly types?: SchemaTypes<TOutput, TInput> | undefined;
  /**
   * Validate an unknown value.
   *
   * The specification permits a synchronous or an asynchronous result, which is
   * why {@link validateWith} is async even though `zod` answers synchronously.
   */
  readonly validate: (value: unknown) => SchemaResult<TOutput> | Promise<SchemaResult<TOutput>>;
}

/**
 * Anything that can validate a value into a `TOutput`.
 *
 * `Schema<TInput>` on a {@link DomainDefinition} field means "a schema whose
 * validated result is the domain's input type", which is why the produced type
 * is the first parameter.
 */
export interface Schema<TOutput, TInput = unknown> {
  /** The Standard Schema properties. */
  readonly "~standard": SchemaProps<TOutput, TInput>;
}

/** The type a schema produces. */
export type InferSchemaOutput<TSchema extends Schema<unknown>> = NonNullable<
  TSchema["~standard"]["types"]
>["output"];

/** The type a schema accepts. */
export type InferSchemaInput<TSchema extends Schema<unknown>> = NonNullable<
  TSchema["~standard"]["types"]
>["input"];

/** Options for {@link validateWith} and {@link assertIsSchema}. */
export interface ValidateWithOptions {
  /**
   * What is being validated, used to open the error message: `"vendor-triage
   * job input"` produces `"vendor-triage job input failed validation"`. Defaults
   * to `"value"`.
   */
  readonly label?: string;
}

/**
 * A structural check that `value` publishes a well-formed `~standard`.
 *
 * Deliberately shallow: it checks the three properties the harness actually
 * calls, not the whole specification. A schema that passes this can be
 * validated with; one that does not is a programming error caught at the
 * boundary rather than a `TypeError` thrown from inside a validate call.
 */
export function isSchema(value: unknown): value is Schema<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const standard: unknown = (value as { readonly "~standard"?: unknown })["~standard"];

  if (typeof standard !== "object" || standard === null) {
    return false;
  }

  const props = standard as {
    readonly version?: unknown;
    readonly vendor?: unknown;
    readonly validate?: unknown;
  };

  return (
    props.version === 1 && typeof props.vendor === "string" && typeof props.validate === "function"
  );
}

/**
 * Throw unless `value` is a Standard Schema.
 *
 * It throws {@link ValidationError} rather than a `TypeError` so that every
 * failure crossing a harness boundary has one type to catch, with the issue
 * pointing at the root of the offending value.
 *
 * @throws {ValidationError} if `value` does not publish a well-formed `~standard`.
 */
export function assertIsSchema(
  value: unknown,
  options?: ValidateWithOptions,
): asserts value is Schema<unknown> {
  if (isSchema(value)) {
    return;
  }

  const label = options?.label ?? "value";

  throw new ValidationError(`${label} is not a Standard Schema`, {
    issues: [
      {
        path: [],
        message:
          "expected an object with a `~standard` property carrying `version: 1`, a string `vendor` and a `validate` function (https://standardschema.dev)",
      },
    ],
  });
}

/**
 * Normalize one specification path segment to the harness's own form.
 *
 * `ValidationIssue.path` is `(string | number)[]` because it has to survive
 * `JSON.stringify` into a trace. A `symbol` key cannot, so it is rendered with
 * `String()` — `Symbol("k")` becomes `"Symbol(k)"`. That keeps the segment's
 * *position* in the path honest, which dropping it would not: dropping a middle
 * segment would silently produce a path pointing at a different field.
 */
function normalizePathSegment(segment: PropertyKey | SchemaPathSegment): string | number {
  const key = typeof segment === "object" ? segment.key : segment;

  if (typeof key === "number" || typeof key === "string") {
    return key;
  }

  return String(key);
}

/** Normalize one specification issue to a {@link ValidationIssue}. */
function normalizeIssue(issue: SchemaIssue): ValidationIssue {
  return {
    path: (issue.path ?? []).map(normalizePathSegment),
    message: issue.message,
  };
}

/**
 * Validate `value` against `schema`, returning the parsed value or throwing.
 *
 * This is the harness's single choke point between a schema library and the
 * error taxonomy: every schema failure anywhere in the harness becomes a
 * {@link ValidationError} whose `issues` are normalized, so nothing downstream
 * has to know which library produced them.
 *
 * It is `async` because the specification allows `validate` to return a
 * promise, even though the installed `zod` answers synchronously.
 *
 * @throws {ValidationError} if `schema` is not a Standard Schema, if validation
 * reports issues, or if `validate` itself throws (the original goes in `cause`;
 * a schema that throws is a defect in the schema, not a valid value).
 */
export async function validateWith<TOutput>(
  schema: Schema<TOutput>,
  value: unknown,
  options?: ValidateWithOptions,
): Promise<TOutput> {
  const label = options?.label ?? "value";

  assertIsSchema(schema, options);

  let result: SchemaResult<TOutput>;

  try {
    result = await schema["~standard"].validate(value);
  } catch (cause) {
    throw new ValidationError(`${label} could not be validated: the schema threw`, {
      cause,
      issues: [{ path: [], message: "the schema's `validate` threw instead of reporting issues" }],
    });
  }

  if (result.issues === undefined) {
    return result.value;
  }

  throw new ValidationError(`${label} failed validation`, {
    issues: result.issues.map(normalizeIssue),
  });
}
