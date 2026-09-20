import { randomBytes } from "node:crypto";
import { ValidationError } from "./errors.js";

/**
 * The harness's entity identifiers: one sortable scheme, twelve brands (M2-T1).
 *
 * The build plan asks for "UUIDv7 or another sortable unique ID" for twelve
 * entities, and AD-016 names "UUID implementation" as exactly the kind of
 * unprescribed internal choice that must be recorded rather than implied.
 * **ADR-0030** records it. Two things are being bought here, and they are
 * separate:
 *
 * 1. **Sortability.** An id that sorts lexicographically in creation order is
 *    a usable primary key, a usable trace cursor and a usable pagination token.
 *    A v4 UUID is none of those, which is why M1's `crypto.randomUUID()` had to
 *    go.
 * 2. **Type distinctness.** `runId` and `jobId` are both UUID strings, so
 *    nothing but a type stops one being passed where the other belongs. The
 *    twelve brands below make that a compile error.
 *
 * **Why the implementation is owned rather than delegated to Node.** The pinned
 * runtime, Node 24.21.0, does ship `crypto.randomUUIDv7()` (added in v24.16.0),
 * and it was measured rather than assumed. Its own documentation says the
 * embedded timestamp "relies on a non-monotonic clock and is not guaranteed to
 * be strictly increasing", and on the pinned runtime roughly half of 20 000
 * consecutive ids came out non-increasing, because ids minted inside the same
 * millisecond are ordered only by their random bits. Sortability *is* the
 * property this module exists to provide, so the built-in cannot provide it.
 * What follows is RFC 9562 §4.4's layout with §6.2 Method 1's fixed
 * bit-length dedicated counter in `rand_a`.
 *
 * `node:crypto` is a Node built-in, not a third-party dependency, so
 * `@internal/core` keeps its zero-dependency rule. That is the same reasoning
 * ADR-0029 already applied to `createHash`.
 */

/** The name of the scheme every entity id in this harness is minted under. */
export const ENTITY_ID_SCHEME = "uuidv7";

/**
 * The kinds of entity the harness identifies.
 *
 * These are the twelve the build plan's M2-T1 lists, in its order. The strings
 * are kebab-case rather than the plan's `snake_case` column names, matching the
 * identifier style `IDENTIFIER_PATTERN` already sets for domains and
 * capabilities; they appear in validation messages and as the type-level tag,
 * never in a wire format.
 */
export const ENTITY_KINDS = [
  "job",
  "run",
  "attempt",
  "trace-event",
  "workflow",
  "workflow-version",
  "node-execution",
  "decision",
  "eval-run",
  "learning-run",
  "compiler-run",
  "promotion",
] as const;

/** One of {@link ENTITY_KINDS}. */
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * The key of {@link EntityId}'s phantom brand.
 *
 * It is `declare`d, so it exists only in the type system and nothing is emitted
 * for it. It is exported because a declaration file has to be able to name it,
 * not because a caller should ever use it. This is the same idiom `Job` uses
 * for its phantom output marker.
 */
export declare const ENTITY_ID_BRAND: unique symbol;

/**
 * A {@link ENTITY_ID_SCHEME} identifier for one kind of entity.
 *
 * At runtime it is nothing but a lowercase UUID string: it serializes, indexes
 * and compares as one, and no unwrapping is needed to store it or put it in a
 * trace payload. The brand exists only so that the twelve aliases below are
 * mutually incompatible, and so that a bare `string` cannot be passed where an
 * id is expected. Assignment in the other direction still works, because a
 * branded string *is* a string.
 */
export type EntityId<TKind extends EntityKind> = string & {
  readonly [ENTITY_ID_BRAND]: TKind;
};

