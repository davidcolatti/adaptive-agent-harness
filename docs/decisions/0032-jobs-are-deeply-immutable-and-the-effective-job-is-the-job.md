---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M2-T2
related:
  - docs/contracts/job.md
  - docs/contracts/harness.md
  - docs/contracts/identifiers.md
  - docs/contracts/domain-definition.md
  - docs/milestones/build-plan.md
  - docs/decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
supersedes: null
superseded_by: null
---

# ADR-0032: Jobs are deeply immutable, the effective job is the job, and a job carries no clock

## Context

M2-T2 says "finalize the `Job` schema" and "jobs are immutable after execution begins". The build
plan's section 5 states the field list and nothing else, and M1-T3 implemented that list literally.
Finalizing it means answering the questions the list does not, because M2-T5 (Supabase schema),
M2-T7 (outcome ledger), M2-T10 (run inspector) and M6 (replay) are all about to read and write
jobs, and each of them would otherwise answer the same questions differently.

**Immutability was one level deep.** `defineDomain()`'s `createJob` called `Object.freeze` on the
job, on `contracts` and on `permissions`, and `createHarness()` called it on the job it assembled
from the overrides. `Object.freeze` freezes properties, not the objects those properties point at.
So `job.budget = {}` threw and `job.budget.maxCostUsd = 1e9` did not;
`job.permissions = []` threw and `job.permissions[0].mode = "write"` did not. Those two are not
incidental examples: a mutable nested budget and a mutable nested grant are exactly the values that
widen what an execution may spend and what it may do, while the job that a run record names still
reads as the original. An immutability claim that misses the fields with authority in them is worse
than no claim, because downstream code is written against the claim.

**Two values were both called "the job".** `domain.createJob(input)` mints the id and builds a job.
`createHarness()` then spreads it into a second frozen object with the caller's budget merged,
permissions replaced and metadata merged, and hands *that* to the runtime, under the same id. M1
named the second one `effectiveJob` locally and documented neither as authoritative. M2-T5 has to
store one of them, M2-T3 has to trace one of them, and M6 has to replay one of them; with two
candidates sharing an id, "the job" is ambiguous in exactly the places reproducibility is claimed.

**A job had no creation time, and the obvious fix would have added a second one.** The natural M2
reflex is a `createdAt` column, so a `createdAt` field. But M2-T1 (ADR-0030) had just made every
`JobId` an RFC 9562 UUIDv7 whose first 48 bits *are* the creation millisecond. A field would be a
second source of truth for one instant, and the two could disagree, with nothing to say which is
right.

**Nothing turned an untrusted value back into a job.** `parseEntityId` exists for an id and
`validateWith` for a domain's input, but a whole job read out of a database row, a stored trace or
a frozen replay fixture arrives as `unknown`. Without a boundary function each of M2-T5, M2-T10 and
M6 would cast, and a cast is an assertion rather than a check.

Two smaller questions were open and are answered here so they are not reopened: whether an
`AttemptId` belongs on `Job` now that ADR-0030 defines the type (ADR-0030 explicitly deferred this
to M2-T2), and whether `JobContracts` needs a fourth field.

## Decision

### 1. Immutability is deep, and it reaches exactly as far as JSON does

`packages/core/src/freeze.ts` exports `deepFreeze(value)`, which freezes a value and everything it
can reach, and it MUST be used wherever the harness freezes a contract value.
`defineDomain()`'s `createJob` and `createHarness()`'s job construction both call it.

`deepFreeze` recurses into **arrays and plain objects only**. Any other object — a `Date`, a `Map`,
a `Set`, a class instance, a typed array, a function — is left exactly as found: neither frozen nor
walked. This applies to `input` as much as to any other field. The consequence is stated positively
rather than hidden: **a job is deeply immutable exactly as far as it is JSON-representable**, which
is exactly as far as it is persistable, traceable and replayable.

Two reasons, and neither is about effort:

- Freezing an exotic object mostly does not work. `Object.freeze(date)` does not stop
  `date.setTime()`, and a frozen `Map` still accepts `set()`, because their state lives in internal
  slots rather than in properties. The protection would be advertised and absent.
