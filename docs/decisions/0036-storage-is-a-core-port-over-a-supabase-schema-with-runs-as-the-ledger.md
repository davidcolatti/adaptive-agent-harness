---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M2-T5, M2-T6, M2-T7
related: [0004, 0008, 0011, 0024, 0026, 0030, 0031, 0032, 0033, 0034, 0035]
supersedes: null
superseded_by: null
---

# ADR-0036: `Storage` is a core port over a Supabase schema, and `runs` is the ledger

## Context

M2-T5, M2-T6 and M2-T7 are three tasks and one decision. The schema cannot be
designed without knowing what the harness asks of it; the port cannot be shaped
without knowing what a row costs; and the outcome ledger is a set of columns on
one of those tables. Splitting them would have meant deciding the same things
three times and getting different answers.

Milestone 2's deliverable is "a trustworthy learning dataset". Everything below
follows from taking the adjective seriously. Six forces make the decisions
non-obvious.

**The build plan names `storage` in the harness API and M1 refused to declare
it.** `createHarness({ agentRuntime, storage })` is the target API, and M1-T4
deliberately omitted the option rather than publishing a guess. That debt comes
due here, and what gets declared now is a contract that M3 through M8 will
build on.

**Core cannot import Supabase.** The dependency rule (build plan section 4) and
AGENTS.md both say so, and `tests/architecture/boundaries.ts` enforces it by
making `@supabase/*` adapter-only. So the thing the harness talks to cannot be
the thing that talks to the database.

**Two acceptance criteria are about failure, not success.** "Storage failures
cannot silently turn into successful runs" and "a failed run remains
inspectable" are both properties of what happens when something goes wrong, and
both are properties of *ordering* rather than of anyone remembering to write a
row. A design that gets them right by convention gets them wrong eventually.

**"Retrying creates a new attempt, not duplicate events" is two statements.**
One is about the ledger: a retry is a new row, not an edit of the old one. The
other is about the trace: a buffered writer retries a failed batch by design
(ADR-0031), so re-sending a batch must not duplicate a run's narrative. Both
have to be true, and they are enforced in different places.

**ADR-0030 left a caveat this task has to close.** UUIDv7 sorts because of its
bytes, and nothing had checked that a Postgres `uuid` column compares those
bytes the way the textual form does. If it does not, `order by id` is not
creation order and every cursor in the design is wrong.

**ADR-0034 left an open question this task has to answer.** A behavior
fingerprint describes a *domain*, so the example's mock run and its live run
share one, and nothing recorded which agent actually executed.

## Decision

### The port lives in core, the adapter lives behind it

**`Storage` is declared in `packages/core/src/storage.ts`.** It has eight
methods — `saveJob`, `startRun`, `finishRun`, `getRun`, `getJob`, `listRuns`,
`appendTraceEvents`, `getTrace` — every one `async`, every one rejecting with
`StorageError` (cause preserved) on failure and `ValidationError` on a caller
error. `createHarness()` takes it as an **optional** option, and a harness
without one MUST behave exactly as it did before M2-T5.

**Two implementations exist and both MUST run the same contract suite.**
`createSupabaseStorage()` in `@internal/storage-supabase`, and
`createInMemoryStorage()` in `@internal/testing`. Build plan section 8 names
`Storage` in the list of ports whose every implementation runs one suite; that
suite is `packages/storage-supabase/src/storage.contract.test.ts`, and it is in
the `contract` project rather than `integration` because its purpose is proving
two implementations agree, which would be meaningless against one of them.

**`@supabase/supabase-js@2.116.0` is an exact pin in
`packages/storage-supabase` only**, with an assertion test in the ADR-0024
style. It is a library the adapter imports, which is why it is co-located,
unlike the Supabase **CLI**, which ADR-0033 pins at the root because the
repository drives it as a tool. The two share a version series and are
otherwise unrelated.

**`@internal/storage-supabase` depends on `@internal/trace`.** The dependency
diagram puts storage under trace, so this is the direction it already draws.
The adapter needs it because it is the last code before persistence and redacts
what it writes — including the run row's `error`, which no writer chain reaches.

### Ordering is the contract

**The job and the run row are written before the first trace event, and the
outcome is written after the trace is flushed.** Both halves are load-bearing.

A trace event whose run has no row would be evidence of an execution the ledger
denies happened, so `saveJob` and `startRun` come first; a process that dies
mid-run then leaves a `running` row, which is what makes "a failed run remains
inspectable" true of a crash and not only of a tidy failure.

