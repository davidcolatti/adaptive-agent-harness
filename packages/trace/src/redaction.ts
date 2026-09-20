import {
  isJsonObject,
  type JsonArray,
  type JsonObject,
  type JsonValue,
  type SerializedHarnessError,
  type TraceEvent,
  ValidationError,
} from "@internal/core";
import { DEFAULT_SECRET_PATTERN_RULES, type SecretPatternRule } from "./secret-patterns.js";

/**
 * Secret and sensitive-data redaction (M2-T9). **ADR-0035** records the design.
 *
 * The build plan asks for four mechanisms — field-path redaction,
 * secret-pattern redaction, headers redaction and tool-specific sanitizer
 * hooks — under one instruction: **redact before persistence**. What follows is
 * the pure half of that: a function from a {@link TraceEvent} to a redacted
 * {@link TraceEvent}, with no writer, no buffer and no I/O.
 * `createRedactingTraceWriter()` is the half that places it in the pipeline,
 * ahead of the buffered writer, so nothing is ever buffered unredacted.
 *
 * ## This is a safety net, not the boundary
 *
 * ADR-0031 and `docs/contracts/trace-event.md` state the actual rule: a trace
 * payload is **identity-only**. Ids, names, counts, statuses, codes, model ids,
 * tool ids; never message text, tool arguments, tool results or model output. A
 * payload that needs redacting should not have been written. Every adapter
 * today obeys that by construction, and `pnpm example:run:mock` writes a trace
 * containing nothing for this module to remove.
 *
 * It exists anyway for three reasons, and each is a real leak path rather than
 * a hypothetical one:
 *
 * 1. **A serialized error is content.** `details` on a `SerializedHarnessError`
 *    is whatever the thrower chose to publish and ADR-0026 is explicit that it
 *    is *not* a redaction boundary; `message` is a framework's own string. Both
 *    already reach `run.failed` today.
 * 2. **M5 widens payloads.** When the harness starts recording what an agent
 *    actually did, the mechanism has to already exist and already be wired, not
 *    be retrofitted onto a trace table that has been filling for two
 *    milestones.
 * 3. **A domain owns its tools.** A harness cannot know that one particular
 *    tool returns an object with a credential in it, which is exactly what the
 *    tool-specific sanitizer hook is for.
 *
 * ## What is redacted, and what is deliberately not
 *
 * Only `payload` and `error` carry content, so only those are walked.
 * `id`, `runId`, `attempt`, `sequence`, `timestamp`, `type`, `parentId`,
 * `node`, `version` and `behaviorFingerprint` pass through untouched: they are
 * the trace's structure, they are what a reader orders and joins a run by, and
 * redacting any of them would destroy the record while protecting nothing.
 * `usage` is numbers and `latencyMs` is a number. On a serialized error,
 * `name` and `code` are discriminants and pass through for the same reason;
 * `message`, `details`, `stack` and the whole `cause` chain are walked.
 */

/**
 * A location inside a trace event, as a list of object keys and array indices
 * from the event root.
 *
 * `["payload", "headers", "authorization"]` and
 * `["error", "cause", "details", "vendors", 0, "apiKey"]` are both paths. The
 * root segment is the event field, which is why a field-path pattern is written
 * against `payload.…` or `error.…` rather than against a bare property name.
 */
export type RedactionPath = readonly (string | number)[];

/**
 * A rule that replaces a whole value because of **where** it sits.
 *
 * The pattern language is a glob over the JSON tree, written with `.` between
 * segments:
 *
 * | Segment | Matches |
 * | --- | --- |
 * | `apiKey` | exactly that key, or that array index written as a number |
 * | `*` | exactly one segment, whatever it is |
 * | `**` | any number of segments, including none |
 *
 * So `payload.**.apiKey` matches `payload.apiKey` and
 * `payload.vendor.contact.apiKey`; `payload.headers.*` matches every direct
 * child of `payload.headers` and nothing deeper; `payload.items.0.token`
 * matches one array element's field.
 *
 * A match replaces the value **whatever its type**: an object, an array, a
 * number and a string all become the rule's redaction token. That is the
 * difference between this mechanism and {@link SecretPatternRule}, which
 * replaces only the span it matched inside a string.
 */
export interface FieldPathRule {
  /** The stable name that appears in the token this rule leaves behind. */
  readonly name: string;
  /** The path pattern, segments separated by `.`. */
  readonly path: string;
  /**
   * Compare literal segments case-sensitively. Defaults to `false`, because
   * `apiKey`, `apikey` and `APIKEY` are the same field wearing three hats and a
   * rule that caught only one of them would be a rule that mostly does not
   * work.
   */
  readonly caseSensitive?: boolean;
}