- Freezing an exotic object can break it. A class instance that memoizes into a field, or any
  object with a caching getter, stops working when frozen, and it stops working at a distance from
  the code that froze it. A domain whose schema library produces a `Date` would find the harness
  had silently altered its value's behaviour.

`Job.input` is therefore documented as expected to be JSON-representable, and `parseJob` requires
it. A domain that puts a `Date` in an input keeps whatever mutability that `Date` had.

Freezing is in place and the argument is returned, so a caller that means to keep mutating a value
it passed to `createJob` must pass a copy. Because every module in the repository is an ES module
and therefore strict, a write to a frozen property **throws a `TypeError`**; it does not fail
silently.

### 2. The effective job **is** the job

The per-run overrides are part of **creating** a job, not an amendment to one. `createHarness()`
applies them while building the job, before anything executes, and the value that comes out is the
single authoritative job:

- it is what `AgentRuntime.run(job, context)` receives;
- it is what a trace records and what M2-T5 persists;
- it is what M6 replays;
- it carries the id `domain.createJob()` minted, because it is the same job, not a successor.

There is no second job and no mutation of the first. The local name `effectiveJob` in
`harness.ts` is an implementation detail of the two-step construction, not a second contract type,
and `Job` remains the only job type.

`createJob(input)`'s public signature is unchanged, and `defineDomain()` gains no clock.

### 3. There is no `createdAt` field; creation time is derived from the id

`Job` MUST NOT carry a creation timestamp. `packages/core/src/ids.ts` exports
`entityIdTimestampMs(id)` and `entityIdTimestamp(id)`, which read the 48-bit timestamp out of any
entity id in the scheme. A persisted row that wants a queryable timestamp column derives it there.

The derived value inherits ADR-0030's two monotonicity caveats, and they are documented at the
function: under a burst past 4096 ids in one millisecond the timestamp reads marginally ahead of
the wall clock, and while the system clock is stepped backwards it reads marginally behind. Both
are bounded and both are the price of an id that never goes down. The value is the creation time to
millisecond resolution, not an audited clock reading.

### 4. `parseJob` is the boundary, and it is strict

`parseJob(value, path?)` returns `Job<unknown, unknown>` or throws a `ValidationError` listing
**every** problem, each at the path of the field that caused it, in the `collectRefIssues` style.
`isJob(value)` is the predicate form; it freezes nothing, because a predicate must not change its
argument.

The rules:

| Field | Rule |
| --- | --- |
| `id` | `parseEntityId("job", …)`: a lowercase UUIDv7. |
| `domain` | `collectRefIssues`: the `{ id, version }` rule `defineDomain()` already applies. |
| `jobType`, `objective` | Non-empty strings. |
| `input` | A JSON value, and nothing more. |
| `contracts.inputSchema`, `contracts.outputSchema` | `parseCapabilityRefString`: `id@version`. |
| `contracts.sop` | A bare identifier (`IDENTIFIER_PATTERN`), not a versioned reference. |
| `budget` | Known dimensions only; each a finite number >= 0; `maxDurationMs`, `maxModelCalls` and `maxToolCalls` whole; `maxCostUsd` fractional. |
| `permissions` | Tool grants: non-empty `toolId`, `read`/`write` mode, optional non-empty `scope`. |
| `metadata` | A JSON object. |

Four consequences of those rules are decisions in their own right:

- **The input is not validated against the domain's schema here, and MUST NOT be.** `parseJob` has
  no domain to ask. Typed validation stays with `DomainDefinition.inputSchema` and the one choke
  point `createHarness()` already owns. The return type is `Job<unknown, unknown>` for the same
  reason: the caller that knows the domain narrows with the domain's own schema.
- **`contracts.sop` is a bare identifier**, because `procurement-sop` is what the example domain
  writes and M1-T9 deliberately left it unregistered: a SOP is content, not an executable
  capability. `IDENTIFIER_PATTERN` excludes `@`, so a versioned SOP reference would not pass; see
  "Open questions".