/** Identifies one `Job`. */
export type JobId = EntityId<"job">;
/** Identifies one run of a job. */
export type RunId = EntityId<"run">;
/** Identifies one attempt within a run. */
export type AttemptId = EntityId<"attempt">;
/** Identifies one trace event. */
export type TraceEventId = EntityId<"trace-event">;
/** Identifies one workflow, across all its versions. */
export type WorkflowId = EntityId<"workflow">;
/** Identifies one version of one workflow. */
export type WorkflowVersionId = EntityId<"workflow-version">;
/** Identifies one execution of one workflow node. */
export type NodeExecutionId = EntityId<"node-execution">;
/** Identifies one decision-engine judgment. */
export type DecisionId = EntityId<"decision">;
/** Identifies one evaluation run. */
export type EvalRunId = EntityId<"eval-run">;
/** Identifies one learning run. */
export type LearningRunId = EntityId<"learning-run">;
/** Identifies one compiler run. */
export type CompilerRunId = EntityId<"compiler-run">;
/** Identifies one promotion. */
export type PromotionId = EntityId<"promotion">;

/**
 * The textual form an entity id must have: RFC 9562 §4 `8-4-4-4-12` lowercase
 * hex, with the version nibble fixed at `7` and the variant nibble restricted
 * to `8`/`9`/`a`/`b`, which are exactly the four values whose two high bits are
 * `10`.
 *
 * Uppercase is rejected rather than normalized. An id is compared for equality
 * and sorted as a string in this harness and in whatever database M2-T5 puts it
 * in, and two spellings of one id would break both.
 */
export const ENTITY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** The message {@link parseEntityId} failures are reported with. */
export const ENTITY_ID_MESSAGE =
  "expected a lowercase RFC 9562 UUIDv7 (version nibble `7`, variant bits `10`)";

/** The number of bits RFC 9562 §4.4 gives `rand_a`, which holds the counter. */
const COUNTER_BITS = 12;

/** The largest value the `rand_a` counter can hold before it must roll over. */
const MAX_COUNTER = (1 << COUNTER_BITS) - 1;

/** Bytes of `rand_b` entropy, two bits of which the variant overwrites. */
const RANDOM_BYTES = 8;

/**
 * The last millisecond an id was minted for, and the counter within it.
 *
 * Module-level mutable state is deliberate and is the whole mechanism: strict
 * ordering within a millisecond is only definable relative to what was already
 * issued. It is per-process, which is the correct scope — ordering across
 * processes is carried by the timestamp, and two processes minting inside the
 * same millisecond have no happens-before relationship to preserve anyway.
 */
let lastTimestampMs = -1;
let counter = 0;

/**
 * Advance the clock-and-counter pair, returning the values the next id uses.
 *
 * Three cases, and the second two are why this exists:
 *
 * - **A new millisecond.** Reset the counter; the timestamp alone orders this
 *   id after every earlier one.
 * - **The same millisecond.** Increment the counter, which is RFC 9562 §6.2
 *   Method 1. Since the counter occupies `rand_a`, which the textual form
 *   places immediately after the timestamp and the version nibble, a strictly
 *   larger counter is a strictly larger string.
 * - **A backwards clock.** `Date.now()` can go down: NTP steps it, and a
 *   virtual machine resuming from a snapshot steps it hard. Treating that as
 *   "the same millisecond" and incrementing the counter is what keeps the
 *   sequence monotonic through it, at the cost of ids that read as slightly
 *   older than they are until the clock catches up. Emitting a smaller id would
 *   be the worse failure: it would silently corrupt every ordering built on it.
 *
 * On counter rollover (more than 4096 ids inside one millisecond) the timestamp
 * is borrowed forward by 1 ms and the counter resets, which RFC 9562 §6.2
 * permits. Monotonicity is preserved; the only cost is a timestamp marginally
 * ahead of the wall clock under a burst.
 */
function nextTimestampAndCounter(): { readonly timestampMs: number; readonly counter: number } {
  const now = Date.now();

  if (now > lastTimestampMs) {
    lastTimestampMs = now;
    counter = 0;
  } else if (counter >= MAX_COUNTER) {
    lastTimestampMs += 1;
    counter = 0;
  } else {
    counter += 1;
  }

  return { timestampMs: lastTimestampMs, counter };
}