/**
 * A domain-supplied sanitizer for one tool's trace payloads.
 *
 * Keyed by tool id, and matched against `payload.tool`, which is the field the
 * eve adapter writes the tool name into on every `tool.*` event
 * (`EveAgentRuntime`, ADR-0031's mapping table). It runs **before** the generic
 * rules, and its result is still put through them, so a hook is a way to know
 * more than the harness does, never a way to opt out of what the harness
 * already enforces.
 *
 * @throws {ValidationError} from the redactor if `sanitize` returns something
 * that is not a JSON object. A hook that returned a `Date`, a class instance or
 * a cyclic object would produce an event that cannot be stored, and failing
 * loudly at the redaction step is better than discovering it in the sink.
 */
export interface ToolSanitizer {
  /** The tool this hook is for, as it appears in `payload.tool`. */
  readonly toolId: string;
  /** Return the payload to record. Must be JSON. */
  sanitize(payload: JsonObject, event: TraceEvent): JsonObject;
}

/** The four mechanisms M2-T9 names, as data. */
export interface RedactionPolicy {
  /** Whole-value redaction by position in the tree. */
  readonly fieldPaths: readonly FieldPathRule[];
  /** Span redaction by format, applied to every string. */
  readonly patterns: readonly SecretPatternRule[];
  /** Header names redacted wherever a `headers` object appears. */
  readonly headers: readonly string[];
  /** Per-tool hooks, applied before the generic rules. */
  readonly toolSanitizers: readonly ToolSanitizer[];
}

/** The opening of a redaction token. */
export const REDACTION_TOKEN_PREFIX = "[REDACTED:";

/** The closing of a redaction token. */
export const REDACTION_TOKEN_SUFFIX = "]";

/**
 * The name reported for a value removed by the headers rule.
 *
 * A single constant rather than one name per header: the key is still in the
 * JSON right next to the token, so `"authorization": "[REDACTED:header]"`
 * already says which header it was.
 */
export const HEADER_RULE_NAME = "header";

/**
 * The key a redacted value is nested under when it replaced something that had
 * to stay an object.
 *
 * `payload` and a serialized error's `details` are typed as objects, so a
 * field-path rule matching one of them whole cannot simply put a string there.
 * The token goes under this key instead, which keeps the type honest and keeps
 * the fact that something was removed visible.
 */
export const REDACTED_VALUE_KEY = "redacted";

/**
 * Build a redaction token.
 *
 * The token deliberately **names the rule that fired**. A trace is evidence,
 * and `[REDACTED:aws-access-key-id]` tells a reader that a value was there, that
 * it was removed on purpose, and which rule decided — none of which a bare
 * `***` or a silently dropped field would say. It is also what makes a
 * redaction bug findable: a token naming the wrong rule is visible in the
 * stored trace.
 */
export function redactionToken(ruleName: string): string {
  return `${REDACTION_TOKEN_PREFIX}${ruleName}${REDACTION_TOKEN_SUFFIX}`;
}

/** The object key under which the headers rule applies, lowercased. */
const HEADERS_KEY = "headers";

/**
 * Header names redacted wherever they appear as a key of a `headers` object.
 *
 * Every one of these carries a credential by definition rather than by
 * convention, which is why the list is short: a header is redacted because of
 * what it *is*, and anything else about a request belongs in the trace.
 */
export const DEFAULT_REDACTED_HEADERS: readonly string[] = Object.freeze([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-supabase-auth",
  "apikey",
]);

/**
 * Field names redacted wherever they appear, at any depth.
 *
 * Both spellings of each name are listed, camel and snake, because matching is
 * case-insensitive but not punctuation-insensitive: `apiKey` and `apikey` are
 * one rule, `api_key` is another. Several rules share a `name`, so the token a
 * reader sees is the same whichever spelling was used.
 *
 * `token` is included even though it is broad. A trace's own counts are
 * `inputTokens` and `outputTokens`, its ids are `…Id`, and a field called
 * exactly `token` in a payload is a credential essentially every time.
 */