The run row is the *claim* that a run reached an outcome and the trace is the
*evidence* for it, so `finishRun` comes after the flush. Writing the claim first
and then failing to write the evidence would leave a `completed` row nobody can
verify; failing in the other order leaves a `running` row beside a complete
trace, which is visibly incomplete rather than quietly wrong.

**Every storage failure propagates out of `harness.run()` and MUST NOT become a
result.** The harness wraps anything an implementation throws that is not
already a `StorageError`, preserving the cause, for the same reason it already
contains a runtime adapter that throws instead of returning a failure.

### `runs` is the ledger, and there is no attempts table

**Every column the build plan's M2-T7 list names is a real column** on `runs`,
not a field in a payload. The point of the ledger is that cost, latency, success
and lineage are answerable by `select` and `group by`.

**An attempt is an ordinal, not an entity.** `runs` carries `attempt integer`
and `unique (job_id, attempt)`; `trace_events` carries the same ordinal. No
`attempts` table is created: M2 has no retries, M2-T5's table list names none,
and `Job`, `TraceEvent` and `ExecutionContext` have all already settled on a
number. ADR-0030's `AttemptId` brand stays unused; the milestone that introduces
retries decides whether an attempt becomes a row.

**`agent_version` holds the composite behavior fingerprint.** The build plan
asks the ledger for an "agent version", and a hand-maintained version string is
exactly the value that stops tracking reality without anyone noticing, which
north-star invariant 4 forbids. `behavior_fingerprint` carries the same value in
its own column, so a later decision to redefine `agent_version` cannot silently
change what the fingerprint column means.

**`target` records which application or agent executed**, closing ADR-0034's
open question. It is on `CreateHarnessOptions` rather than on a run, because it
identifies the deployment rather than the work: one harness is constructed
against one agent and runs many jobs through it.

**`success` is `null` for an aborted run**, not `false`. A cancellation is not a
defect, and filing it as one would teach every downstream query the wrong thing.
`jev_calls` and `fallback_count` are `0` rather than null, because a run today
genuinely makes no Jev calls and takes no fallback; `quality_score`,
`human_review` and `workflow_version_id` are null, because "not evaluated", "not
reviewed" and "no compiled workflow" are not zero.

### The schema

**Thirteen tables, exactly M2-T5's list, in five migrations** created with the
pinned CLI and applied in filename order. Stable, indexed metadata in columns;
versioned payloads in `jsonb`.

**The nine later-milestone tables get their minimal keyed shape only**:
identity, the foreign keys that fix how they relate, a timestamp, one
`payload jsonb`, and a comment naming the milestone that fills them. Their
columns are not invented. What *is* decided now, because it is cheap now and
expensive later, is only how they attach.

**Every id column is `uuid` with no database default.** Ids are harness-minted
(ADR-0030) and a database-generated id would be a second, conflicting identity.

**`uuid` ordering was measured, not assumed.** Neither the Postgres 17 nor the
18 documentation states how `uuid` values compare. Against the pinned local
Postgres 17.6, with the cases that distinguish unsigned bytewise comparison from
a signed or textual one (variant nibbles `8`/`9`/`a`/`b`, and a byte crossing
`0x80`), `array_agg(id::text order by id)` equals
`array_agg(id::text order by id::text)`. So `uuid` comparison is unsigned
bytewise, `order by id` on a UUIDv7 column is creation order, and ADR-0030's
caveat is closed. `supabase-schema.integration.test.ts` keeps checking it
against real rows.

**`trace_events` is unique on `(run_id, sequence)`, and that constraint's own
index is the only index on those columns.** It is what every trace read uses
(`where run_id = $1 order by sequence`), so a second, identical index would be
byte-for-byte redundant. The build plan's phrasing asks for a unique constraint
*and* an index; one object provides both.

**The trace event type is a `check` constraint, not a Postgres enum.** An enum
would make adding a type a schema change on a type object that generated code
depends on; a check constraint keeps the column a plain `text` the generated
types render as `string` while still refusing a value outside the closed
taxonomy. Adding a type is a migration either way, which is the point.

**`parent_id` is a self-referencing foreign key.** Referential integrity is
checked at the end of the statement, so a batch carrying a parent and its
children inserts fine, and a dangling span pointer cannot be stored.