/**
 * Mint the next id string, unbranded.
 *
 * The bit layout is RFC 9562 §4.4 exactly: 48 bits of Unix milliseconds, 4 bits
 * of version (`7`), 12 bits of `rand_a` (here the counter), 2 bits of variant
 * (`10`), 62 bits of `rand_b`.
 */
function nextEntityId(): string {
  const { timestampMs, counter: counterValue } = nextTimestampAndCounter();

  // 48 bits as 12 hex digits. `toString(16)` is exact here: a millisecond
  // timestamp stays far inside the 2^53 integers a `number` represents exactly,
  // and will until the year 10889.
  const timestampHex = timestampMs.toString(16).padStart(12, "0");
  const counterHex = counterValue.toString(16).padStart(3, "0");

  const random = randomBytes(RANDOM_BYTES);
  // RFC 9562 §4.1: the variant is the two high bits of octet 8, set to `10`.
  // The remaining 62 bits stay random, which is what makes an id unguessable
  // even though its timestamp and counter are not.
  random[0] = ((random[0] ?? 0) & 0x3f) | 0x80;
  const randomHex = random.toString("hex");

  return [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    `7${counterHex}`,
    randomHex.slice(0, 4),
    randomHex.slice(4, 16),
  ].join("-");
}

/**
 * Apply a brand to an id string.
 *
 * This is the one place in the harness a cast mints a brand, which is the
 * point: a brand is by construction unprovable to the compiler, so the
 * assertion is confined to a single reviewed function instead of being repeated
 * at every call site. It is a direct `as`, never `as unknown as`.
 */
function brand<TKind extends EntityKind>(value: string): EntityId<TKind> {
  return value as EntityId<TKind>;
}

/**
 * True when `value` is a well-formed entity id in the current scheme.
 *
 * It is deliberately **kind-agnostic**: the scheme encodes a timestamp, a
 * counter and entropy, and nothing about which entity the id names. Which kind
 * an id belongs to is knowledge the surrounding type carries, not something a
 * string can be interrogated for, so this guard narrows to `EntityId<TKind>`
 * only where the caller already knows the kind.
 */
export function isEntityId<TKind extends EntityKind = EntityKind>(
  value: unknown,
): value is EntityId<TKind> {
  return typeof value === "string" && ENTITY_ID_PATTERN.test(value);
}

/**
 * Parse an untrusted value into an entity id of a known kind.
 *
 * This is the boundary function: a value read from a database row, a request
 * body or a trace record arrives as `unknown` or `string` and becomes a branded
 * id only by passing through here. `kind` earns its runtime keep by naming the
 * entity in the error message; `path` prefixes the issue path, matching
 * `collectRefIssues` in `identifiers.ts`, so a caller validating several fields
 * can point at the offending one.
 *
 * @throws {ValidationError} if `value` is not a lowercase UUIDv7.
 */
export function parseEntityId<TKind extends EntityKind>(
  kind: TKind,
  value: unknown,
  path: readonly (string | number)[] = [],
): EntityId<TKind> {
  if (!isEntityId<TKind>(value)) {
    throw new ValidationError(`expected a ${kind} id in the \`${ENTITY_ID_SCHEME}\` scheme`, {
      issues: [{ path: [...path], message: ENTITY_ID_MESSAGE }],
    });
  }

  return value;
}

/**
 * Read the creation time an entity id embeds, as Unix milliseconds.
 *
 * The first 48 bits of a UUIDv7 *are* the creation timestamp (RFC 9562 §4.4),
 * so an entity already carries its own creation time and does not need a second
 * field claiming the same fact. That is why `Job` has no `createdAt`
 * (M2-T2, ADR-0032): two sources of truth for one instant can disagree, and the
 * derived one cannot be forged independently of the id it is derived from. A
 * persisted row that wants a queryable timestamp column derives it here.
 *
 * Two caveats, both from the generator's monotonicity rules:
 *
 * - Under a burst of more than 4096 ids in one millisecond the timestamp is
 *   borrowed forward, so it can read marginally **ahead** of the wall clock.
 * - While the system clock is stepped backwards the timestamp is held, so it
 *   can read marginally **behind** it until the clock catches up.
 *
 * Both are bounded by the size of the burst or the step, and both are the price
 * of an id that never goes down. Treat the value as the creation time to
 * millisecond resolution, not as an audited clock reading.
 *
 * @throws {ValidationError} if `id` is not a well-formed id in this scheme.
 * A value arriving from outside should already have been through
 * {@link parseEntityId}; this check is what keeps a malformed string from
 * producing a plausible-looking date.
 */