- **An unknown field is an error, not something to drop**, at the top level, in `contracts`, in
  `budget` and in a `ToolGrant`. A job is a closed contract whose purpose is reproducibility, and
  silently discarding a field this version does not understand loses data from exactly the record
  that is supposed to be complete. A mistyped budget dimension would otherwise read as unlimited.
- **The result is deep-frozen**, because a job read back is as immutable as a job just created.
  The freeze reaches the `input` and `metadata` values shared with the argument.

### 5. An attempt is not part of a job

`Job` MUST NOT gain an attempt field. An attempt belongs to a run: a retry reuses the job unchanged
and receives a new `ExecutionContext`, which is why `attempt` lives there. Where attempt identity
surfaces — whether `AttemptId` appears as a trace field, a run-ledger column, or both — is M2-T3's
and M2-T5's decision. ADR-0030 deferred this question to here; here it is answered by declining to
put it on the job.

### 6. `JobContracts` keeps its three string references

No fourth field. The three are references rather than embedded schemas because a job is serialized,
and a validator does not survive `JSON.stringify`.

## Consequences

### Positive

- The immutability the contract has claimed since M1-T3 is now true of the fields that carry
  authority. Widening a budget or a grant after a job exists throws.
- "The job" names one value. M2-T3, M2-T5, M2-T7, M2-T10 and M6 do not each have to pick between
  two candidates that share an id.
- Creation time cannot disagree with the id, because there is only the id.
- A stored job becomes a `Job` by being checked rather than by being cast, and every problem in a
  malformed row is reported at once with a path, which is what makes a migration or an inspector
  debuggable.
- `parseJob` is a written-down specification of the shape M2-T5's columns and constraints have to
  match, available before the schema is written.
- A test proves producer and validator agree:
  `parseJob(JSON.parse(JSON.stringify(job)))` deep-equals the job the harness built.

### Negative

- Deep immutability is not total, and the boundary has to be understood rather than assumed. A
  domain whose input carries a `Date` or a `Map` gets a job that is frozen around those values but
  not inside them. This is documented at `deepFreeze`, in `job.md`, and here.
- `deepFreeze` mutates what it is given, in the sense of freezing it. A caller that passes a value
  it also holds elsewhere finds that value frozen. `createJob` and `createHarness` copy the
  containers they build, but `input` and `metadata` are passed through by reference, so a domain
  that returns a module-level constant as metadata will find the constant frozen.
- Strictness about unknown fields means a job written by a future version with an extra field is
  rejected by this one, rather than degraded. That is the intended failure, but it makes adding a
  field a coordinated change rather than a rolling one.
- `parseJob` walks the whole `input` to check it is JSON. For a large input that is real work on a
  path (reading a stored job) that could otherwise have been a cast. Measured against the
  alternative, which is trusting a database row, the cost is accepted.
- The harness now owns two small recursive walks, `deepFreeze` and `isJsonValue`, both of which
  need a cycle guard and are tested for one.

### Neutral

- Nothing in the `Job` type's field list changed, so no consumer breaks. What changed is what is
  guaranteed about a value of that type, and what can be done with an `unknown` claiming to be one.
- `isJsonValue`, `isJsonObject` and `isPlainObject` are exported from `@internal/core` because
  `parseJob` needed them; M2-T3's trace payloads and M2-T9's redaction are expected to reuse them
  rather than re-deriving the same walk.

## Alternatives considered

- **Leave the freeze one level deep and document the limit.** Rejected: the two values that a
  shallow freeze leaves mutable are the budget and the grants, which are the two that decide what
  an execution is allowed to do. A documented hole in exactly the safety-relevant place is not a
  contract.
- **Deep-freeze everything reachable, including a `Date` or a class instance.** Rejected on
  measurement of what `Object.freeze` actually does: it cannot stop `Date.prototype.setTime` or
  `Map.prototype.set`, because that state is in internal slots. It would advertise protection that
  is not there, and it would break a memoizing class instance at a distance.
- **Deep-freeze the containers but skip `input` entirely.** Rejected: the input is the largest and
  most interesting part of a job, and it is what a replay compares against. Freezing its
  JSON-shaped part costs nothing and catches a real class of bug; the exotic-value carve-out
  already handles the case that motivated the suggestion.
