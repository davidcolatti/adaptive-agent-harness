---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M2-T1
related:
  - docs/contracts/identifiers.md
  - docs/contracts/job.md
  - docs/contracts/execution-context.md
  - docs/contracts/harness.md
  - docs/milestones/build-plan.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
supersedes: null
superseded_by: null
---

# ADR-0030: Sortable UUIDv7 entity identifiers, owned rather than delegated to Node

## Context

M2-T1 says "use UUIDv7 or another sortable unique ID" and names twelve entities that need one:
`job_id`, `run_id`, `attempt_id`, `trace_event_id`, `workflow_id`, `workflow_version_id`,
`node_execution_id`, `decision_id`, `eval_run_id`, `learning_run_id`, `compiler_run_id`,
`promotion_id`. AD-016 names "UUID implementation" in its list of unprescribed internal choices
that must be recorded rather than implied, so the choice needs an ADR rather than a commit.

Milestone 1 left the harness with `globalThis.crypto.randomUUID()` at exactly two call sites,
`defineDomain()` for a job id and `createHarness()` for a run id. That is UUID version 4: uniform
random, no embedded time, no order. Nothing parsed it, which is what made replacing it cheap now
and expensive later.

Two properties are wanted, and they are independent.

- **Sortability.** Milestone 2 is the run ledger and the append-only trace. An id that sorts
  lexicographically in creation order is a primary key whose index does not fragment, a cursor for
  paginating a trace, and a tiebreaker when two events share a timestamp. A v4 UUID is none of
  those, and M2-T4's buffered writer, M2-T5's Supabase schema and M6's replay all read better
  against an ordered key.
- **Type distinctness.** `runId` and `jobId` are both UUID strings. Nothing but a type stops one
  being passed where the other belongs, and the harness is about to acquire ten more such fields.

A third question was forced by the pinned runtime. Node 24.21.0 ships `crypto.randomUUIDv7()`,
added in v24.16.0, and the installed `@types/node@24.13.6` does **not** declare it: only
`randomUUID` is typed. That looks like a typing problem with a one-line fix, a module augmentation.
It is not the reason the built-in was rejected. The official Node.js v24 documentation for
`crypto.randomUUIDv7([options])` states:

> Generates a random RFC 9562 version 7 UUID. The UUID contains a millisecond precision Unix
> timestamp in the most significant 48 bits, followed by cryptographically secure random bits for
> the remaining fields, making it suitable for use as a database key with time-based sorting. **The
> embedded timestamp relies on a non-monotonic clock and is not guaranteed to be strictly
> increasing.**

Measured on the pinned runtime rather than assumed: generating 20 000 ids in a tight loop produced
**9 939 non-increasing consecutive pairs out of 19 999**. Ids minted inside the same millisecond
are ordered only by their random bits, so roughly half of any burst comes out backwards. The
built-in exposes no monotonic-counter option; its sole option is `disableEntropyCache`.

Sortability within a millisecond is the property M2-T1 exists to buy. A burst of trace events, the
common case, is exactly the case the built-in does not order.

`@internal/core` declares no third-party dependency and must keep none, so a UUID library is not
available to it.

## Decision

`packages/core/src/ids.ts` owns the scheme, and it is the only place in the harness an entity
identifier is minted.

- **The scheme is RFC 9562 UUIDv7**, implemented in this repository over the Node built-in
  `node:crypto` `randomBytes`. The constant `ENTITY_ID_SCHEME = "uuidv7"` names it, so a persisted
  record can say which scheme it was written under, mirroring `FINGERPRINT_ALGORITHM_PREFIX`.

- **`crypto.randomUUIDv7()` MUST NOT be used.** The rejection is on documented and measured
  behaviour, not on the missing type declaration. A module augmentation would have fixed the typing
  and left the semantics unchanged.

- **Ids MUST be strictly increasing within a process.** The generator applies RFC 9562 §6.2
  Method 1, a fixed bit-length dedicated counter, placing a 12-bit counter in `rand_a`. Because the
  textual form puts `rand_a` immediately after the 48-bit timestamp and the version nibble, a
  strictly larger counter is a strictly larger string. Concretely:
  - a new millisecond resets the counter to 0;
  - the same millisecond increments it;
  - **a backwards system clock is treated as the same millisecond** and increments the counter,
    because NTP steps and resumed virtual machines move `Date.now()` down, and emitting a smaller
    id would silently corrupt every ordering built on it;
  - **counter rollover** past 4096 ids in one millisecond borrows the timestamp forward by 1 ms and
    resets the counter, which RFC 9562 §6.2 permits.

  Ordering **across** processes is carried by the timestamp alone. Two processes minting inside one
  millisecond have no happens-before relationship to preserve, so none is claimed.