export const DEFAULT_FIELD_PATH_RULES: readonly FieldPathRule[] = Object.freeze([
  { name: "api-key", path: "**.apiKey" },
  { name: "api-key", path: "**.api_key" },
  { name: "access-token", path: "**.accessToken" },
  { name: "access-token", path: "**.access_token" },
  { name: "refresh-token", path: "**.refreshToken" },
  { name: "refresh-token", path: "**.refresh_token" },
  { name: "session-token", path: "**.sessionToken" },
  { name: "session-token", path: "**.session_token" },
  { name: "client-secret", path: "**.clientSecret" },
  { name: "client-secret", path: "**.client_secret" },
  { name: "private-key", path: "**.privateKey" },
  { name: "private-key", path: "**.private_key" },
  { name: "service-role-key", path: "**.serviceRoleKey" },
  { name: "service-role-key", path: "**.service_role_key" },
  { name: "password", path: "**.password" },
  { name: "secret", path: "**.secret" },
  { name: "credentials", path: "**.credentials" },
  { name: "token", path: "**.token" },
]);

/**
 * The policy every redactor uses unless it is given another.
 *
 * There is no "off" and no `strict: false`. A caller that wants more redaction
 * adds rules with {@link createRedactionPolicy}; a caller that wants less has to
 * construct a {@link RedactionPolicy} literal and say so in code review, because
 * a flag that quietly disables redaction is the flag that will be set in the
 * one environment where it matters.
 */
export const DEFAULT_REDACTION_POLICY: RedactionPolicy = Object.freeze({
  fieldPaths: DEFAULT_FIELD_PATH_RULES,
  patterns: DEFAULT_SECRET_PATTERN_RULES,
  headers: DEFAULT_REDACTED_HEADERS,
  toolSanitizers: Object.freeze([]) as readonly ToolSanitizer[],
});

/** What {@link createRedactionPolicy} accepts: rules to add to the defaults. */
export interface RedactionPolicyOverrides {
  /** Extra field-path rules, appended to {@link DEFAULT_FIELD_PATH_RULES}. */
  readonly fieldPaths?: readonly FieldPathRule[];
  /** Extra patterns, appended to {@link DEFAULT_SECRET_PATTERN_RULES}. */
  readonly patterns?: readonly SecretPatternRule[];
  /** Extra header names, appended to {@link DEFAULT_REDACTED_HEADERS}. */
  readonly headers?: readonly string[];
  /** Tool hooks. There are no defaults, so these are the whole set. */
  readonly toolSanitizers?: readonly ToolSanitizer[];
}

/**
 * Extend the default policy.
 *
 * ```ts
 * const policy = createRedactionPolicy({
 *   fieldPaths: [{ name: "vendor-contact", path: "payload.vendor.contact" }],
 *   toolSanitizers: [
 *     {
 *       toolId: "lookup_vendor_evidence",
 *       sanitize: (payload) => ({ ...payload, evidence: "[omitted]" }),
 *     },
 *   ],
 * });
 * ```
 *
 * Arrays are **concatenated onto the defaults, never substituted for them**.
 * Overriding by replacement is how a policy silently loses the AWS rule on the
 * day someone adds a domain-specific one, so the API does not offer it.
 *
 * @throws {ValidationError} if a pattern lacks the `g` flag, which would redact
 * only the first occurrence in a string and leave the rest.
 */
export function createRedactionPolicy(overrides: RedactionPolicyOverrides = {}): RedactionPolicy {
  const patterns = [...DEFAULT_REDACTION_POLICY.patterns, ...(overrides.patterns ?? [])];

  assertPatternsAreGlobal(patterns);

  return Object.freeze({
    fieldPaths: Object.freeze([
      ...DEFAULT_REDACTION_POLICY.fieldPaths,
      ...(overrides.fieldPaths ?? []),
    ]),
    patterns: Object.freeze(patterns),
    headers: Object.freeze([...DEFAULT_REDACTION_POLICY.headers, ...(overrides.headers ?? [])]),
    toolSanitizers: Object.freeze([...(overrides.toolSanitizers ?? [])]),
  });
}

/** A redactor bound to one {@link RedactionPolicy}. Pure and reusable. */
export interface Redactor {
  /** The policy it applies. */
  readonly policy: RedactionPolicy;
  /**
   * Redact one JSON value, as if it sat at `path` inside an event.
   *
   * `path` defaults to the empty path, which is the root. Pass `["payload"]` to
   * have `payload.…` field-path rules mean what they say. The result is a new
   * value; the input is never mutated.
   */
  redactValue(value: JsonValue, path?: RedactionPath): JsonValue;
  /** Redact one event's `payload` and `error`, returning a new frozen event. */
  redactEvent(event: TraceEvent): TraceEvent;
  /** {@link Redactor.redactEvent} over a batch, in order. */
  redactEvents(events: readonly TraceEvent[]): readonly TraceEvent[];
}