- **Deep-copy instead of deep-freeze (`structuredClone`) so nothing shared is affected.** Rejected:
  it changes identity, so `job.input === theInputTheCallerPassed` becomes false, and it silently
  drops or transforms anything `structuredClone` does not carry. It also costs a full copy of every
  input on every job.
- **Make the overrides produce a distinct `EffectiveJob` type, or a new job with a new id.**
  Rejected: a second type would need its own persistence, trace and replay story, and a second id
  would make "one job, retried" indistinguishable from "two jobs". The overrides happen before
  execution begins, so folding them into creation is both simpler and what the M2-T2 sentence
  already implies.
- **Move the overrides into `domain.createJob(input, overrides)`.** Rejected: it changes a public
  signature every domain implements, to move work that belongs to the run rather than the domain.
- **Add `createdAt: string` and keep the id timestamp as a coincidence.** Rejected: two sources of
  truth for one instant, with no rule for which wins when they disagree. The id timestamp cannot be
  forged independently of the id.
- **Add a `clock` to `defineDomain()` so job creation time is injectable.** Rejected: it adds a
  required dependency to every domain definition to produce a value the id already carries, and a
  fake clock would then be able to mint a job whose stated creation time contradicts its id's.
- **Have `parseJob` take the `DomainDefinition` and validate the input too.** Rejected: it would
  make the boundary function unusable by M2-T10's inspector and M2-T5's storage, neither of which
  has the domain in hand, and it would create a second input-validation choke point beside
  `createHarness()`.
- **Have `parseJob` ignore unknown fields for forward compatibility.** Rejected: a job's purpose is
  to be a complete, reproducible record, and dropping part of it on read is the silent failure. A
  loud one is recoverable.
- **Add `attemptId` to `Job` now that `AttemptId` exists.** Rejected: an attempt is a property of a
  run, not of the work to be done, and a retry that reuses the job would then have to mutate it or
  copy it, which contradicts the immutability this same ADR establishes.
- **Add `contracts.sopVersion` or make `sop` a capability reference.** Rejected for now: nothing
  versions a SOP yet and no capability is registered for one, so it would be a guess published as a
  contract. Recorded as an open question instead.

## Open questions

- **A versioned SOP reference.** `contracts.sop` accepts a bare identifier, and
  `IDENTIFIER_PATTERN` excludes `@`, so `procurement-sop@1.0.0` is currently rejected. M2-T8's
  behavior fingerprint has to cover SOP *content*, and if it concludes that a reference must name a
  version, the change is to `JobContracts` and to this rule, with an ADR that supersedes this
  section. Until then the harness fingerprints the content and the job names the SOP.
- **Adding a tenth field.** Strict unknown-field rejection makes that a breaking read for older
  code. If M2-T5 or M4 needs one (a `parentJobId` for subworkflows is the likely first), the change
  needs a stated compatibility story, which may be a schema version on the stored record rather
  than on the type.
- **Whether `ToolGrant` stays this shape.** `context.ts` already says M2 and M5 are expected to
  extend it with expiry and approval requirements. `parseJob`'s grant rules will have to move with
  it, and they are strict about unknown fields, so that change is coordinated.

## References

- `docs/milestones/build-plan.md` §5 (`Job`, `Domain definition`), M2-T2 ("finalize the `Job`
  schema; jobs are immutable after execution begins"), M2 acceptance criteria
- ECMAScript: `Object.freeze` freezes own properties and not the objects they reference; a write to
  a frozen property in strict mode throws a `TypeError`, and every module here is strict
- RFC 9562 §4.4 (the UUIDv7 48-bit timestamp that makes `createdAt` redundant)
- Related ADRs: ADR-0030 (entity identifiers; its "What this does NOT decide" hands the attempt-id
  question to M2-T2), ADR-0029 (canonical JSON, and `node:crypto` in a zero-dependency core),
  ADR-0027 (Standard Schema as the input-validation contract), ADR-0026 (trace-safe errors)
- Related code paths: `packages/core/src/job.ts`, `freeze.ts`, `json.ts`, `ids.ts`, `domain.ts`,
  `harness.ts`