- **The textual form is lowercase and is validated, never normalized.** `ENTITY_ID_PATTERN` accepts
  `8-4-4-4-12` lowercase hex with the version nibble `7` and the variant nibble in `8`/`9`/`a`/`b`,
  the four values whose high bits are `10`. An uppercase spelling is rejected, because an id is
  compared and sorted as a string here and in whatever database M2-T5 chooses, and two spellings of
  one id would break both.

- **Twelve branded types, one brand mechanism.** `EntityId<TKind>` is `string` intersected with a
  phantom property under a `declare const ... : unique symbol` key, the same idiom `Job` already
  uses for its phantom output marker. `JobId`, `RunId`, `AttemptId`, `TraceEventId`, `WorkflowId`,
  `WorkflowVersionId`, `NodeExecutionId`, `DecisionId`, `EvalRunId`, `LearningRunId`,
  `CompilerRunId` and `PromotionId` are aliases of it. **The runtime representation is a plain
  string**: an id serializes, indexes and compares with no unwrapping, and a branded string still
  assigns to `string`.

- **Twelve generators, one parser.** `newJobId()`, `newRunId()` and their ten siblings take no
  argument, because the kind has no runtime meaning at generation time and `newRunId()` reads
  better at a call site than `newEntityId("run")`. Parsing is generic, `parseEntityId(kind, value,
  path?)`, because there `kind` genuinely does something: it names the entity in the thrown
  `ValidationError`, whose issue path follows the `collectRefIssues` convention in
  `identifiers.ts`. `isEntityId(value)` is the kind-agnostic type guard; the scheme encodes a
  timestamp, a counter and entropy, and nothing about which entity an id names, so no guard can
  recover a kind from a string.

- **Exactly two call sites are wired in M2-T1**: `defineDomain()`'s `createJob` mints the
  `JobId`, and `createHarness()` mints the `RunId`. `ExecutionContext.runId`/`jobId` and
  `TraceEvent.runId` take the brands.

- **`node:crypto` stays permitted in `@internal/core`**, on ADR-0029's reasoning: a Node built-in
  adds nothing to `package.json`, the lockfile, or what `tests/architecture/boundaries.ts` can see.
  The package still declares no `dependencies`.

## What this does NOT decide

- **Where an attempt id or a trace-event id surfaces.** `AttemptId` and `TraceEventId` exist as
  types; no contract carries one. `ExecutionContext.attempt` stays a `number`. M2-T2 finalizes
  `Job` and M2-T3 defines the real trace-event schema, and those tasks decide which of the twelve
  brands appear as fields.
- **How ids are stored.** Whether a column is `uuid` or `text` is M2-T5's, with the caveat that a
  `uuid` column's ordering must be verified to match the textual ordering this scheme guarantees.
- **Ordering across processes or machines**, which the timestamp bounds to millisecond resolution
  and nothing else refines.

## Consequences

### Positive

- A trace or run-ledger listing sorted by id is in creation order, including inside a burst. That
  is what M2-T4's buffered writer and M2-T5's schema were going to need a separate sequence column
  to fake.
- A primary key that is roughly time-ordered keeps a B-tree index appending rather than inserting
  into the middle, which is the practical reason v7 exists.
- Passing a `RunId` where a `JobId` belongs is a compile error, across all twelve entities, at no
  runtime cost.
- An id still is a string, so nothing has to unwrap it to serialize it, log it, or put it in a
  JSON trace payload.
- `@internal/core` keeps zero third-party dependencies.

### Negative

- The harness owns a UUID implementation it must keep correct, including the counter, the rollover
  rule and the clock-regression guard. The mitigation is that it is about forty lines, and the unit
  tests pin the format, the version and variant bits, rejection of v4 and of uppercase, and strict
  ordering over 5 000 ids, over 10 000 ids inside one frozen millisecond, and across a clock that
  steps backwards.