export function entityIdTimestampMs(id: string, path: readonly (string | number)[] = []): number {
  if (!isEntityId(id)) {
    throw new ValidationError(
      `cannot read a timestamp from a value that is not a \`${ENTITY_ID_SCHEME}\` id`,
      { issues: [{ path: [...path], message: ENTITY_ID_MESSAGE }] },
    );
  }

  // The 48-bit timestamp is the first two groups of the textual form: eight hex
  // digits, the dash, then four more.
  return Number.parseInt(`${id.slice(0, 8)}${id.slice(9, 13)}`, 16);
}

/**
 * Read the creation time an entity id embeds, as a `Date`.
 *
 * ```ts
 * entityIdTimestamp(job.id); // when `createJob` minted it
 * ```
 *
 * Sugar over {@link entityIdTimestampMs}; see that function for the two
 * monotonicity caveats and for why an entity carries no separate `createdAt`.
 *
 * @throws {ValidationError} if `id` is not a well-formed id in this scheme.
 */
export function entityIdTimestamp(id: string, path: readonly (string | number)[] = []): Date {
  return new Date(entityIdTimestampMs(id, path));
}

/**
 * The twelve generators.
 *
 * They are twelve one-line wrappers rather than one `newEntityId(kind)`,
 * because the kind has no runtime meaning at generation time: every id is the
 * same string whatever it names. A generic generator would take an argument
 * purely to pick a return type, and `newRunId()` reads better at a call site
 * than `newEntityId("run")` while producing an identical value. The parser
 * above is generic for the opposite reason: there, `kind` genuinely does
 * something, because it is what the failure message names.
 */

/** Mint a new {@link JobId}. */
export function newJobId(): JobId {
  return brand<"job">(nextEntityId());
}

/** Mint a new {@link RunId}. */
export function newRunId(): RunId {
  return brand<"run">(nextEntityId());
}

/** Mint a new {@link AttemptId}. */
export function newAttemptId(): AttemptId {
  return brand<"attempt">(nextEntityId());
}

/** Mint a new {@link TraceEventId}. */
export function newTraceEventId(): TraceEventId {
  return brand<"trace-event">(nextEntityId());
}

/** Mint a new {@link WorkflowId}. */
export function newWorkflowId(): WorkflowId {
  return brand<"workflow">(nextEntityId());
}

/** Mint a new {@link WorkflowVersionId}. */
export function newWorkflowVersionId(): WorkflowVersionId {
  return brand<"workflow-version">(nextEntityId());
}

/** Mint a new {@link NodeExecutionId}. */
export function newNodeExecutionId(): NodeExecutionId {
  return brand<"node-execution">(nextEntityId());
}

/** Mint a new {@link DecisionId}. */
export function newDecisionId(): DecisionId {
  return brand<"decision">(nextEntityId());
}

/** Mint a new {@link EvalRunId}. */
export function newEvalRunId(): EvalRunId {
  return brand<"eval-run">(nextEntityId());
}

/** Mint a new {@link LearningRunId}. */
export function newLearningRunId(): LearningRunId {
  return brand<"learning-run">(nextEntityId());
}

/** Mint a new {@link CompilerRunId}. */
export function newCompilerRunId(): CompilerRunId {
  return brand<"compiler-run">(nextEntityId());
}

/** Mint a new {@link PromotionId}. */
export function newPromotionId(): PromotionId {
  return brand<"promotion">(nextEntityId());
}