**Paging is keyset, never offset.** `listRuns` is newest-first with a `RunId`
cursor; `getTrace` is ascending with a `sequence` cursor. A `limit`/`offset`
pair over an append-only ledger silently skips or repeats rows whenever a run
starts mid-pagination. `MAX_PAGE_SIZE` is 1000, matching `max_rows` in
`config.toml`, and a larger limit is a `ValidationError` rather than a
truncation, because a short page looks exactly like the end of the data.

**`domains.organization_id` exists, defaulting to `local`.** AD-008 scopes
learning by organization/workspace, then domain, then job type, and the schema
has to make that expressible. No organizations table is created and no tenancy
model is designed: the column exists so scoping a learning query is a `where`
rather than a migration. The other two levels are `runs (domain_id, job_type,
started_at desc)`, which is the index AD-008's scope becomes.

**A domain row is derived from the jobs that reference it**, upserted by
`saveJob`, which is why `supabase/seed.sql` stays empty. A seed that had to be
kept in step with the domains an application defines is a seed that goes stale,
and `db reset` would then fail for a reason unrelated to the schema.

### Idempotency, redaction, and RLS

**`appendTraceEvents` upserts with `on_conflict=run_id,sequence` and
`resolution=ignore-duplicates`,** which PostgREST turns into
`ON CONFLICT … DO NOTHING`. Ignoring rather than merging is the right half of
the choice too: a trace is append-only, so the **first** write of a position is
the true one and a later one is a retry of the same event, not a correction of
it. `startRun`, by contrast, is a plain `insert`: a second run of one attempt
must fail loudly, because silently merging it would be the ledger accepting two
executions as one.

**Redaction runs twice, and the second pass is not waste.** The redacting writer
sits above the buffer (ADR-0035) so nothing unredacted is ever buffered; the
storage sink and the Supabase adapter redact again, because that is the last
code before durability and "redact before persistence" is worth more as a
structural property than as a fact about how a caller assembled their chain.
Redaction is idempotent, so the second pass changes nothing when the first ran.
The adapter additionally redacts **the run row's `error` and
`runtime.metadata`**, which no writer chain reaches: a serialized error's
`details` is explicitly not a redaction boundary (ADR-0026), so leaving the
ledger's copy of a value unredacted while redacting the trace's copy would be an
inconsistency with a secret in it. **A job is not redacted**: its `input` is the
work itself and a redacted job could not be replayed.

**Row-level security is enabled on every table with no policies.** The harness
connects as `service_role`, which holds `bypassrls`; `anon` and `authenticated`
reach nothing, even though Supabase grants them table privileges by default.
There is no multi-tenant auth in this milestone and inventing policies for one
is the speculative work scope discipline forbids. Enabling RLS with no policy is
the safe default, and adding a policy later is a migration.

**The service-role client turns off `autoRefreshToken`, `persistSession` and
`detectSessionInUrl`,** all of which the installed package defaults to `true`.
They are browser behaviours — a refresh timer that keeps a Node process alive,
storage a server has no business having, and a URL fragment that does not exist
— and a service-role key is not a session. The official docs show the
server-side pattern without them and document no `auth` options for it, so this
is a harness-owned choice recorded rather than assumed.

**Every `PostgrestError` becomes a `StorageError`** whose `details` carries
`code`, `hint` and `details` and **never** a key, a URL or a row. postgrest-js's
own documentation says Postgres puts the actionable fix in `hint` and that
callers should branch on `code` rather than message text.