- Module-level mutable state (the last timestamp and the counter) makes the generator stateful.
  That state is the mechanism, not an accident: strict ordering within a millisecond is only
  definable relative to what was already issued.
- The timestamp and the counter are not secret, so the leading 60 bits of an id are partly
  predictable, and the first id of each millisecond has `rand_a` of `000`. Unguessability rests on
  the 62 random bits of `rand_b`, which is what RFC 9562 intends; **an entity id is not a
  capability token** and must not be used as one.
- Under a sustained burst of more than 4 096 ids per millisecond the timestamp runs marginally
  ahead of the wall clock. Monotonicity is preserved; the embedded time becomes approximate.

### Neutral

- The scheme can change: `ENTITY_ID_SCHEME` is the constant a persisted record cites, and changing
  the value supersedes this ADR rather than editing it.
- If a future Node release documents a monotonic `randomUUIDv7`, and `@types/node` declares it,
  this decision is worth revisiting. The generator is one internal function behind twelve stable
  exports, so the swap would not reach a call site.

## Alternatives considered

- **Node's `crypto.randomUUIDv7()`, typed by a narrow module augmentation of `node:crypto`.**
  Rejected on its own documentation and on measurement: it is "not guaranteed to be strictly
  increasing", and on the pinned Node 24.21.0 about half of 20 000 consecutive ids were not. The
  missing `@types/node@24.13.6` declaration was a solvable inconvenience; the missing ordering was
  the whole feature. This was the closest alternative and the one that would have been least code
  to own.
- **Keeping `crypto.randomUUID()` (v4) and adding a separate sequence column.** Rejected: it makes
  every ordering a join or a second column, and it cannot order two rows written by different
  writers. It is also what M1 already had, and M2-T1 exists to replace it.
- **ULID.** Rejected: it is a genuinely sortable, monotonic-capable, time-prefixed id, but it is
  Crockford base32 rather than a UUID, so it does not fit a `uuid` column, does not print as a UUID
  in a trace, and its specification is a repository README rather than an RFC. UUIDv7 gets the same
  property inside the format every tool already understands.
- **KSUID.** Rejected for the same reasons as ULID, plus second-resolution timestamps, which is
  coarser than a trace needs.
- **A UUID library (`uuid`, `uuidv7`).** Rejected: `@internal/core` declares no dependency and must
  keep none (build plan §4, enforced by `tests/architecture/boundaries.ts`). Putting the generator
  behind an adapter package so a dependency could live there would mean `core` could not mint an
  id, which is where ids are minted.
- **Plain `string` ids with no brands.** Rejected: twelve identifier fields of the same primitive
  type, several of which will sit next to each other in one row, is precisely the shape a
  transposed-argument bug takes. The brand costs nothing at runtime.
- **A single opaque `EntityId` type with no per-entity kind.** Rejected: it prevents `string` from
  being passed but not a `RunId` where a `JobId` belongs, which is the more likely mistake.
- **Normalizing uppercase input instead of rejecting it.** Rejected: normalization means two
  spellings of one id exist and only one of them is canonical, so any comparison or index that
  misses the normalization step is silently wrong. Rejecting fails loudly at the boundary.

## References

- `docs/milestones/build-plan.md` M2-T1 (stable identifiers, and the twelve entities), §AD-016
  (internal implementation choices are recorded, and "UUID implementation" is one of its examples)
- RFC 9562, *Universally Unique IDentifiers (UUIDs)*: §4.1 (variant), §4.4 (UUIDv7 layout),
  §6.2 (Monotonicity and Counters, Method 1): <https://www.rfc-editor.org/rfc/rfc9562>
- Node.js v24 `crypto.randomUUIDv7([options])`, added in v24.16.0, read as
  <https://nodejs.org/docs/latest-v24.x/api/crypto.json> and
  <https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandomuuidv7options>
- `@types/node@24.13.6` `crypto.d.ts`, which declares `randomUUID` and no `randomUUIDv7`
- Related ADRs: ADR-0016 (internal implementation choices), ADR-0029 (`node:crypto` in a
  zero-dependency core), ADR-0027, ADR-0015
- Related code paths: `packages/core/src/ids.ts`, `packages/core/src/domain.ts`,
  `packages/core/src/harness.ts`, `packages/core/src/context.ts`, `packages/core/src/job.ts`,
  `packages/core/src/trace.ts`
