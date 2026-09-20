-- M2-T5 / M2-T7: `runs`, the outcome ledger.
--
-- **One query-friendly row per run** (build plan, M2-T7). Every column the plan
-- names is here as a real column rather than a JSONB field, because the point
-- of the ledger is that "what did this cost, how long did it take, did it
-- succeed, which behavior produced it" is answerable by `select` and `group by`
-- without opening a payload. The trace is the narrative; this row is the
-- summary, and the two are written from the same run.
--
-- The row is created in `running` state by `Storage.startRun()` **before the
-- first trace event exists**, so every trace has a run row to hang off and a
-- crash leaves a `running` row rather than nothing. `Storage.finishRun()` fills
-- the outcome columns.
--
-- There is deliberately **no `attempts` table.** An attempt is an ordinal on the
-- run and on each trace event, not an entity with a row: M2 has no retries,
-- M2-T5's table list names no attempts table, and `ExecutionContext.attempt`,
-- `Job` and `TraceEvent` have all settled on a number. The `(job_id, attempt)`
-- unique constraint is what makes "retrying creates a new attempt, not
-- duplicate events" a database rule rather than a convention. ADR-0030 defined
-- an `AttemptId` brand; the milestone that introduces retries decides whether
-- an attempt becomes a row of its own.

create table public.runs (
  -- The RunId, minted by createHarness(). Sortable, so `order by id desc` is
  -- newest-first and a run id is a usable keyset cursor over the ledger.
  id uuid primary key,
  job_id uuid not null references public.jobs (id) on delete cascade,
  attempt integer not null default 1 check (attempt >= 1),

  -- Denormalized from the job so the learning-scope index below can exist.
  -- AD-008 scopes learning by organization (on `domains`) -> domain -> job type.
  domain_id text not null,
  domain_version text not null,
  job_type text not null,

  -- --- the build plan's outcome ledger columns, in its order ----------------

  -- `running` until a terminal event. `aborted` is the fourth state ADR-0031
  -- added to the taxonomy: a run its caller cancelled is neither a completion
  -- nor a failure, and recording it as either would be a lie the ledger then
  -- teaches everything downstream.
  status text not null
    check (status in ('running', 'completed', 'failed', 'aborted')),
  -- Null while running, and null for an aborted run: a run nobody finished has
  -- no success value, and `false` would report a cancellation as a defect.
  success boolean,
  -- M6 fills this. Null means "not evaluated", which is not the same as zero.
  quality_score numeric,
  cost_usd numeric,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  model_calls integer not null default 0 check (model_calls >= 0),
  tool_calls integer not null default 0 check (tool_calls >= 0),
  -- 0 until M3 introduces Jev. A real zero, not a placeholder: a run today
  -- makes no Jev calls.
  jev_calls integer not null default 0 check (jev_calls >= 0),
  -- 0 until M5 introduces fallback. Same reasoning.
  fallback_count integer not null default 0 check (fallback_count >= 0),
  -- Null means "not reviewed". M5/M6 set it.
  human_review boolean,
  -- Null until M4 runs a compiled workflow. A run that fell back to the full
  -- agent keeps it null, which is how the ledger distinguishes the two.
  workflow_version_id uuid references public.workflow_versions (id),
  -- Which version of the agent's *behavior* ran. The composite behavior
  -- fingerprint (M2-T8) is what that means here: the build plan asks for an
  -- "agent version", and a hand-maintained version string is exactly the value
  -- that goes stale without anyone noticing, while the fingerprint cannot.
  agent_version text,

  -- --- identity of what ran -------------------------------------------------

  -- The same composite `sha256:` digest every trace event of the run carries.
  -- Stored beside `agent_version` rather than instead of it so that a future
  -- decision to make `agent_version` something else does not silently change
  -- what the fingerprint column means.
  behavior_fingerprint text,
  -- `RuntimeInfo`, split: the two identifying strings are columns because they
  -- are grouped and filtered on, and the adapter's own free-form detail (eve's
  -- session and turn ids, for instance) stays a payload.
  runtime_name text not null,
  runtime_version text not null,
  runtime_metadata jsonb not null default '{}'::jsonb,
  -- Which application or agent actually executed the run, e.g.
  -- `@internal/eve-fixture-agent`. This closes ADR-0034's recorded open
  -- question: a domain's behavior descriptor describes the domain, so a mock
  -- run and a live run of one domain share a fingerprint and only this column
  -- distinguishes what really ran.
  target text,

  started_at timestamptz not null,
  finished_at timestamptz,
  -- The trace-safe serialized error (ADR-0026), redacted before it is written.
  error jsonb,
  created_at timestamptz not null default now(),

  constraint runs_domain_fkey
    foreign key (domain_id, domain_version) references public.domains (id, version),
  -- "Retrying creates a new attempt, not duplicate events": a second attempt is
  -- a new run row, and re-running the same attempt cannot create a second one.
  constraint runs_job_id_attempt_key unique (job_id, attempt)
);

comment on table public.runs is
  'The outcome ledger (M2-T7): one query-friendly row per run. Created in `running` state before the first trace event, completed by Storage.finishRun.';
comment on column public.runs.agent_version is
  'The composite behavior fingerprint (M2-T8). A content digest rather than a hand-maintained string, because the latter goes stale silently.';
comment on column public.runs.target is
  'Which application/agent executed the run. Closes ADR-0034''s open question about a domain fingerprint not identifying the target.';
comment on column public.runs.jev_calls is
  'Always 0 until M3. A real measurement, not a placeholder: a run today makes no Jev calls.';
comment on column public.runs.fallback_count is
  'Always 0 until M5, for the same reason as jev_calls.';

-- AD-008's learning scope, as one index: domain -> job type -> time. The
-- outermost scope, organization, is on `domains` and reached by join; it is not
-- denormalized here because a denormalized tenant id is the one that drifts.
-- `started_at desc` because every query over this index wants recent runs.
create index runs_domain_job_type_started_at_idx
  on public.runs (domain_id, job_type, started_at desc);

-- "Which runs are still running / which failed" is the other question the
-- ledger is asked constantly, and it is not answerable from the index above.
create index runs_status_idx on public.runs (status, started_at desc);

-- Every trace read and every inspector view starts from a job.
create index runs_job_id_idx on public.runs (job_id, attempt);

alter table public.runs enable row level security;