/** One compiled {@link FieldPathRule}. */
interface CompiledFieldPathRule {
  readonly name: string;
  readonly segments: readonly string[];
  readonly caseSensitive: boolean;
}

/**
 * Whether `value` is a JSON array.
 *
 * A declared type guard rather than a bare `Array.isArray` call, because
 * `JsonArray` is `readonly JsonValue[]` and `Array.isArray`'s built-in
 * narrowing does not remove a readonly array type from the negative branch.
 * Declaring the guard is what lets the object branch below be `JsonObject`
 * without an assertion.
 */
function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value);
}

/** The segment matching exactly one path segment. */
const STAR = "*";

/** The segment matching any number of path segments, including none. */
const DOUBLE_STAR = "**";

function compileFieldPathRule(rule: FieldPathRule): CompiledFieldPathRule {
  const caseSensitive = rule.caseSensitive ?? false;
  const segments = rule.path
    .split(".")
    .map((segment) =>
      segment === STAR || segment === DOUBLE_STAR || caseSensitive
        ? segment
        : segment.toLowerCase(),
    );

  return { name: rule.name, segments, caseSensitive };
}

/**
 * Whether `path` matches `segments` from `segmentIndex` and `pathIndex` on.
 *
 * Ordinary glob matching with backtracking on `**`. A trace event's tree is
 * shallow and the rule count is small, so the recursive form is preferred over
 * a dynamic-programming table that would be faster and much harder to read.
 */
function matchFrom(
  rule: CompiledFieldPathRule,
  segmentIndex: number,
  path: RedactionPath,
  pathIndex: number,
): boolean {
  let si = segmentIndex;
  let pi = pathIndex;

  while (si < rule.segments.length) {
    const segment = rule.segments[si];

    if (segment === DOUBLE_STAR) {
      // Try the rest of the pattern at every remaining position, longest tail
      // first being unnecessary: any match is a match.
      for (let skipTo = pi; skipTo <= path.length; skipTo += 1) {
        if (matchFrom(rule, si + 1, path, skipTo)) {
          return true;
        }
      }
      return false;
    }

    if (pi >= path.length) {
      return false;
    }

    if (segment !== STAR) {
      const actual = String(path[pi]);
      const candidate = rule.caseSensitive ? actual : actual.toLowerCase();

      if (candidate !== segment) {
        return false;
      }
    }

    si += 1;
    pi += 1;
  }

  return pi === path.length;
}

function assertPatternsAreGlobal(patterns: readonly SecretPatternRule[]): void {
  const issues = patterns
    .filter((rule) => !rule.pattern.global)
    .map((rule) => ({
      path: ["patterns", rule.name],
      message: "a secret pattern must carry the `g` flag so every occurrence is replaced",
    }));

  if (issues.length > 0) {
    throw new ValidationError("createRedactionPolicy: every secret pattern must be global", {
      issues,
    });
  }
}

/**
 * Coerce a redacted value back to an object.
 *
 * Only reachable when a field-path rule matched a position the {@link TraceEvent}
 * type requires to be an object (`payload`, or an error's `details`). The token
 * is kept, nested under {@link REDACTED_VALUE_KEY}, rather than dropped.
 */
function asJsonObject(value: JsonValue): JsonObject {
  return isJsonObject(value) ? value : { [REDACTED_VALUE_KEY]: value };
}

/**
 * Create a {@link Redactor}.
 *
 * ```ts
 * const redactor = createRedactor();
 * const safe = redactor.redactEvent(event);
 * ```
 *
 * @throws {ValidationError} if a pattern in `policy` lacks the `g` flag.
 */