**Credentials are read from `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and
never committed**, extending ADR-0033's unconditional rule. The example app
loads them with Node 24's `--env-file-if-exists=../../.env.local`; both
variables or neither counts as configured.

## Consequences

### Positive

- "Storage failures cannot silently turn into successful runs" is a property of
  where the calls are, not of anyone remembering. The same is true of "a failed
  run remains inspectable": the `running` row exists before the trace does.
- A retried trace batch cannot duplicate a run's narrative, in either
  implementation, because the in-memory one keys on `(runId, sequence)` for the
  same reason the database has a constraint on it. The contract suite is what
  keeps them agreeing.
- The harness stays usable with no database at all, so local development remains
  a first-class path (north-star invariant 15) and the credential-free demo
  keeps working on a machine with no Docker.
- ADR-0030's `uuid` ordering caveat and ADR-0034's "which target ran" question
  are both closed with evidence rather than deferred again.
- Nine tables exist with their relationships fixed and their columns left to the
  milestone that owns them, so M3 through M8 add columns rather than inventing
  tables and rediscovering how they join.

### Negative

- The port is eight methods wide, and every new implementation owes the whole
  contract suite. That is the cost of the suite being the thing that makes two
  implementations interchangeable in fact.
- Redacting twice costs a second walk of every payload. It is a pure function
  over small JSON objects and the trace is already identity-only, so the cost is
  small, but it is real and it is paid on every event.
- `runtime_metadata` is adapter-specific JSON on a table otherwise made of
  typed columns. It is redacted and identity-only by rule, but it is the one
  place on the ledger where an adapter decides what gets stored.
- A fan-out sink that fails the write when **any** sink failed means a retry
  re-sends the batch to the sinks that already took it. The Supabase sink is
  idempotent, but the JSONL sink appends, so the local convenience file can
  repeat lines after a transient database failure.
- The nine minimal tables will each need a migration that adds most of their
  real columns. That is deliberate — the alternative is guessing — but it means
  the first migration of each later milestone is a schema change rather than a
  no-op.
- `organization_id` has one value today and nothing reads it. It is a column
  carried for four milestones before it earns its place.

### Neutral

- Binds `packages/core/src/storage.ts`, `packages/core/src/harness.ts`,
  `packages/storage-supabase/`, `packages/trace/src/storage-sink.ts` and
  `fan-out-sink.ts`, `packages/testing/src/in-memory-storage.ts`,
  `supabase/migrations/`, `apps/example-agent/src/run.ts` and the generated
  `database.types.ts`.
- `tests/architecture/boundaries.ts` needed **no change**.
  `@internal/storage-supabase` was already a declared adapter and `@supabase/*`
  was already adapter-only; `apps/example-agent` depending on the adapter
  *package* is not the same as depending on `@supabase/*`, which stays
  adapter-only for applications.
- Does not decide anything about hosted Supabase. ADR-0004 keeps hosted
  infrastructure out until a later milestone.
- Does not decide how M2-T10's inspector reads a run. It has everything it needs
  in `getRun`, `getJob` and `getTrace`, and the JSONL file remains as a second
  source for a run recorded with no database.

## Alternatives considered

- **A direct `pg` connection instead of `@supabase/supabase-js`.** Rejected. It
  would be faster and would give real transactions, which PostgREST does not
  expose across requests. But the CLI's `supabase gen types --local` generates
  types for the PostgREST surface, ADR-0033 already committed to that generated
  file as the schema the compiler is typed against, and a `pg` adapter would
  make it decoration. It would also mean the local development path and any
  future hosted one differ in their auth model and their RLS behaviour, which is
  precisely the gap ADR-0033 rejected bare Postgres to avoid. The cost is real:
  see "no cross-call transaction" below.
- **Declaring `Storage` in `@internal/storage-supabase` and having core depend
  on it.** Rejected outright: it inverts the dependency rule the build plan
  states and `tests/architecture/boundaries.ts` enforces, and it would make
  every unit test of the harness pull in a database driver.
- **An `attempts` table.** Rejected. It is not on M2-T5's table list, M2 has no
  retries, and `Job`, `TraceEvent` and `ExecutionContext` have all settled on an
  ordinal. Creating a table for an entity nothing yet produces would mean
  designing its columns from imagination and then migrating them when retries
  are actually specified.
- **Normalizing model calls, tool calls and usage into their own tables.**
  Rejected by the build plan directly: "do not prematurely normalize every
  model/tool field into separate tables. Store stable indexed metadata in
  columns and versioned payloads in JSONB." The trace already has one row per
  call, and `usage jsonb` on it is the versioned payload.
- **A Postgres enum for the trace event type.** Rejected on the generated-types
  seam: an enum becomes a type in `database.types.ts` that code then depends on,
  so adding an event type churns the generated file and the compiler's view of
  it, while a check constraint refuses the same values and renders as `string`.
- **Offset paging.** Rejected. An append-only ledger gains rows while a client
  pages through it, so `limit`/`offset` skips and repeats. A keyset cursor over a
  sortable id is the reason ADR-0030 chose a sortable id.
- **Making `storage` a required option on `createHarness()`.** Rejected. It
  would make every unit test and the credential-free demo need a database, and
  it would break north-star invariant 15. Optional is also what lets M2-T5 land
  without touching a single existing call site.
- **Persisting trace events through `Storage` on the harness rather than through
  a `TraceSink`.** Rejected. It would give the trace a second write path with
  its own ordering, batching and retry rules, next to the buffered writer that
  already has them and that ADR-0031 spent a task getting right.
- **Writing the run row after the trace flush only, with no `startRun`.**
  Rejected. It is simpler, and it loses exactly the case the milestone cares
  about: a run that crashed leaves no row at all, so the failure is invisible
  rather than inspectable.
- **Seeding the example domain row in `supabase/seed.sql`.** Rejected in favour
  of `saveJob` upserting it. A seed listing domains would need updating whenever
  an application defines one, and `db reset` would fail for a reason unrelated
  to the schema it is meant to be testing.
- **RLS policies for `service_role` instead of relying on `bypassrls`.**
  Rejected as a no-op that reads like a security control: `service_role` bypasses
  RLS regardless, so the policies would never be evaluated and would mislead the
  next reader into thinking access is policy-governed when it is role-governed.

## Known limitations

- **There is no cross-call transaction.** PostgREST is request-per-call, so
  `saveJob` + `startRun` is two requests and a failure between them leaves a job
  row with no run. That is a recoverable, visible state — a job nothing
  references — rather than a corrupt one, and the run itself fails loudly. A
  future need for atomicity here means a Postgres function called over RPC, not
  a second driver.
- **`listRuns` cannot filter by organization.** The column is on `domains` and
  the filter would need a join. Adding it before anything sets a second
  organization would be designing for a case that does not exist.

## References

- `docs/milestones/build-plan.md` M2-T5 (the thirteen tables; columns for
  indexed metadata and JSONB for versioned payloads), M2-T6 (schema changes are
  committed SQL migrations), M2-T7 (the outcome ledger's column list), section 4
  (the dependency rule; core cannot import Supabase), section 5 (`Job`,
  `Storage`), section 8 (every implementation of a port runs the same contract
  suite), AD-004, AD-008, AD-010, AD-011, AD-016
- `AGENTS.md`: "No direct database access outside `packages/storage-supabase`",
  "No silent dependency additions", rule 12 (generated files), "migrations are
  included if storage changes"
- `@supabase/supabase-js@2.116.0`, installed: `src/index.ts` (`createClient`),
  `src/SupabaseClient.ts` (`from`, typed `Database`), `src/lib/constants.ts`
  (`DEFAULT_AUTH_OPTIONS`, all three `true`);
  `@supabase/postgrest-js@2.116.0`: `src/PostgrestError.ts`
  (`{ message, details, hint, code }`; branch on `code`, the fix is in `hint`),
  `src/PostgrestQueryBuilder.ts` (`insert`, `upsert`, `onConflict`,
  `ignoreDuplicates` -> `Prefer: resolution=ignore-duplicates`),
  `src/PostgrestTransformBuilder.ts` (`order`, `limit`, `range`, `maybeSingle`),
  `src/types/types.ts` (`{ data, error }`, never a throw)
- <https://supabase.com/docs/guides/database/postgres/row-level-security> (RLS
  is not enabled by default; enabled with no policies denies the publishable
  key; `service_role` holds `bypassrls`);
  <https://supabase.com/docs/guides/api/api-keys> (the server-side
  `createClient` pattern)
- <https://www.postgresql.org/docs/17/datatype-uuid.html> and
  <https://www.postgresql.org/docs/18/functions-uuid.html>: neither states how
  `uuid` values compare, which is why the property was measured. The measurement
  is in the M2-T5/T6/T7 WORKLOG entry.
- Related ADRs: 0004 (local-first), 0008 (domain-isolated learning scope), 0024
  (exact pins and assertion tests), 0026 (trace-safe errors; `details` is not a
  redaction boundary), 0030 (UUIDv7 ids, and the `uuid` ordering caveat this
  closes), 0031 (trace taxonomy, buffered writer, flush-failure semantics), 0032
  (`parseJob` as the read boundary), 0033 (the pinned CLI and `db reset` as the
  reproducibility gate), 0034 (behavior fingerprint, and the "which target ran"
  question this closes), 0035 (redaction above the buffer)
- Related code paths: `packages/core/src/storage.ts`,
  `packages/core/src/harness.ts`, `packages/storage-supabase/src/`,
  `packages/trace/src/storage-sink.ts`, `packages/trace/src/fan-out-sink.ts`,
  `packages/testing/src/in-memory-storage.ts`, `supabase/migrations/*.sql`,
  `apps/example-agent/src/run.ts`, `docs/contracts/storage.md`
