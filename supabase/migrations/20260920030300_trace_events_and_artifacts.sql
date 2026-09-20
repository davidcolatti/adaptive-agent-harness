-- M2-T5 / M2-T6: `trace_events` and `artifacts`.
--
-- `trace_events` is the append-only narrative of a run: the `TraceEvent` type
-- from `@internal/core` (M2-T3), one row per event, in the order the run's
-- single `TraceRecorder` assigned. AD-010 is why it is a first-class table with
-- real columns rather than a log: the trace is a product surface, and
-- "a trace reconstructs execution without application logs" is an acceptance
-- criterion of this milestone.

create table public.trace_events (
  -- The TraceEventId. A `*.started` event's own id is its span id, which is why
  -- there is no separate span table and no `span_id` column (ADR-0031).
  id uuid primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  attempt integer not null check (attempt >= 1),
  -- The run's total order, assigned by the recorder, starting at 0.
  sequence integer not null check (sequence >= 0),
  -- The event's own instant. Named `occurred_at` rather than `timestamp`
  -- because `timestamp` is a Postgres type name and a column called that has to
  -- be quoted in half the places it appears; the `TraceEvent.timestamp` field
  -- maps onto it in the adapter and nowhere else.
  occurred_at timestamptz not null,
  -- The closed taxonomy (TRACE_EVENT_TYPES in @internal/core), as a check
  -- constraint rather than a Postgres enum. An enum would make adding a type a
  -- schema change on a type object that generated code then depends on; a check
  -- constraint keeps the column a plain `text` the generated types render as
  -- `string`, while still refusing a value outside the set. Adding a type is a
  -- migration either way, which is the point: the taxonomy is closed.
  type text not null check (
    type in (
      'run.started', 'run.completed', 'run.failed', 'run.aborted',
      'agent.started', 'agent.completed', 'agent.failed',
      'model.started', 'model.completed', 'model.failed',
      'tool.started', 'tool.completed', 'tool.failed',
      'decision.started', 'decision.completed', 'decision.failed',
      'node.started', 'node.completed', 'node.failed',
      'artifact.created',
      'approval.requested', 'approval.resolved',
      'fallback.started', 'fallback.completed',
      'eval.completed'
    )
  ),
  -- The enclosing span's event id, or null for a root. Self-referencing, so a
  -- dangling parent pointer cannot be stored. A parent always precedes its
  -- child in the same run, and referential integrity is checked at the end of
  -- the statement, so a batch carrying a parent and its children inserts fine.
  parent_id uuid references public.trace_events (id),
  -- The workflow node. Always null until M4.
  node text,
  -- TRACE_EVENT_VERSION. The event schema version, so a reader of a stored
  -- trace can tell which shape it is looking at.
  version integer not null check (version >= 1),
  behavior_fingerprint text,
  -- The identity-only, redacted body (ADR-0031, ADR-0035).
  payload jsonb not null default '{}'::jsonb,
  usage jsonb,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  error jsonb,
  created_at timestamptz not null default now(),

  -- The idempotency constraint. A buffered writer keeps a failed batch and
  -- retries it, and the Supabase sink upserts with
  -- `on_conflict=run_id,sequence` + `resolution=ignore-duplicates`, so a
  -- re-sent batch writes nothing new rather than duplicating the run's
  -- narrative. This is what makes "retrying creates a new attempt, not
  -- duplicate events" true of the trace as well as of the ledger.
  --
  -- The unique constraint's own btree index is also the index every trace read
  -- uses (`where run_id = $1 order by sequence`), so no second index on the
  -- same two columns is created: it would be byte-for-byte redundant.
  constraint trace_events_run_id_sequence_key unique (run_id, sequence)
);

comment on table public.trace_events is
  'The append-only trace (M2-T3). One row per TraceEvent, ordered by (run_id, sequence). Idempotent on that pair.';
comment on column public.trace_events.occurred_at is
  'TraceEvent.timestamp. Renamed because `timestamp` is a Postgres type name.';
comment on column public.trace_events.payload is
  'Identity-only and redacted before it is written (ADR-0031, ADR-0035). Never message text, tool arguments, tool results or model output.';
comment on constraint trace_events_run_id_sequence_key on public.trace_events is
  'Makes a re-sent trace batch a no-op. Also serves as the index for `where run_id = $1 order by sequence`.';

-- "Show me everything of this type across runs" (every model call, every
-- failure) is the other question a learning dataset is asked, and the unique
-- constraint's index cannot answer it.
create index trace_events_type_idx on public.trace_events (type, id desc);

alter table public.trace_events enable row level security;

-- Artifacts
--
-- On M2-T5's table list, and `artifact.created` is in the trace taxonomy, but
-- nothing produces one yet: the build plan defines no artifact shape and M5 is
-- where an agent starts writing them. Minimal keyed shape only.
create table public.artifacts (
  id uuid primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.artifacts is
  'M5 fills this. Minimal keyed shape only: an id, the run that produced it, and a payload. The artifact.created trace event exists; its content shape does not yet.';

create index artifacts_run_id_idx on public.artifacts (run_id, id desc);

alter table public.artifacts enable row level security;