export function createRedactor(policy: RedactionPolicy = DEFAULT_REDACTION_POLICY): Redactor {
  assertPatternsAreGlobal(policy.patterns);

  const fieldPaths = policy.fieldPaths.map(compileFieldPathRule);
  const headers = new Set(policy.headers.map((name) => name.toLowerCase()));

  function matchFieldPath(path: RedactionPath): CompiledFieldPathRule | undefined {
    return fieldPaths.find((rule) => matchFrom(rule, 0, path, 0));
  }

  function applyPatterns(value: string): string {
    let result = value;

    for (const rule of policy.patterns) {
      // A replacer function rather than a string, so a `$` in a token could
      // never be read as a capture-group reference.
      result = result.replace(rule.pattern, () => redactionToken(rule.name));
    }

    return result;
  }

  function walkString(value: string, path: RedactionPath): string {
    const rule = matchFieldPath(path);

    return rule === undefined ? applyPatterns(value) : redactionToken(rule.name);
  }

  function walkObject(object: JsonObject, path: RedactionPath): JsonObject {
    const last = path[path.length - 1];
    const insideHeaders = typeof last === "string" && last.toLowerCase() === HEADERS_KEY;
    const result: Record<string, JsonValue> = {};

    for (const [key, child] of Object.entries(object)) {
      if (child === undefined) {
        // `JSON.stringify` and `canonicalJson` both drop an `undefined`
        // property, so keeping one here would be the only place it survived.
        continue;
      }

      if (insideHeaders && headers.has(key.toLowerCase())) {
        // The headers rule wins inside a `headers` object, so a redacted header
        // always reports itself as one even when a field-path rule would also
        // have matched it.
        result[key] = redactionToken(HEADER_RULE_NAME);
        continue;
      }

      result[key] = walk(child, [...path, key]);
    }

    return result;
  }

  function walk(value: JsonValue, path: RedactionPath): JsonValue {
    const rule = matchFieldPath(path);

    if (rule !== undefined) {
      return redactionToken(rule.name);
    }

    if (typeof value === "string") {
      return applyPatterns(value);
    }

    if (isJsonArray(value)) {
      return value.map((item, index) => walk(item, [...path, index]));
    }

    if (value === null || typeof value !== "object") {
      return value;
    }

    return walkObject(value, path);
  }

  function redactError(error: SerializedHarnessError, path: RedactionPath): SerializedHarnessError {
    const details =
      error.details === undefined
        ? undefined
        : asJsonObject(walk(error.details, [...path, "details"]));
    const cause =
      error.cause === undefined ? undefined : redactError(error.cause, [...path, "cause"]);
    const stack =
      error.stack === undefined ? undefined : walkString(error.stack, [...path, "stack"]);

    return {
      // `name` and `code` are ADR-0026's discriminants, not content.
      name: error.name,
      code: error.code,
      message: walkString(error.message, [...path, "message"]),
      // Spread conditionally: the repository compiles with
      // `exactOptionalPropertyTypes`, so an optional property is absent or has
      // its declared type, never explicitly `undefined`.
      ...(details === undefined ? {} : { details }),
      ...(cause === undefined ? {} : { cause }),
      ...(stack === undefined ? {} : { stack }),
    };
  }

  function sanitizeToolPayload(event: TraceEvent): JsonObject {
    if (!event.type.startsWith("tool.")) {
      return event.payload;
    }

    const toolId = event.payload.tool;

    if (typeof toolId !== "string") {
      return event.payload;
    }

    let payload = event.payload;

    for (const sanitizer of policy.toolSanitizers) {
      if (sanitizer.toolId !== toolId) {
        continue;
      }

      const sanitized = sanitizer.sanitize(payload, event);

      if (!isJsonObject(sanitized)) {
        throw new ValidationError(
          `redaction: the sanitizer for tool \`${toolId}\` returned a value that is not JSON`,
          {
            issues: [
              {
                path: ["toolSanitizers", toolId],
                message: "`sanitize` must return a plain object of JSON values",
              },
            ],
          },
        );
      }

      payload = sanitized;
    }

    return payload;
  }

  function redactEvent(event: TraceEvent): TraceEvent {
    const payload = asJsonObject(walk(sanitizeToolPayload(event), ["payload"]));
    const error = event.error === null ? null : redactError(event.error, ["error"]);

    // A new object, frozen at the top level exactly as `TraceRecorder` freezes
    // the events it mints. The input is neither mutated nor frozen, and no
    // object is shared with it: every container on the way down was rebuilt.
    return Object.freeze({ ...event, payload, error });
  }

  return {
    policy,
    redactValue(value: JsonValue, path: RedactionPath = []): JsonValue {
      return walk(value, path);
    },
    redactEvent,
    redactEvents(events: readonly TraceEvent[]): readonly TraceEvent[] {
      return events.map(redactEvent);
    },
  };
}

/**
 * Redact a batch of events with a one-off redactor.
 *
 * Belt and braces for a {@link TraceSink}: `createRedactingTraceWriter()` is
 * where redaction belongs, and a sink that re-applies this is protecting itself
 * against a pipeline someone assembled without it. Redaction is idempotent for
 * the rules that ship by default — a token contains no secret, so a second pass
 * finds nothing — so the cost of the extra pass is CPU and nothing else.
 *
 * M2-T5's Supabase sink is the intended caller.
 */
export function redactEvents(
  events: readonly TraceEvent[],
  policy: RedactionPolicy = DEFAULT_REDACTION_POLICY,
): readonly TraceEvent[] {
  return createRedactor(policy).redactEvents(events);
}
